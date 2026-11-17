import assert from "node:assert/strict";
import { test } from "node:test";
import type { Operacao } from "./carteira.ts";
import {
  anosDaCarteira, apurarMeses, bensEDireitos, darfsProximos, feriados, fichaFiiAnual, rendimentosIsentos, ultimoDiaUtil, vendasRealizadas,
} from "./impostoRenda.ts";

let id = 0;
const op = (o: Partial<Operacao>): Operacao => ({ id: ++id, ticker: "HGLG11", tipo: "compra", data: "2026-01-10", quantidade: 10, preco: 100, ...o });

test("feriados e último dia útil", () => {
  assert.ok(feriados(2026).has("2026-02-16") && feriados(2026).has("2026-02-17"));   // carnaval 2026
  assert.ok(feriados(2026).has("2026-04-03"));                                        // sexta-feira santa
  assert.ok(feriados(2026).has("2026-06-04"));                                        // Corpus Christi
  assert.equal(ultimoDiaUtil("2026-05"), "2026-05-29");   // 30 e 31/05/2026 são sábado e domingo
  assert.equal(ultimoDiaUtil("2026-12"), "2026-12-30");   // 31/12 sem expediente bancário
  assert.equal(ultimoDiaUtil("2026-02"), "2026-02-27");
  assert.equal(ultimoDiaUtil("2027-11"), "2027-11-30");
});

test("lucro na venda pelo preço médio", () => {
  const v = vendasRealizadas([
    op({ quantidade: 10, preco: 100 }), op({ data: "2026-02-01", quantidade: 10, preco: 120 }),   // PM 110
    op({ data: "2026-03-05", tipo: "venda", quantidade: 5, preco: 130 }),
  ]);
  assert.deepEqual(v.map((x) => [x.data, x.quantidade, x.precoMedio, x.valor, x.lucro]), [["2026-03-05", 5, 110, 650, 100]]);
});

test("apuração: 20%, IRRF, prejuízo compensado e DARF mínimo", () => {
  const ops = [
    op({ quantidade: 100, preco: 100 }),
    op({ ticker: "MXRF11", quantidade: 1000, preco: 10 }),
    op({ data: "2026-03-10", tipo: "venda", quantidade: 10, preco: 90 }),                     // −100
    op({ data: "2026-04-10", tipo: "venda", quantidade: 20, preco: 130 }),                    // +600
    op({ data: "2026-05-10", ticker: "MXRF11", tipo: "venda", quantidade: 100, preco: 10.2 }), // +20
  ];
  const m = apurarMeses(vendasRealizadas(ops));
  assert.deepEqual(m.map((x) => x.mes), ["2026-03", "2026-04", "2026-05"]);
  // março: prejuízo, sem imposto
  assert.deepEqual([m[0].lucro, m[0].base, m[0].aPagar, m[0].prejuizoAcumulado, m[0].irrfMes], [-100, 0, 0, 100, 0.05]);
  // abril: 600 − 100 de prejuízo = 500 × 20% = 100; IRRF 0,13 (+0,05 que sobrou de março) = 0,18
  assert.deepEqual([m[1].prejuizoCompensado, m[1].base, m[1].impostoDevido, m[1].irrfUsado, m[1].aPagar], [100, 500, 100, 0.18, 99.82]);
  assert.equal(m[1].vencimento, "2026-05-29");
  // maio: 20 × 20% = 4, menos IRRF 0,05 = 3,95: abaixo de R$ 10, acumula
  assert.deepEqual([m[2].impostoDevido, m[2].aPagar, m[2].acumulaProximo, m[2].vencimento], [4, 0, 3.95, null]);
  assert.equal(darfsProximos(m, "2026-06-10").length, 1);
  assert.equal(darfsProximos(m, "2026-09-10").length, 0);
});

test("DARF pequeno soma ao do mês seguinte", () => {
  const ops = [op({ quantidade: 100, preco: 100 }),
    op({ data: "2026-06-10", tipo: "venda", quantidade: 1, preco: 140 }),    // +40 → 8 (− IRRF 0,01) = 7,99 acumula
    op({ data: "2026-07-10", tipo: "venda", quantidade: 1, preco: 120 })];   // +20 → 4 − 0,01 + 7,99 = 11,98 paga
  const m = apurarMeses(vendasRealizadas(ops));
  assert.deepEqual([m[0].aPagar, m[0].acumulaProximo], [0, 7.99]);
  assert.deepEqual([m[1].residualAnterior, m[1].aPagar, m[1].vencimento], [7.99, 11.98, "2026-08-31"]);
});

test("Bens e Direitos em 31/12, rendimentos isentos e ficha mensal", () => {
  const info = new Map([["HGLG11", { nome: "CSHG Logística", cnpj: "11.728.688/0001-47" }], ["MXRF11", { nome: "Maxi Renda", cnpj: null }]]);
  const ops = [
    op({ data: "2025-06-01", quantidade: 10, preco: 150 }),
    op({ data: "2026-02-01", quantidade: 10, preco: 170 }),                       // PM 160
    op({ ticker: "MXRF11", data: "2025-07-01", quantidade: 100, preco: 10 }),
    op({ ticker: "MXRF11", data: "2026-03-01", tipo: "venda", quantidade: 100, preco: 11 }),
  ];
  const bens = bensEDireitos(ops, 2026, info);
  assert.deepEqual(bens.map((b) => [b.ticker, b.quantidadeAnterior, b.custoAnterior, b.quantidade, b.custo]),
    [["HGLG11", 10, 1500, 20, 3200], ["MXRF11", 100, 1000, 0, 0]]);
  assert.equal(bens[0].discriminacao,
    "20 cotas do fundo imobiliário CSHG Logística (HGLG11), CNPJ 11.728.688/0001-47. Preço médio de R$ 160,00 por cota. Custo total de aquisição: R$ 3.200,00.");
  assert.match(bens[1].discriminacao, /vendidas integralmente em 2026/);
  const isentos = rendimentosIsentos([
    { ticker: "HGLG11", dataEx: "2026-03-02", valorPorCota: 1.1, cotas: 20, valor: 22 },
    { ticker: "HGLG11", dataEx: "2025-12-01", valorPorCota: 1.1, cotas: 10, valor: 11 },
  ], 2026, info);
  assert.deepEqual(isentos, [{ ticker: "HGLG11", valor: 22, nome: "CSHG Logística", cnpj: "11.728.688/0001-47" }]);
  const ficha = fichaFiiAnual(apurarMeses(vendasRealizadas(ops)), 2026);
  assert.equal(ficha.length, 12);
  assert.deepEqual(ficha[2], { mes: "2026-03", resultado: 100, prejuizoACompensar: 0, impostoDevido: 20, irrf: 0.06, impostoPago: 19.94 });
  assert.equal(ficha[0].impostoPago, 0);
  assert.deepEqual(anosDaCarteira(ops, "2026-11-09"), [2026, 2025]);
});
