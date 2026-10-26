/**
 * Carteira: regras puras (sem React, sem Supabase), testadas em carteira.test.ts.
 *
 * Preço médio pelo método usado na declaração de IR: cada compra soma
 * quantidade e custo; cada venda tira cotas ao preço médio da hora (o preço
 * médio não muda na venda). Sem corretagem/emolumentos por enquanto.
 */

export type TipoOperacao = "compra" | "venda";

export interface Operacao {
  id?: number;
  ticker: string;
  tipo: TipoOperacao;
  data: string;        // ISO YYYY-MM-DD
  quantidade: number;  // cotas inteiras
  preco: number;       // R$ por cota
}

export interface Posicao {
  ticker: string;
  quantidade: number;
  precoMedio: number;   // 0 quando a posição foi zerada
  custo: number;        // quantidade × preço médio
  primeiraCompra: string | null;
}

export const PADRAO_TICKER = /^[A-Z]{4}1[1-3]$/;
export const DATA_MINIMA = "1994-01-01"; // os primeiros FIIs são de 1994-95

/** Mesma ordem em que as operações aconteceram: data, depois compra antes de venda
 *  no mesmo dia, depois a ordem de cadastro (id). */
export function ordenar(ops: Operacao[]): Operacao[] {
  return [...ops].sort((a, b) =>
    a.data.localeCompare(b.data)
    || (a.tipo === b.tipo ? 0 : a.tipo === "compra" ? -1 : 1)
    || (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER));
}

/** Posição de cada fundo depois de todas as operações (inclui fundos zerados, com quantidade 0). */
export function calcularPosicoes(ops: Operacao[]): Posicao[] {
  const mapa = new Map<string, Posicao>();
  for (const op of ordenar(ops)) {
    const p = mapa.get(op.ticker) ?? { ticker: op.ticker, quantidade: 0, precoMedio: 0, custo: 0, primeiraCompra: null };
    if (op.tipo === "compra") {
      p.custo += op.quantidade * op.preco;
      p.quantidade += op.quantidade;
      p.primeiraCompra ??= op.data;
    } else {
      const vendidas = Math.min(op.quantidade, p.quantidade);
      p.custo -= vendidas * p.precoMedio;
      p.quantidade -= vendidas;
    }
    p.precoMedio = p.quantidade > 0 ? p.custo / p.quantidade : 0;
    if (p.quantidade === 0) p.custo = 0;
    mapa.set(op.ticker, p);
  }
  return [...mapa.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/** Primeira data em que a quantidade de um fundo ficaria negativa (venda de cotas que
 *  a pessoa ainda não tinha), ou null se a sequência é possível. */
export function primeiraVendaSemCotas(ops: Operacao[], ticker: string): { data: string; faltam: number } | null {
  let qtd = 0;
  for (const op of ordenar(ops.filter((o) => o.ticker === ticker))) {
    qtd += op.tipo === "compra" ? op.quantidade : -op.quantidade;
    if (qtd < 0) return { data: op.data, faltam: -qtd };
  }
  return null;
}

/**
 * Valida uma operação nova ou editada contra as que já existem.
 * `existentes` são as operações salvas; numa edição, a versão antiga (mesmo id) é substituída.
 * Devolve a mensagem de erro, ou null se está tudo certo.
 */
export function validarOperacao(op: Operacao, existentes: Operacao[], tickersValidos: Set<string>, hoje: string): string | null {
  if (!PADRAO_TICKER.test(op.ticker)) return "Escolha um fundo da lista (ex: HGLG11).";
  if (tickersValidos.size && !tickersValidos.has(op.ticker)) return `${op.ticker} não está entre os fundos do site.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(op.data) || Number.isNaN(Date.parse(op.data))) return "Informe a data da operação.";
  if (op.data > hoje) return "A data não pode ser no futuro.";
  if (op.data < DATA_MINIMA) return "Data muito antiga: confira o ano.";
  if (!Number.isInteger(op.quantidade) || op.quantidade <= 0) return "A quantidade precisa ser um número inteiro de cotas, maior que zero.";
  if (op.quantidade > 10_000_000) return "Quantidade grande demais: confira o número.";
  if (!Number.isFinite(op.preco) || op.preco <= 0) return "Informe o preço por cota.";
  if (op.preco > 100_000) return "Preço por cota alto demais: confira o valor.";
  if (Math.round(op.preco * 100) / 100 !== op.preco) return "Use no máximo 2 casas decimais no preço.";

  const outras = existentes.filter((e) => op.id == null || e.id !== op.id);
  const depois = [...outras, op];
  // Uma edição pode mexer em dois fundos (trocou o ticker): confere os dois.
  const antiga = existentes.find((e) => op.id != null && e.id === op.id);
  for (const t of new Set([op.ticker, antiga?.ticker].filter(Boolean) as string[])) {
    const problema = primeiraVendaSemCotas(depois, t);
    if (problema) {
      const dataBr = problema.data.split("-").reverse().join("/");
      return op.tipo === "venda" && t === op.ticker
        ? `Em ${dataBr} você ainda não teria cotas suficientes de ${t} para essa venda (faltariam ${problema.faltam}).`
        : `Com essa mudança, a venda de ${t} em ${dataBr} ficaria sem cotas (faltariam ${problema.faltam}).`;
    }
  }
  return null;
}

/** Fechamento do pregão na data ou no último pregão antes dela (para sugerir o preço). */
export function precoNaData(historico: { data_pregao: string; preco: number | null }[], dataIso: string): { data: string; preco: number } | null {
  let achado: { data: string; preco: number } | null = null;
  for (const p of historico) {
    if (p.data_pregao > dataIso) break;
    if (p.preco != null && p.preco > 0) achado = { data: p.data_pregao, preco: p.preco };
  }
  // Só sugere se o pregão encontrado for de até 7 dias antes (feriado/fim de semana)
  if (!achado) return null;
  const dias = (Date.parse(dataIso) - Date.parse(achado.data)) / 86_400_000;
  return dias <= 7 ? achado : null;
}

/** Data de hoje no fuso do navegador, em ISO. */
export function hojeIso(agora = new Date()): string {
  const d = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Bloco 3: valor atual, resultado, renda e divisão da carteira
// ---------------------------------------------------------------------------

/** O que o painel precisa saber de cada fundo (vem do snapshot do site). */
export interface InfoFundo {
  preco: number | null;
  ultimo_dividendo: number | null;
  dividendos_12m: number | null;
  tipo_gestao: string | null;
  segmento?: string | null;
  segmento_padrao?: string | null;
}

export interface LinhaCarteira extends Posicao {
  precoAtual: number | null;
  valorAtual: number | null;      // cotas × preço do último pregão
  resultado: number | null;       // valor atual − custo (só a variação da cota, sem rendimentos)
  resultadoPct: number | null;
  rendaMensal: number | null;     // cotas × último rendimento por cota
  renda12m: number | null;        // cotas × rendimentos por cota pagos nos últimos 12 meses
  yocPct: number | null;          // yield on cost: rendimentos 12m ÷ preço médio
  pesoPct: number | null;         // fatia do valor atual da carteira
}

export interface Fatia { nome: string; valor: number; pct: number; fundos: number }

export interface ResumoCarteira {
  linhas: LinhaCarteira[];
  custo: number;
  valor: number;            // só fundos com preço
  resultado: number;        // valor − custo dos fundos com preço
  resultadoPct: number | null;
  rendaMensal: number;
  renda12m: number;
  yocPct: number | null;    // renda 12m ÷ custo (sobre o que você pagou)
  dyAtualPct: number | null; // renda 12m ÷ valor atual (sobre quanto vale hoje)
  semPreco: string[];       // fundos sem cotação no site (ficam fora do valor e do resultado)
  porSegmento: Fatia[];
  porTipo: Fatia[];
}

const fatiar = (linhas: LinhaCarteira[], chave: (l: LinhaCarteira) => string, total: number): Fatia[] => {
  const m = new Map<string, Fatia>();
  for (const l of linhas) {
    if (l.valorAtual == null) continue;
    const nome = chave(l);
    const f = m.get(nome) ?? { nome, valor: 0, pct: 0, fundos: 0 };
    f.valor += l.valorAtual;
    f.fundos += 1;
    m.set(nome, f);
  }
  return [...m.values()]
    .map((f) => ({ ...f, pct: total > 0 ? (f.valor / total) * 100 : 0 }))
    .sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome));
};

/** Junta as posições (cotas e preço médio) com os dados do site (preço e rendimentos). */
export function resumirCarteira(posicoes: Posicao[], info: Map<string, InfoFundo>): ResumoCarteira {
  const ativas = posicoes.filter((p) => p.quantidade > 0);
  const linhas: LinhaCarteira[] = ativas.map((p) => {
    const f = info.get(p.ticker);
    const preco = f?.preco != null && f.preco > 0 ? f.preco : null;
    const valor = preco != null ? p.quantidade * preco : null;
    const resultado = valor != null ? valor - p.custo : null;
    const div12 = f?.dividendos_12m != null && f.dividendos_12m >= 0 ? f.dividendos_12m : null;
    const ultimo = f?.ultimo_dividendo != null && f.ultimo_dividendo >= 0 ? f.ultimo_dividendo : null;
    return {
      ...p,
      precoAtual: preco,
      valorAtual: valor,
      resultado,
      resultadoPct: resultado != null && p.custo > 0 ? (resultado / p.custo) * 100 : null,
      rendaMensal: ultimo != null ? p.quantidade * ultimo : null,
      renda12m: div12 != null ? p.quantidade * div12 : null,
      yocPct: div12 != null && p.precoMedio > 0 ? (div12 / p.precoMedio) * 100 : null,
      pesoPct: null,
    };
  });
  const comPreco = linhas.filter((l) => l.valorAtual != null);
  const valor = comPreco.reduce((s, l) => s + (l.valorAtual ?? 0), 0);
  const custoComPreco = comPreco.reduce((s, l) => s + l.custo, 0);
  const custo = linhas.reduce((s, l) => s + l.custo, 0);
  for (const l of linhas) l.pesoPct = l.valorAtual != null && valor > 0 ? (l.valorAtual / valor) * 100 : null;
  linhas.sort((a, b) => (b.valorAtual ?? -1) - (a.valorAtual ?? -1) || a.ticker.localeCompare(b.ticker));

  const renda12m = linhas.reduce((s, l) => s + (l.renda12m ?? 0), 0);
  const resultado = valor - custoComPreco;
  return {
    linhas,
    custo,
    valor,
    resultado,
    resultadoPct: custoComPreco > 0 ? (resultado / custoComPreco) * 100 : null,
    rendaMensal: linhas.reduce((s, l) => s + (l.rendaMensal ?? 0), 0),
    renda12m,
    yocPct: custo > 0 ? (renda12m / custo) * 100 : null,
    dyAtualPct: valor > 0 ? (renda12m / valor) * 100 : null,
    semPreco: linhas.filter((l) => l.valorAtual == null).map((l) => l.ticker),
    porSegmento: fatiar(linhas, (l) => info.get(l.ticker)?.segmento_padrao || info.get(l.ticker)?.segmento || "Sem segmento", valor),
    porTipo: fatiar(linhas, (l) => info.get(l.ticker)?.tipo_gestao || "Sem tipo", valor),
  };
}
