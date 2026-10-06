// Testes da calculadora. Rodar com:  npm test
// (usa só o Node: node --experimental-strip-types --test)
import assert from "node:assert/strict";
import { test } from "node:test";
import { lerNumero, montarPosicao, rendaMedia12m, rendaMensalConstante } from "./calculadora.ts";

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
