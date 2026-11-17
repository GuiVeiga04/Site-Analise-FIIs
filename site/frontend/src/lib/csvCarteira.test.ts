import assert from "node:assert/strict";
import { test } from "node:test";
import { exportarOperacoesCsv, lerCsvOperacoes, lerTabela, lerTicker, mesmaOperacao, MODELO_CSV } from "./csvCarteira.ts";

test("exporta no padrão do Excel brasileiro", () => {
  const csv = exportarOperacoesCsv([
    { id: 2, ticker: "MXRF11", tipo: "venda", data: "2026-07-01", quantidade: 5, preco: 9.8 },
    { id: 1, ticker: "HGLG11", tipo: "compra", data: "2026-03-10", quantidade: 10, preco: 1155.5 },
  ]);
  assert.ok(csv.startsWith("﻿Data;Tipo;Fundo;Quantidade;Preco;Total\r\n"));
  assert.match(csv, /10\/03\/2026;Compra;HGLG11;10;1155,50;11555,00\r\n01\/07\/2026;Venda;MXRF11;5;9,80;49,00/);
});

test("o modelo e a exportação são lidos de volta", () => {
  const r = lerCsvOperacoes(MODELO_CSV);
  assert.equal(r.erroGeral, null);
  assert.deepEqual(r.linhas.map((l) => l.op), [
    { ticker: "HGLG11", tipo: "compra", data: "2026-03-10", quantidade: 10, preco: 155.5 },
    { ticker: "HGLG11", tipo: "venda", data: "2026-07-01", quantidade: 5, preco: 170 },
  ]);
  const ida = exportarOperacoesCsv([{ ticker: "KNCR11", tipo: "compra", data: "2025-12-31", quantidade: 3, preco: 101.07 }]);
  assert.deepEqual(lerCsvOperacoes(ida).linhas[0].op, { ticker: "KNCR11", tipo: "compra", data: "2025-12-31", quantidade: 3, preco: 101.07 });
});

test("extrato de negociação da B3 salvo como CSV (vírgula, aspas, fracionário)", () => {
  const b3 = 'Data do Negócio,Tipo de Movimentação,Mercado,Prazo/Vencimento,Instituição,Código de Negociação,Quantidade,Preço,Valor\n' +
    '05/02/2026,Compra,Mercado Fracionário,-,XP INVESTIMENTOS,HGLG11F,3,"R$ 158,20","R$ 474,60"\n' +
    '06/02/2026,Venda,Mercado à Vista,-,XP,MXRF11,100,9.75,975.00\n';
  const r = lerCsvOperacoes(b3);
  assert.equal(r.erroGeral, null);
  assert.deepEqual(r.linhas.map((l) => l.op), [
    { ticker: "HGLG11", tipo: "compra", data: "2026-02-05", quantidade: 3, preco: 158.2 },
    { ticker: "MXRF11", tipo: "venda", data: "2026-02-06", quantidade: 100, preco: 9.75 },
  ]);
});

test("erros por linha e coluna faltando", () => {
  const r = lerCsvOperacoes("data;tipo;fundo;qtd;preço\n31/02/2026;C;HGLG11;1;10\n01/03/2026;troca;HGLG11;1;10\n01/03/2026;C;HGLG11;dez;10\n01/03/26;V;xplg11;2;99,9\n");
  assert.deepEqual(r.linhas.map((l) => [l.linha, l.erro?.split(":")[0] ?? null]), [[2, "Data inválida"], [3, "Tipo inválido"], [4, "Quantidade inválida"], [5, null]]);
  assert.deepEqual(r.linhas[3].op, { ticker: "XPLG11", tipo: "venda", data: "2026-03-01", quantidade: 2, preco: 99.9 });
  assert.match(lerCsvOperacoes("Fundo;Qtd\nHGLG11;1\n").erroGeral ?? "", /Data, Preço/);
  assert.match(lerCsvOperacoes("Data;Fundo\n").erroGeral ?? "", /vazia/);
  // sem coluna de tipo: tudo é compra, e a tela avisa
  const semTipo = lerCsvOperacoes("Data;Ativo;Quantidade;Preço Unitário\n2026-01-05;KNCR11;7;100,5\n");
  assert.equal(semTipo.semColunaTipo, true);
  assert.equal(semTipo.linhas[0].op?.tipo, "compra");
});

test("ajudantes", () => {
  assert.deepEqual(lerTabela('a;b\n"x;y";"di""z"\r\n\n'), [["a", "b"], ["x;y", 'di"z']]);
  assert.equal(lerTicker("hglg11f"), "HGLG11");
  assert.equal(lerTicker("XPML11 - XP MALLS"), "XPML11");
  const a = { ticker: "A", tipo: "compra" as const, data: "2026-01-01", quantidade: 1, preco: 10 };
  assert.ok(mesmaOperacao(a, { ...a, id: 9, preco: 10.001 }));
  assert.ok(!mesmaOperacao(a, { ...a, quantidade: 2 }));
});
