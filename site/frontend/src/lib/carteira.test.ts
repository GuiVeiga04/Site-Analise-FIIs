import assert from "node:assert/strict";
import { test } from "node:test";
import { calcularPosicoes, precoNaData, primeiraVendaSemCotas, validarOperacao, type Operacao } from "./carteira.ts";

const op = (o: Partial<Operacao>): Operacao => ({ ticker: "HGLG11", tipo: "compra", data: "2026-01-10", quantidade: 10, preco: 150, ...o });
const VALIDOS = new Set(["HGLG11", "MXRF11", "KNCR11"]);
const HOJE = "2026-10-26";

test("preço médio: compras somam, venda não muda o preço médio", () => {
  const ops = [
    op({ id: 1, quantidade: 10, preco: 150 }),                       // 1.500
    op({ id: 2, data: "2026-02-10", quantidade: 10, preco: 160 }),   // 1.600 -> 20 cotas, PM 155
    op({ id: 3, data: "2026-03-10", tipo: "venda", quantidade: 5, preco: 170 }),
    op({ id: 4, data: "2026-04-10", quantidade: 5, preco: 140 }),    // 15×155 + 5×140 = 3.025 / 20
  ];
  const [p] = calcularPosicoes(ops);
  assert.equal(p.quantidade, 20);
  assert.equal(Math.round(p.precoMedio * 100) / 100, 151.25);
  assert.equal(Math.round(p.custo * 100) / 100, 3025);
  assert.equal(p.primeiraCompra, "2026-01-10");
});

test("ordem cadastrada não importa: vale a data", () => {
  const a = calcularPosicoes([op({ id: 9, data: "2026-02-01", quantidade: 10, preco: 160 }), op({ id: 1, data: "2026-01-01", preco: 150 })]);
  assert.equal(a[0].precoMedio, 155);
});

test("zerar a posição e comprar de novo recomeça o preço médio", () => {
  const [p] = calcularPosicoes([
    op({ id: 1, preco: 100 }),
    op({ id: 2, data: "2026-02-01", tipo: "venda", quantidade: 10, preco: 120 }),
    op({ id: 3, data: "2026-03-01", quantidade: 4, preco: 90 }),
  ]);
  assert.equal(p.quantidade, 4);
  assert.equal(p.precoMedio, 90);
});

test("vários fundos separados e ordenados", () => {
  const ps = calcularPosicoes([op({ ticker: "MXRF11", preco: 10 }), op({ preco: 150 })]);
  assert.deepEqual(ps.map((p) => p.ticker), ["HGLG11", "MXRF11"]);
});

test("compra e venda no mesmo dia: a compra vem antes", () => {
  assert.equal(primeiraVendaSemCotas([
    op({ id: 2, tipo: "venda", quantidade: 5 }), op({ id: 1, quantidade: 5 }),
  ], "HGLG11"), null);
});

test("validação de campos", () => {
  assert.match(validarOperacao(op({ ticker: "HGLG" }), [], VALIDOS, HOJE) ?? "", /fundo da lista/);
  assert.match(validarOperacao(op({ ticker: "XPTO11" }), [], VALIDOS, HOJE) ?? "", /não está entre os fundos/);
  assert.match(validarOperacao(op({ data: "2026-10-27" }), [], VALIDOS, HOJE) ?? "", /futuro/);
  assert.match(validarOperacao(op({ data: "1990-01-01" }), [], VALIDOS, HOJE) ?? "", /antiga/);
  assert.match(validarOperacao(op({ quantidade: 2.5 }), [], VALIDOS, HOJE) ?? "", /inteiro/);
  assert.match(validarOperacao(op({ quantidade: 0 }), [], VALIDOS, HOJE) ?? "", /inteiro/);
  assert.match(validarOperacao(op({ preco: 0 }), [], VALIDOS, HOJE) ?? "", /preço/);
  assert.match(validarOperacao(op({ preco: 10.123 }), [], VALIDOS, HOJE) ?? "", /2 casas/);
  assert.equal(validarOperacao(op({}), [], VALIDOS, HOJE), null);
  assert.equal(validarOperacao(op({ data: HOJE }), [], VALIDOS, HOJE), null);
});

test("venda sem cotas suficientes na data é recusada", () => {
  const salvas = [op({ id: 1, data: "2026-03-01", quantidade: 10 })];
  assert.match(validarOperacao(op({ tipo: "venda", data: "2026-02-01", quantidade: 1 }), salvas, VALIDOS, HOJE) ?? "",
    /01\/02\/2026 você ainda não teria cotas suficientes de HGLG11.*faltariam 1/);
  assert.match(validarOperacao(op({ tipo: "venda", data: "2026-04-01", quantidade: 11 }), salvas, VALIDOS, HOJE) ?? "", /faltariam 1/);
  assert.equal(validarOperacao(op({ tipo: "venda", data: "2026-04-01", quantidade: 10 }), salvas, VALIDOS, HOJE), null);
});

test("editar ou trocar o fundo de uma compra não pode deixar uma venda sem cotas", () => {
  const salvas = [op({ id: 1, quantidade: 10 }), op({ id: 2, tipo: "venda", data: "2026-05-01", quantidade: 8 })];
  assert.match(validarOperacao(op({ id: 1, quantidade: 5 }), salvas, VALIDOS, HOJE) ?? "", /venda de HGLG11 em 01\/05\/2026 ficaria sem cotas/);
  assert.match(validarOperacao(op({ id: 1, ticker: "MXRF11" }), salvas, VALIDOS, HOJE) ?? "", /venda de HGLG11/);
  assert.equal(validarOperacao(op({ id: 1, quantidade: 8 }), salvas, VALIDOS, HOJE), null);
});

test("preço sugerido: fechamento na data ou no pregão anterior (até 7 dias)", () => {
  const h = [
    { data_pregao: "2026-01-08", preco: 150 }, { data_pregao: "2026-01-09", preco: 151 },
    { data_pregao: "2026-01-12", preco: null }, { data_pregao: "2026-01-13", preco: 152 },
  ];
  assert.deepEqual(precoNaData(h, "2026-01-09"), { data: "2026-01-09", preco: 151 });
  assert.deepEqual(precoNaData(h, "2026-01-11"), { data: "2026-01-09", preco: 151 }); // domingo
  assert.deepEqual(precoNaData(h, "2026-01-12"), { data: "2026-01-09", preco: 151 }); // sem preço no dia
  assert.equal(precoNaData(h, "2026-01-01"), null);                                    // antes do histórico
  assert.equal(precoNaData(h, "2026-03-01"), null);                                    // longe demais do último pregão
});

import { resumirCarteira, type InfoFundo } from "./carteira.ts";

test("resumo: valor, resultado, renda, yield on cost e divisão", () => {
  const info = new Map<string, InfoFundo>([
    ["HGLG11", { preco: 160, ultimo_dividendo: 1.1, dividendos_12m: 13.2, tipo_gestao: "Tijolo", segmento_padrao: "Logística" }],
    ["KNCR11", { preco: 100, ultimo_dividendo: 1.0, dividendos_12m: 12, tipo_gestao: "Papel", segmento_padrao: "Recebíveis (CRI)" }],
    ["XPLG11", { preco: 100, ultimo_dividendo: 0.8, dividendos_12m: 9.6, tipo_gestao: "Tijolo", segmento_padrao: "Logística" }],
  ]);
  const posicoes = calcularPosicoes([
    op({ id: 1, quantidade: 10, preco: 150 }),                      // HGLG: custo 1.500, vale 1.600
    op({ id: 2, ticker: "KNCR11", quantidade: 20, preco: 110 }),    // custo 2.200, vale 2.000
    op({ id: 3, ticker: "XPLG11", quantidade: 4, preco: 100 }),     // custo 400, vale 400
    op({ id: 4, ticker: "SUMIU11", quantidade: 5, preco: 50 }),     // sem preço no site
  ]);
  const r = resumirCarteira(posicoes, info);
  assert.equal(r.custo, 1500 + 2200 + 400 + 250);
  assert.equal(r.valor, 4000);
  assert.equal(r.resultado, 4000 - 4100);                            // só fundos com preço
  assert.equal(Math.round(r.resultadoPct! * 100) / 100, -2.44);
  assert.equal(Math.round(r.rendaMensal * 100) / 100, 11 + 20 + 3.2);
  assert.equal(Math.round(r.renda12m * 100) / 100, 132 + 240 + 38.4);
  assert.equal(Math.round(r.yocPct! * 100) / 100, Math.round(410.4 / 4350 * 10000) / 100);
  assert.equal(Math.round(r.dyAtualPct! * 100) / 100, 10.26);
  assert.deepEqual(r.semPreco, ["SUMIU11"]);
  const hglg = r.linhas.find((l) => l.ticker === "HGLG11")!;
  assert.equal(hglg.resultado, 100);
  assert.equal(Math.round(hglg.yocPct! * 100) / 100, 8.8);           // 13,20 ÷ 150
  assert.equal(hglg.pesoPct, 40);
  assert.deepEqual(r.linhas.map((l) => l.ticker), ["KNCR11", "HGLG11", "XPLG11", "SUMIU11"]);  // por valor
  // empate no valor: ordem alfabética
  assert.deepEqual(r.porSegmento.map((f) => [f.nome, f.valor, f.pct, f.fundos]),
    [["Logística", 2000, 50, 2], ["Recebíveis (CRI)", 2000, 50, 1]]);
  assert.deepEqual(r.porTipo.map((f) => [f.nome, f.pct]), [["Papel", 50], ["Tijolo", 50]]);
});

test("resumo de carteira vazia ou zerada", () => {
  const r = resumirCarteira(calcularPosicoes([op({ id: 1 }), op({ id: 2, tipo: "venda", data: "2026-02-01" })]), new Map());
  assert.equal(r.linhas.length, 0);
  assert.equal(r.valor, 0);
  assert.equal(r.resultadoPct, null);
  assert.equal(r.yocPct, null);
  assert.deepEqual(r.porSegmento, []);
});
