/**
 * Planilhas da carteira (CSV): exportar operações/posição e importar operações.
 * Funções puras, testadas em csvCarteira.test.ts.
 *
 * Exportação no padrão do Excel em português: separador ";", vírgula decimal e
 * BOM no início (para o Excel reconhecer os acentos).
 * Importação aceita ";" "," ou tabulação, datas 31/12/2025 ou 2025-12-31,
 * números 1.234,56 ou 1234.56 e os nomes de coluna mais comuns, inclusive os do
 * extrato de negociação da B3 (Data do Negócio, Tipo de Movimentação, Código de
 * Negociação, Quantidade, Preço).
 */
import { lerNumero } from "./calculadora.ts";
import type { Operacao, Posicao } from "./carteira.ts";

const BOM = "﻿";
const num = (v: number, casas = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas, useGrouping: false });
const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const celula = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const linhaCsv = (cols: string[]) => cols.map(celula).join(";");

export function exportarOperacoesCsv(ops: Operacao[]): string {
  const linhas = [linhaCsv(["Data", "Tipo", "Fundo", "Quantidade", "Preco", "Total"])];
  for (const o of [...ops].sort((a, b) => a.data.localeCompare(b.data) || (a.id ?? 0) - (b.id ?? 0))) {
    linhas.push(linhaCsv([dataBr(o.data), o.tipo === "compra" ? "Compra" : "Venda", o.ticker, String(o.quantidade), num(o.preco), num(o.quantidade * o.preco)]));
  }
  return BOM + linhas.join("\r\n") + "\r\n";
}

export function exportarPosicaoCsv(posicoes: (Posicao & { precoAtual?: number | null; valorAtual?: number | null })[]): string {
  const linhas = [linhaCsv(["Fundo", "Cotas", "Preco medio", "Custo", "Preco atual", "Valor atual"])];
  for (const p of posicoes.filter((x) => x.quantidade > 0)) {
    linhas.push(linhaCsv([p.ticker, String(p.quantidade), num(p.precoMedio), num(p.custo),
      p.precoAtual != null ? num(p.precoAtual) : "", p.valorAtual != null ? num(p.valorAtual) : ""]));
  }
  return BOM + linhas.join("\r\n") + "\r\n";
}

export const MODELO_CSV = BOM + "Data;Tipo;Fundo;Quantidade;Preco\r\n10/03/2026;Compra;HGLG11;10;155,50\r\n01/07/2026;Venda;HGLG11;5;170,00\r\n";

/** Quebra o texto em linhas e colunas (aspas duplas, separador detectado). */
export function lerTabela(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const primeira = t.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const contar = (c: string) => primeira.split(c).length - 1;
  const sep = [";", "\t", ","].reduce((melhor, c) => (contar(c) > contar(melhor) ? c : melhor), ";");
  const linhas: string[][] = [];
  let campo = "", linha: string[] = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"' && t[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      if (linha.some((c) => c.trim())) linhas.push(linha);
      linha = [];
    } else campo += ch;
  }
  linha.push(campo);
  if (linha.some((c) => c.trim())) linhas.push(linha);
  return linhas;
}

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES: Record<"data" | "tipo" | "ticker" | "quantidade" | "preco", string[]> = {
  data: ["data", "datadonegocio", "datanegocio", "datadaoperacao", "dataoperacao", "datapregao", "date", "dt"],
  tipo: ["tipo", "tipodemovimentacao", "tipomovimentacao", "movimentacao", "operacao", "compraevenda", "compravenda", "cv", "natureza", "entradasaida"],
  ticker: ["fundo", "ticker", "ativo", "codigo", "codigodenegociacao", "codigonegociacao", "papel", "produto", "fii", "codigoativo"],
  quantidade: ["quantidade", "qtd", "qtde", "quant", "cotas", "quantidadedecotas"],
  preco: ["preco", "precounitario", "precoporcota", "precodecompra", "valorunitario", "precomedio", "cotacao", "preco unitario", "preo"],
};

export interface LinhaImportada {
  linha: number;             // número da linha na planilha (1 = cabeçalho)
  op: Operacao | null;
  erro: string | null;
}

function lerData(v: string): string | null {
  const t = v.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
    const iso = `${ano}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    const d = new Date(iso + "T12:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
  }
  return null;
}

function lerTipo(v: string | undefined): "compra" | "venda" | null {
  const t = normalizar(v ?? "");
  if (!t) return "compra";
  if (t.startsWith("c") || t === "credito" || t === "entrada") return "compra";
  if (t.startsWith("v") || t === "debito" || t === "saida") return "venda";
  return null;
}

/** "HGLG11F" (fracionário), "HGLG11 - CSHG LOGÍSTICA" e "hglg11" viram "HGLG11". */
export function lerTicker(v: string): string {
  const t = v.trim().toUpperCase().split(/[\s-]/)[0] ?? "";
  return /^[A-Z]{4}1[1-3]F$/.test(t) ? t.slice(0, -1) : t;
}

/** Lê a planilha e devolve uma linha por operação, com o erro de formato quando houver.
 *  (As regras de carteira, como vender sem ter cotas, são conferidas depois.) */
export function lerCsvOperacoes(texto: string): { linhas: LinhaImportada[]; erroGeral: string | null; semColunaTipo: boolean } {
  const tabela = lerTabela(texto);
  if (tabela.length < 2) return { linhas: [], erroGeral: "A planilha está vazia ou só tem o cabeçalho.", semColunaTipo: false };
  const cab = tabela[0].map(normalizar);
  const col = Object.fromEntries(
    (Object.keys(ALIASES) as (keyof typeof ALIASES)[]).map((k) => [k, cab.findIndex((c) => ALIASES[k].map(normalizar).includes(c))]),
  ) as Record<keyof typeof ALIASES, number>;
  const faltando = (["data", "ticker", "quantidade", "preco"] as const).filter((k) => col[k] < 0);
  if (faltando.length) {
    const nomes = { data: "Data", ticker: "Fundo", quantidade: "Quantidade", preco: "Preço" };
    return {
      linhas: [], semColunaTipo: false,
      erroGeral: `Não achei a(s) coluna(s): ${faltando.map((f) => nomes[f]).join(", ")}. O cabeçalho precisa ter Data, Tipo, Fundo, Quantidade e Preço (baixe o modelo).`,
    };
  }
  const linhas: LinhaImportada[] = tabela.slice(1).map((cols, i) => {
    const linha = i + 2;
    const data = lerData(cols[col.data] ?? "");
    const tipo = lerTipo(col.tipo >= 0 ? cols[col.tipo] : undefined);
    const ticker = lerTicker(cols[col.ticker] ?? "");
    const quantidade = lerNumero(cols[col.quantidade] ?? "");
    const preco = lerNumero(cols[col.preco] ?? "");
    let erro: string | null = null;
    if (!data) erro = `Data inválida: "${cols[col.data] ?? ""}"`;
    else if (!tipo) erro = `Tipo inválido: "${cols[col.tipo]}" (use Compra ou Venda)`;
    else if (!ticker) erro = "Fundo vazio";
    else if (!Number.isFinite(quantidade)) erro = `Quantidade inválida: "${cols[col.quantidade] ?? ""}"`;
    else if (!Number.isFinite(preco)) erro = `Preço inválido: "${cols[col.preco] ?? ""}"`;
    if (erro) return { linha, op: null, erro };
    return { linha, op: { ticker, tipo: tipo!, data: data!, quantidade: Math.abs(quantidade), preco: Math.round(Math.abs(preco) * 100) / 100 }, erro: null };
  });
  return { linhas, erroGeral: null, semColunaTipo: col.tipo < 0 };
}

/** Mesma operação (fundo, tipo, data, quantidade e preço) já cadastrada? */
export const mesmaOperacao = (a: Operacao, b: Operacao) =>
  a.ticker === b.ticker && a.tipo === b.tipo && a.data === b.data && a.quantidade === b.quantidade && Math.abs(a.preco - b.preco) < 0.005;
