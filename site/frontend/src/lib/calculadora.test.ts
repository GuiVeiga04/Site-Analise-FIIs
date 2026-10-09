// Testes da calculadora. Rodar com:  npm test
// (usa só o Node: node --experimental-strip-types --test)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calcularMeta, calcularNumeroMagico, lerNumero, limitarTaxa, simular, simularHistorico, mediaMensal12m, montarPosicao, rendaMedia12m, rendaMensalConstante,
} from "./calculadora.ts";

test("entrada: números no formato brasileiro", () => {
  assert.equal(lerNumero("10.000"), 10000);       // milhar com ponto
  assert.equal(lerNumero("1.500.000"), 1500000);
  assert.equal(lerNumero("1.234,56"), 1234.56);
  assert.equal(lerNumero("9,16"), 9.16);
  assert.equal(lerNumero("9.16"), 9.16);          // ponto decimal (não é milhar)
  assert.equal(lerNumero("R$ 500"), 500);
  assert.equal(lerNumero("0,0995"), 0.0995);
  assert.ok(Number.isNaN(lerNumero("")));
  assert.ok(Number.isNaN(lerNumero("abc")));
});

test("bloco 1: valor compra só cotas inteiras e sobra o troco", () => {
  assert.deepEqual(montarPosicao("valor", 1000, 9.03), { cotas: 110, valorAplicado: 993.3, sobra: 6.7 });
});

test("bloco 1: divisão exata não perde uma cota por ponto flutuante", () => {
  assert.equal(montarPosicao("valor", 1000, 10).cotas, 100);
  assert.equal(montarPosicao("valor", 0.3, 0.1).cotas, 3);
});

test("bloco 1: modo cotas usa a quantidade informada", () => {
  assert.deepEqual(montarPosicao("cotas", 50, 147.6), { cotas: 50, valorAplicado: 7380, sobra: 0 });
  assert.equal(montarPosicao("cotas", 12.9, 10).cotas, 12);
});

test("bloco 1: valor menor que uma cota não compra nada", () => {
  assert.deepEqual(montarPosicao("valor", 100, 147.6), { cotas: 0, valorAplicado: 0, sobra: 100 });
});

test("bloco 1: entradas inválidas zeram a posição", () => {
  assert.equal(montarPosicao("valor", 1000, 0).cotas, 0);
  assert.equal(montarPosicao("valor", -5, 10).cotas, 0);
  assert.equal(montarPosicao("cotas", Number.NaN, 10).cotas, 0);
});

test("bloco 1: renda pelo último dividendo (repete todo mês)", () => {
  const pos = montarPosicao("cotas", 100, 9);
  const r = rendaMensalConstante(pos, 0.1)!;
  assert.equal(r.mensal, 10);
  assert.equal(r.anual, 120);
  assert.ok(Math.abs(r.yieldSobreCusto! - 13.3333) < 0.001); // 120 / 900
});

test("bloco 1: renda pela soma real de 12 meses (média mensal)", () => {
  const pos = montarPosicao("cotas", 10, 100);
  const r = rendaMedia12m(pos, 9.6)!; // pagou R$ 9,60 por cota em 12 meses
  assert.equal(r.anual, 96);
  assert.equal(r.mensal, 8);
  assert.ok(Math.abs(r.porCota - 0.8) < 1e-9); // 9,60 / 12 (não arredondado)
  assert.ok(Math.abs(r.yieldSobreCusto! - 9.6) < 1e-9);
});

test("bloco 1: sem dado de rendimento não inventa número", () => {
  const pos = montarPosicao("cotas", 10, 100);
  assert.equal(rendaMensalConstante(pos, null), null);
  assert.equal(rendaMedia12m(pos, undefined), null);
});

test("bloco 1: sem cotas o yield fica vazio, não infinito", () => {
  const pos = montarPosicao("valor", 50, 100);
  assert.equal(rendaMensalConstante(pos, 1)!.yieldSobreCusto, null);
});

test("bloco 2: meta exata não pede cota a mais", () => {
  // R$ 1.000/mês com R$ 0,10 por cota: exatamente 10.000 cotas
  const m = calcularMeta(1000, 0.1, 9.16)!;
  assert.equal(m.cotas, 10000);
  assert.equal(m.capital, 91600);
  assert.equal(m.rendaObtida, 1000);
});

test("bloco 2: arredonda cotas para cima e a renda fica >= meta", () => {
  // R$ 500 com R$ 1,17 por cota: 427,35... -> 428 cotas
  const m = calcularMeta(500, 1.17, 147.6)!;
  assert.equal(m.cotas, 428);
  assert.equal(m.capital, 63172.8);   // 428 x 147,60
  assert.equal(m.rendaObtida, 500.76); // 428 x 1,17
  assert.ok(m.rendaObtida >= 500);
  assert.ok(Math.abs(m.dyMensal - 0.79268) < 0.0001); // 1,17 / 147,60
});

test("bloco 2: média de 12 meses vira rendimento mensal (soma / 12)", () => {
  assert.ok(Math.abs(mediaMensal12m(1.1944)! - 0.099533) < 1e-6);
  assert.equal(mediaMensal12m(null), null);
});

test("bloco 2: entradas sem sentido devolvem null", () => {
  assert.equal(calcularMeta(0, 0.1, 10), null);
  assert.equal(calcularMeta(1000, 0, 10), null);     // fundo sem rendimento
  assert.equal(calcularMeta(1000, null, 10), null);
  assert.equal(calcularMeta(1000, 0.1, 0), null);
  assert.equal(calcularMeta(Number.NaN, 0.1, 10), null);
});

test("bloco 3: número mágico do HGLG11 (conferido à mão)", () => {
  // 150,30 / 1,17 = 128,46 -> 129 cotas; 129 x 1,17 = 150,93 >= 150,30
  const n = calcularNumeroMagico(150.3, 1.17)!;
  assert.equal(n.cotas, 129);
  assert.equal(n.capital, 19388.7);
  assert.equal(n.rendaMensal, 150.93);
  assert.ok(n.rendaMensal >= 150.3);
  // com uma cota a menos a renda NÃO compra uma cota
  assert.ok(128 * 1.17 < 150.3);
});

test("bloco 3: divisão exata não pede cota a mais", () => {
  assert.equal(calcularNumeroMagico(10, 0.1)!.cotas, 100);
});

test("bloco 3: quanto falta a partir das cotas que já tenho", () => {
  const n = calcularNumeroMagico(9.16, 0.1, 40)!; // 92 cotas no total
  assert.equal(n.cotas, 92);
  assert.equal(n.faltamCotas, 52);
  assert.equal(n.faltamCapital, 476.32); // 52 x 9,16
  assert.equal(calcularNumeroMagico(9.16, 0.1, 500)!.faltamCotas, 0); // já atingiu
});

test("bloco 3: sem rendimento não existe número mágico", () => {
  assert.equal(calcularNumeroMagico(100, 0), null);
  assert.equal(calcularNumeroMagico(0, 1), null);
});

const base = { preco: 10, rendimentoMensalPorCota: 0.1, aporteInicial: 1000, aporteMensal: 0, meses: 2, reinvestir: true };

test("bloco 4: dois meses conferidos à mão (reinvestindo)", () => {
  // mês 0: 1000 / 10 = 100 cotas
  // mês 1: renda 100 x 0,10 = 10,00 -> compra 1 cota -> 101 cotas, caixa 0
  // mês 2: renda 101 x 0,10 = 10,10 -> compra 1 cota -> 102 cotas, caixa 0,10
  const r = simular(base)!;
  assert.deepEqual(r.meses.map((m) => m.cotas), [100, 101, 102]);
  assert.ok(Math.abs(r.final.caixa - 0.1) < 1e-9);
  assert.ok(Math.abs(r.final.patrimonio - 1020.1) < 1e-9);
  assert.ok(Math.abs(r.final.totalRendimentos - 20.1) < 1e-9);
  assert.ok(Math.abs(r.final.rendaMes - 10.1) < 1e-9);
  assert.equal(r.final.totalAportado, 1000);
});

test("bloco 4: sem reinvestir, os rendimentos não compram cotas", () => {
  const r = simular({ ...base, reinvestir: false, meses: 12 })!;
  assert.equal(r.final.cotas, 100);
  assert.ok(Math.abs(r.final.totalRendimentos - 120) < 1e-9); // 12 x 10 recebidos e "sacados"
  assert.equal(r.final.patrimonio, 1000);
});

test("bloco 4: aporte mensal entra todo mês e o troco acumula", () => {
  // aporte de 15 com cota de 10: compra 1 e sobra 5; no mês seguinte 5 + 15 = 20 -> 2 cotas
  const r = simular({ ...base, aporteInicial: 0, aporteMensal: 15, rendimentoMensalPorCota: 0, meses: 2 })!;
  assert.deepEqual(r.meses.map((m) => m.cotas), [0, 1, 3]);
  assert.equal(r.final.caixa, 0);
  assert.equal(r.final.totalAportado, 30);
});

test("bloco 4: reinvestir sempre dá patrimônio e renda maiores no longo prazo", () => {
  const p = { preco: 150.3, rendimentoMensalPorCota: 1.1175, aporteInicial: 10000, aporteMensal: 1000, meses: 120 };
  const com = simular({ ...p, reinvestir: true })!;
  const sem = simular({ ...p, reinvestir: false })!;
  assert.ok(com.final.patrimonio > sem.final.patrimonio);
  assert.ok(com.final.rendaMes > sem.final.rendaMes);
  assert.equal(com.final.totalAportado, sem.final.totalAportado); // mesmo dinheiro do bolso
  assert.equal(com.final.totalAportado, 10000 + 1000 * 120);
});

test("bloco 4: número mágico é atingido quando a renda do mês paga 1 cota", () => {
  // 129 cotas de HGLG11 é o número mágico do bloco 3: começar com 129 atinge no mês 1
  const r = simular({ preco: 150.3, rendimentoMensalPorCota: 1.17, aporteInicial: 129 * 150.3, aporteMensal: 0, meses: 3, reinvestir: true })!;
  assert.equal(r.mesNumeroMagico, 1);
  assert.equal(calcularNumeroMagico(150.3, 1.17)!.cotas, 129);
  const antes = simular({ preco: 150.3, rendimentoMensalPorCota: 1.17, aporteInicial: 128 * 150.3, aporteMensal: 0, meses: 1, reinvestir: false })!;
  assert.equal(antes.mesNumeroMagico, null); // 128 cotas não chega
});

test("bloco 4: valorização, crescimento do rendimento e inflação usam taxa mensal equivalente", () => {
  const r = simular({ ...base, aporteInicial: 0, meses: 12, rendimentoMensalPorCota: 0,
    valorizacaoPrecoAnual: 12, inflacaoAnual: 10 })!;
  // depois de 12 meses o preço acumulou exatamente +12%
  assert.ok(Math.abs(r.meses[12].preco * Math.pow(1.12, 1 / 12) - 11.2) < 1e-9);
  const r2 = simular({ ...base, meses: 12, reinvestir: false, inflacaoAnual: 10 })!;
  assert.ok(Math.abs(r2.final.patrimonioReal - 1000 / 1.1) < 1e-9); // R$ 1.000 daqui a 1 ano valem 909 de hoje
  const r3 = simular({ ...base, meses: 13, reinvestir: false, crescimentoRendimentoAnual: 10 })!;
  assert.ok(Math.abs(r3.meses[13].rendaMes - 100 * 0.1 * 1.1) < 1e-9); // no mês 13 o rendimento já subiu 10%
});

test("bloco 4: entradas inválidas e limites", () => {
  assert.equal(simular({ ...base, preco: 0 }), null);
  assert.equal(simular({ ...base, meses: 10000 })!.meses.length, 601); // no máximo 50 anos
  assert.equal(simular({ ...base, meses: -3 })!.meses.length, 1);
});

test("robustez: entradas extremas nunca geram NaN nem infinito", () => {
  const b4 = { preco: 150, rendimentoMensalPorCota: 1.1, aporteInicial: 10000, aporteMensal: 1000, meses: 120, reinvestir: true };
  const extremos = [
    { crescimentoRendimentoAnual: -150 }, { valorizacaoPrecoAnual: -100 }, { valorizacaoPrecoAnual: -150 },
    { inflacaoAnual: -100 }, { inflacaoAnual: -150 }, { valorizacaoPrecoAnual: 5000, meses: 600 },
    { aporteMensal: Number.NaN }, { aporteInicial: -5 },
  ];
  for (const e of extremos) {
    const r = simular({ ...b4, ...e });
    if (r === null) continue; // recusar é aceitável; o que não pode é número inválido na tela
    const f = r.final;
    for (const v of [f.cotas, f.patrimonio, f.patrimonioReal, f.rendaMes, f.preco, f.totalAportado]) {
      assert.ok(Number.isFinite(v), `${JSON.stringify(e)} gerou ${v}`);
    }
  }
});

test("robustez: rendimento implausível ou infinito é rejeitado em todos os blocos", () => {
  // 115 por cota de R$ 150 (erro de digitação de 1,15): mais de 20% ao mês
  assert.equal(simular({ preco: 150, rendimentoMensalPorCota: 115, aporteInicial: 1000, aporteMensal: 0, meses: 12, reinvestir: true }), null);
  assert.equal(simular({ preco: 150, rendimentoMensalPorCota: Infinity, aporteInicial: 1000, aporteMensal: 0, meses: 12, reinvestir: true }), null);
  assert.equal(calcularMeta(1000, 115, 150), null);
  assert.equal(calcularMeta(1000, Infinity, 150), null);
  assert.equal(calcularNumeroMagico(150, 115), null);
  assert.equal(rendaMensalConstante(montarPosicao("cotas", 10, 150), Infinity), null);
  // 20% ao mês ainda é aceito (limite)
  assert.ok(calcularMeta(1000, 30, 150));
});

test("robustez: taxas anuais são limitadas a [-50%, +100%]", () => {
  assert.equal(limitarTaxa(-150), -50);
  assert.equal(limitarTaxa(500), 100);
  assert.equal(limitarTaxa(Number.NaN), 0);
  assert.equal(limitarTaxa(8), 8);
});

test("robustez: lerNumero nunca devolve infinito", () => {
  assert.ok(Number.isNaN(lerNumero("Infinity")));
  assert.ok(Number.isNaN(lerNumero("1e999")));
  assert.equal(lerNumero("1e3"), 1000);
});

// Série pequena e conferível à mão para o bloco 5
const PRECOS = [
  { data: "2026-01-02", preco: 10 }, { data: "2026-01-05", preco: 10 },
  { data: "2026-02-02", preco: 10 }, { data: "2026-03-02", preco: 11 },
];
const PROVENTOS = [
  { dataEx: "2026-01-02", valor: 0.1 },  // data-ex no dia da compra: NÃO recebe
  { dataEx: "2026-02-02", valor: 0.1 },
  { dataEx: "2026-03-02", valor: 0.1 },
];

test("bloco 5: reinvestindo, conferido à mão", () => {
  // compra 02/01: R$ 1.000 / 10 = 100 cotas
  // 02/02: 100 x 0,10 = 10,00 -> compra 1 cota a 10 -> 101 cotas, caixa 0
  // 02/03: 101 x 0,10 = 10,10 -> cota a 11 não cabe -> caixa 10,10
  // final: 101 x 11 + 10,10 = 1.121,10 -> retorno 12,11%
  const r = simularHistorico(PRECOS, PROVENTOS, "2026-01-02", "valor", 1000, true)!;
  assert.equal(r.dataCompra, "2026-01-02");
  assert.equal(r.cotasIniciais, 100);
  assert.equal(r.pagamentos.length, 2);              // o de 02/01 ficou de fora
  assert.equal(r.cotasFinais, 101);
  assert.ok(Math.abs(r.caixa - 10.1) < 1e-9);
  assert.ok(Math.abs(r.rendimentosRecebidos - 20.1) < 1e-9);
  assert.ok(Math.abs(r.valorFinal - 1121.1) < 1e-9);
  assert.ok(Math.abs(r.retornoTotalPct - 12.11) < 1e-9);
  assert.ok(Math.abs(r.variacaoPrecoPct - 10) < 1e-9);
});

test("bloco 5: sem reinvestir, rendimentos ficam somados à parte", () => {
  // 100 cotas o tempo todo: 2 x R$ 10 recebidos; 100 x 11 + 20 = 1.120 -> 12%
  const r = simularHistorico(PRECOS, PROVENTOS, "2026-01-02", "valor", 1000, false)!;
  assert.equal(r.cotasFinais, 100);
  assert.ok(Math.abs(r.rendimentosRecebidos - 20) < 1e-9);
  assert.ok(Math.abs(r.valorFinal - 1120) < 1e-9);
  assert.ok(Math.abs(r.retornoTotalPct - 12) < 1e-9);
});

test("bloco 5: data sem pregão vai para o próximo pregão; data-ex depois da compra recebe", () => {
  // pede sábado 03/01 -> compra segunda 05/01; agora o provento de 02/01 continua fora
  const r = simularHistorico(PRECOS, PROVENTOS, "2026-01-03", "cotas", 50, false)!;
  assert.equal(r.dataCompra, "2026-01-05");
  assert.equal(r.capitalInicial, 500);
  assert.equal(r.pagamentos.length, 2);
  // comprando 1 dia ANTES da data-ex (31/12, aqui o 1º pregão é 02/01) também não recebe a de 02/01
  const r2 = simularHistorico([{ data: "2025-12-31", preco: 10 }, ...PRECOS], PROVENTOS, "2025-12-31", "cotas", 10, false)!;
  assert.equal(r2.pagamentos.length, 3);              // agora recebe também a de 02/01
});

test("bloco 5: série do patrimônio começa na compra e termina no valor final", () => {
  const r = simularHistorico(PRECOS, PROVENTOS, "2026-01-02", "valor", 1000, true)!;
  assert.equal(r.serie[0].data, "2026-01-02");
  assert.equal(r.serie[0].patrimonio, 1000);
  assert.ok(Math.abs(r.serie[r.serie.length - 1].patrimonio - r.valorFinal) < 1e-9);
});

test("bloco 5: casos sem resultado", () => {
  assert.equal(simularHistorico(PRECOS, PROVENTOS, "2026-03-02", "valor", 1000, true), null); // compra no último dia
  assert.equal(simularHistorico(PRECOS, PROVENTOS, "2027-01-01", "valor", 1000, true), null); // depois do último pregão
  assert.equal(simularHistorico(PRECOS, PROVENTOS, "2026-01-02", "valor", 5, true), null);    // não compra 1 cota
  assert.equal(simularHistorico([], PROVENTOS, "2026-01-02", "valor", 1000, true), null);
});
