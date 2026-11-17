/**
 * Imposto de Renda de FII para pessoa física (regras em vigor, regra geral):
 *
 * - Rendimento mensal: isento (fundo com 100+ cotistas, negociado em bolsa,
 *   cotista com menos de 10% das cotas). Vai em "Rendimentos isentos".
 * - Lucro na VENDA de cotas: 20%, sem a isenção de R$ 20 mil das ações.
 *   Apuração mensal; prejuízo em venda de FII compensa lucro de FII em meses
 *   seguintes, sem prazo. DARF código 6015, até o último dia útil do mês
 *   seguinte. DARF abaixo de R$ 10 não se paga: soma ao do próximo mês.
 * - IRRF "dedo-duro": a corretora retém 0,005% do valor vendido e esse valor
 *   abate o imposto do mês (o que sobrar abate os meses seguintes do ano).
 *
 * Simplificações: operações comuns (não day trade) e sem custos de corretagem.
 * Não é consultoria tributária: confira com o informe da corretora.
 * Funções puras, testadas em impostoRenda.test.ts.
 */
import { calcularPosicoes, ordenar, type Operacao, type RendimentoRecebido } from "./carteira.ts";

export const ALIQUOTA_FII = 0.2;
export const IRRF_VENDA = 0.00005;
export const DARF_MINIMO = 10;
export const CODIGO_DARF = "6015";
export const BENS_GRUPO = "07";
export const BENS_CODIGO = "03";

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface Venda {
  data: string; ticker: string; quantidade: number; preco: number;
  precoMedio: number; valor: number; lucro: number;
}

/** Cada venda com o preço médio da hora e o lucro (ou prejuízo). */
export function vendasRealizadas(ops: Operacao[]): Venda[] {
  const pos = new Map<string, { q: number; custo: number }>();
  const vendas: Venda[] = [];
  for (const o of ordenar(ops)) {
    const p = pos.get(o.ticker) ?? { q: 0, custo: 0 };
    if (o.tipo === "compra") { p.q += o.quantidade; p.custo += o.quantidade * o.preco; }
    else {
      const pm = p.q > 0 ? p.custo / p.q : 0;
      const q = Math.min(o.quantidade, p.q);
      vendas.push({ data: o.data, ticker: o.ticker, quantidade: q, preco: o.preco, precoMedio: pm, valor: q * o.preco, lucro: q * (o.preco - pm) });
      p.custo -= q * pm; p.q -= q;
      if (p.q === 0) p.custo = 0;
    }
    pos.set(o.ticker, p);
  }
  return vendas;
}

// ---- dias úteis (feriados nacionais + 31/12, sem expediente bancário) ----

function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const somarDias = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export function feriados(ano: number): Set<string> {
  const fixos = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25", "12-31"].map((md) => `${ano}-${md}`);
  const p = pascoa(ano);
  const moveis = [-48, -47, -2, 60].map((n) => iso(somarDias(p, n)));   // carnaval (seg e ter), sexta santa, Corpus Christi
  return new Set([...fixos, ...moveis]);
}

/** Último dia útil de um mês (YYYY-MM). */
export function ultimoDiaUtil(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  const fer = feriados(a);
  let d = new Date(Date.UTC(a, m, 0));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || fer.has(iso(d))) d = somarDias(d, -1);
  return iso(d);
}

export const mesSeguinte = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 7);
};

// ---- apuração mensal ----

export interface MesApuracao {
  mes: string;                 // YYYY-MM
  vendido: number;             // valor total das vendas
  lucro: number;               // soma de lucros e prejuízos das vendas do mês
  prejuizoAnterior: number;    // prejuízo acumulado que vinha de meses anteriores
  prejuizoCompensado: number;
  base: number;                // lucro tributável depois da compensação
  impostoDevido: number;       // 20% da base
  irrfMes: number;             // 0,005% retido pela corretora neste mês
  irrfUsado: number;           // IRRF (deste mês e sobras do ano) que abateu o imposto
  residualAnterior: number;    // DARF abaixo de R$ 10 que vinha acumulado
  aPagar: number;              // DARF a pagar (0 se abaixo do mínimo)
  acumulaProximo: number;      // valor abaixo de R$ 10 que passa para o próximo DARF
  prejuizoAcumulado: number;   // prejuízo que sobra para os meses seguintes
  vencimento: string | null;   // último dia útil do mês seguinte (se há DARF)
}

export function apurarMeses(vendas: Venda[]): MesApuracao[] {
  const porMes = new Map<string, Venda[]>();
  for (const v of vendas) porMes.set(v.data.slice(0, 7), [...(porMes.get(v.data.slice(0, 7)) ?? []), v]);
  let prejuizo = 0, residual = 0, irrfSobra = 0, anoSobra = "";
  const meses: MesApuracao[] = [];
  for (const mes of [...porMes.keys()].sort()) {
    const vs = porMes.get(mes)!;
    if (mes.slice(0, 4) !== anoSobra) { irrfSobra = 0; anoSobra = mes.slice(0, 4); }   // sobra de IRRF vai para a declaração do ano
    const vendido = r2(vs.reduce((s, v) => s + v.valor, 0));
    const lucro = r2(vs.reduce((s, v) => s + v.lucro, 0));
    const prejuizoAnterior = r2(prejuizo);
    let compensado = 0, base = 0;
    if (lucro > 0) { compensado = Math.min(lucro, prejuizo); base = lucro - compensado; prejuizo -= compensado; }
    else prejuizo += -lucro;
    const devido = r2(base * ALIQUOTA_FII);
    const irrfMes = r2(vendido * IRRF_VENDA);
    const irrfDisp = irrfSobra + irrfMes;
    const irrfUsado = r2(Math.min(devido, irrfDisp));
    irrfSobra = r2(irrfDisp - irrfUsado);
    const residualAnterior = r2(residual);
    const liquido = r2(devido - irrfUsado + residual);
    const aPagar = liquido >= DARF_MINIMO ? liquido : 0;
    residual = aPagar ? 0 : liquido;
    meses.push({
      mes, vendido, lucro, prejuizoAnterior, prejuizoCompensado: r2(compensado), base: r2(base), impostoDevido: devido,
      irrfMes, irrfUsado, residualAnterior, aPagar, acumulaProximo: r2(residual), prejuizoAcumulado: r2(prejuizo),
      vencimento: aPagar ? ultimoDiaUtil(mesSeguinte(mes)) : null,
    });
  }
  return meses;
}

/** DARFs com vencimento de hoje em diante (ou vencidos há menos de 60 dias), para o aviso no topo. */
export function darfsProximos(meses: MesApuracao[], hoje: string): MesApuracao[] {
  const limite = iso(somarDias(new Date(hoje + "T00:00:00Z"), -60));
  return meses.filter((m) => m.aPagar > 0 && m.vencimento && m.vencimento >= limite);
}

// ---- declaração anual ----

export interface InfoIR { nome: string; cnpj: string | null }

export interface BemDireito {
  ticker: string; nome: string; cnpj: string | null;
  quantidadeAnterior: number; custoAnterior: number;   // 31/12 do ano anterior
  quantidade: number; custo: number;                    // 31/12 do ano
  discriminacao: string;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function bensEDireitos(ops: Operacao[], ano: number, info: Map<string, InfoIR>): BemDireito[] {
  const antes = new Map(calcularPosicoes(ops.filter((o) => o.data <= `${ano - 1}-12-31`)).map((p) => [p.ticker, p]));
  const fim = new Map(calcularPosicoes(ops.filter((o) => o.data <= `${ano}-12-31`)).map((p) => [p.ticker, p]));
  const tickers = [...new Set([...antes.keys(), ...fim.keys()])]
    .filter((t) => (antes.get(t)?.quantidade ?? 0) > 0 || (fim.get(t)?.quantidade ?? 0) > 0).sort();
  return tickers.map((t) => {
    const a = antes.get(t), f = fim.get(t);
    const i = info.get(t) ?? { nome: t, cnpj: null };
    const q = f?.quantidade ?? 0;
    const discriminacao = q > 0
      ? `${q.toLocaleString("pt-BR")} cotas do fundo imobiliário ${i.nome} (${t})${i.cnpj ? `, CNPJ ${i.cnpj}` : ""}. ` +
        `Preço médio de R$ ${brl(f!.precoMedio)} por cota. Custo total de aquisição: R$ ${brl(f!.custo)}.`
      : `Cotas do fundo imobiliário ${i.nome} (${t})${i.cnpj ? `, CNPJ ${i.cnpj}` : ""}, vendidas integralmente em ${ano}.`;
    return {
      ticker: t, nome: i.nome, cnpj: i.cnpj,
      quantidadeAnterior: a?.quantidade ?? 0, custoAnterior: r2(a?.custo ?? 0),
      quantidade: q, custo: r2(f?.custo ?? 0), discriminacao,
    };
  });
}

/** Rendimentos isentos do ano por fundo (pela data-ex; ver aviso na tela). */
export function rendimentosIsentos(lista: RendimentoRecebido[], ano: number, info: Map<string, InfoIR>) {
  const m = new Map<string, number>();
  for (const r of lista) if (r.dataEx.startsWith(`${ano}-`)) m.set(r.ticker, (m.get(r.ticker) ?? 0) + r.valor);
  return [...m.entries()].map(([ticker, valor]) => ({
    ticker, valor: r2(valor), nome: info.get(ticker)?.nome ?? ticker, cnpj: info.get(ticker)?.cnpj ?? null,
  })).sort((a, b) => b.valor - a.valor);
}

/** As 12 linhas da ficha "Renda variável → Fundos de investimento imobiliário". */
export function fichaFiiAnual(meses: MesApuracao[], ano: number) {
  return Array.from({ length: 12 }, (_, i) => {
    const mes = `${ano}-${String(i + 1).padStart(2, "0")}`;
    const m = meses.find((x) => x.mes === mes);
    return {
      mes,
      resultado: m?.lucro ?? 0,
      prejuizoACompensar: m ? m.prejuizoAnterior : null,
      impostoDevido: m?.impostoDevido ?? 0,
      irrf: m?.irrfMes ?? 0,
      impostoPago: m?.aPagar ?? 0,
    };
  });
}

export function anosDaCarteira(ops: Operacao[], hoje: string): number[] {
  if (!ops.length) return [];
  const primeiro = Number(ops.reduce((m, o) => (o.data < m ? o.data : m), "9999").slice(0, 4));
  const atual = Number(hoje.slice(0, 4));
  return Array.from({ length: atual - primeiro + 1 }, (_, i) => atual - i);
}
