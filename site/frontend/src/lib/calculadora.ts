/**
 * Calculadora de dividendos — só as contas, sem tela.
 *
 * Mantida separada (e sem imports) para poder ser auditada e testada à parte:
 *   npm test   (roda src/lib/calculadora.test.ts com o Node, sem dependências)
 *
 * Premissas gerais:
 *  - Cota é indivisível: só se compra número inteiro de cotas.
 *  - Corretagem, emolumentos e spread não entram na conta.
 *  - Rendimento de FII é isento de IR para pessoa física (regra geral), então
 *    os valores são líquidos.
 */

// ---------------------------------------------------------------------------
// Entrada de números no formato brasileiro
// ---------------------------------------------------------------------------

/**
 * Converte o que o usuário digitou em número, aceitando o jeito brasileiro:
 *   "10.000" -> 10000   "1.234,56" -> 1234.56   "9,16" -> 9.16   "R$ 500" -> 500
 * Ponto sem vírgula só vira decimal quando NÃO parece separador de milhar
 * ("9.16" -> 9.16; "10.000" e "1.500.000" -> milhares). Vazio/inválido -> NaN.
 */
export function lerNumero(txt: string): number {
  const t = txt.trim().replace(/\s|R\$/g, "");
  if (!t) return Number.NaN;
  let n: number;
  if (t.includes(",")) n = Number(t.replace(/\./g, "").replace(",", "."));
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) n = Number(t.replace(/\./g, ""));
  else n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN; // "Infinity", "1e999" etc. viram inválidos
}

/** Número finito e >= 0 (rendimento por cota válido). */
const rendimentoValido = (v: number | null | undefined): v is number => v != null && Number.isFinite(v) && v >= 0;

/**
 * Rendimento mensal acima de 20% do preço da cota não existe em FII (o normal é
 * perto de 1%): quase sempre é erro de digitação (ex: 115 em vez de 1,15).
 * As funções devolvem null nesse caso, em vez de números absurdos.
 */
export const RENDIMENTO_MENSAL_MAXIMO = 0.2;
const plausivel = (rend: number, preco: number) => rend <= preco * RENDIMENTO_MENSAL_MAXIMO;

// ---------------------------------------------------------------------------
// Bloco 1 — Quanto vou receber
// ---------------------------------------------------------------------------

export type ModoEntrada = "valor" | "cotas";

export interface Posicao {
  /** Número inteiro de cotas. */
  cotas: number;
  /** Cotas × preço: o que efetivamente foi investido. */
  valorAplicado: number;
  /** No modo "valor": o que sobrou por não dar para comprar mais uma cota. */
  sobra: number;
}

/**
 * Monta a posição a partir do que o usuário digitou.
 *  - modo "valor": compra o máximo de cotas inteiras que cabe no valor.
 *  - modo "cotas": usa a quantidade informada (arredondada para baixo).
 * Entradas inválidas (preço ≤ 0, negativos, NaN) viram posição zerada.
 */
export function montarPosicao(modo: ModoEntrada, entrada: number, preco: number): Posicao {
  if (!(preco > 0) || !(entrada > 0) || !Number.isFinite(entrada)) {
    return { cotas: 0, valorAplicado: 0, sobra: modo === "valor" && entrada > 0 ? entrada : 0 };
  }
  // O epsilon evita que 1000 / 10.00 vire 99.99999 por causa de ponto flutuante.
  const cotas = modo === "valor" ? Math.floor(entrada / preco + 1e-9) : Math.floor(entrada + 1e-9);
  const valorAplicado = arred(cotas * preco);
  const sobra = modo === "valor" ? arred(entrada - valorAplicado) : 0;
  return { cotas, valorAplicado, sobra };
}

export interface Renda {
  /** Rendimento por cota usado na conta (R$). */
  porCota: number;
  /** Renda de um mês (R$). */
  mensal: number;
  /** Renda de 12 meses (R$). */
  anual: number;
  /** Renda anual ÷ valor aplicado (%). É o DY sobre o preço usado na conta. */
  yieldSobreCusto: number | null;
}

/**
 * Cenário "mês a mês": supõe que o rendimento por cota se repete todo mês.
 * Usado para o último dividendo e para um valor digitado pelo usuário.
 *   mensal = cotas × rendimento por cota;  anual = mensal × 12
 */
export function rendaMensalConstante(pos: Posicao, rendimentoPorCota: number | null | undefined): Renda | null {
  if (!rendimentoValido(rendimentoPorCota)) return null;
  const mensal = pos.cotas * rendimentoPorCota;
  return montarRenda(pos, rendimentoPorCota, mensal, mensal * 12);
}

/**
 * Cenário "12 meses reais": usa a SOMA do que o fundo pagou por cota nos
 * últimos 12 meses (inclui meses sem pagamento e rendimentos extraordinários).
 *   anual = cotas × soma 12m;  mensal = anual ÷ 12 (média por mês)
 */
export function rendaMedia12m(pos: Posicao, soma12mPorCota: number | null | undefined): Renda | null {
  if (!rendimentoValido(soma12mPorCota)) return null;
  const anual = pos.cotas * soma12mPorCota;
  return montarRenda(pos, soma12mPorCota / 12, anual / 12, anual);
}

function montarRenda(pos: Posicao, porCota: number, mensal: number, anual: number): Renda {
  return {
    porCota,
    mensal: arred(mensal),
    anual: arred(anual),
    yieldSobreCusto: pos.valorAplicado > 0 ? (anual / pos.valorAplicado) * 100 : null,
  };
}

/** Arredonda para centavos (só no fim das contas). */
export function arred(v: number): number {
  return Math.round(v * 100) / 100;
}

// ---------------------------------------------------------------------------
// Bloco 2 — Meta de renda
// ---------------------------------------------------------------------------

export interface MetaRenda {
  /** Cotas inteiras necessárias para render PELO MENOS a meta. */
  cotas: number;
  /** Cotas × preço. */
  capital: number;
  /** Renda mensal que essas cotas geram (≥ meta, por causa do arredondamento para cima). */
  rendaObtida: number;
  /** Rendimento mensal por cota ÷ preço (% ao mês) — mostra o "esforço" de cada cenário. */
  dyMensal: number;
}

/**
 * Quantas cotas (e quanto capital) para receber `metaMensal` por mês.
 *   cotas   = arredondar PARA CIMA (meta ÷ rendimento mensal por cota)
 *   capital = cotas × preço
 * Para cima porque com uma cota a menos a renda fica abaixo da meta.
 * Devolve null quando a conta não faz sentido (rendimento zero, preço ou meta inválidos).
 */
export function calcularMeta(
  metaMensal: number, rendimentoMensalPorCota: number | null | undefined, preco: number,
): MetaRenda | null {
  if (!(metaMensal > 0) || !Number.isFinite(metaMensal)) return null;
  if (!rendimentoValido(rendimentoMensalPorCota) || rendimentoMensalPorCota === 0) return null;
  if (!(preco > 0) || !Number.isFinite(preco) || !plausivel(rendimentoMensalPorCota, preco)) return null;
  // O epsilon evita pedir uma cota a mais quando a divisão é exata (100 ÷ 0,1 = 1000,0000001).
  const cotas = Math.ceil(metaMensal / rendimentoMensalPorCota - 1e-9);
  return {
    cotas,
    capital: arred(cotas * preco),
    rendaObtida: arred(cotas * rendimentoMensalPorCota),
    dyMensal: (rendimentoMensalPorCota / preco) * 100,
  };
}

/** Rendimento mensal por cota no cenário "média de 12 meses": soma dos 12 meses ÷ 12. */
export function mediaMensal12m(soma12mPorCota: number | null | undefined): number | null {
  return rendimentoValido(soma12mPorCota) ? soma12mPorCota / 12 : null;
}

// ---------------------------------------------------------------------------
// Bloco 3 — Número mágico
// ---------------------------------------------------------------------------

export interface NumeroMagico {
  /** Cotas necessárias para que UM mês de rendimento compre UMA cota nova. */
  cotas: number;
  /** Cotas × preço. */
  capital: number;
  /** Renda mensal ao atingir o número (≥ preço de 1 cota). */
  rendaMensal: number;
  /** Quanto falta a partir das cotas que a pessoa já tem (0 se já atingiu). */
  faltamCotas: number;
  faltamCapital: number;
}

/**
 * Número mágico = menor quantidade de cotas cuja renda de UM mês paga UMA cota:
 *   cotas × rendimento por cota ≥ preço   =>   cotas = arredondar PARA CIMA (preço ÷ rendimento por cota)
 * É a "meta de renda" (bloco 2) com a meta igual ao preço da cota.
 * Também vale: número mágico ≈ 1 ÷ DY mensal (ex: DY de 0,78% ao mês -> ~129 cotas).
 */
export function calcularNumeroMagico(
  preco: number, rendimentoMensalPorCota: number | null | undefined, cotasAtuais = 0,
): NumeroMagico | null {
  const m = calcularMeta(preco, rendimentoMensalPorCota, preco);
  if (!m) return null;
  const tem = cotasAtuais > 0 && Number.isFinite(cotasAtuais) ? Math.floor(cotasAtuais) : 0;
  const faltamCotas = Math.max(0, m.cotas - tem);
  return {
    cotas: m.cotas,
    capital: m.capital,
    rendaMensal: m.rendaObtida,
    faltamCotas,
    faltamCapital: arred(faltamCotas * preco),
  };
}

// ---------------------------------------------------------------------------
// Bloco 4 — Simulação com aporte mensal e reinvestimento
// ---------------------------------------------------------------------------

export interface ParamsSimulacao {
  preco: number;                     // preço da cota hoje (R$)
  rendimentoMensalPorCota: number;   // rendimento por cota por mês hoje (R$)
  aporteInicial: number;             // R$ investidos no mês 0
  aporteMensal: number;              // R$ investidos todo mês, do mês 1 em diante
  meses: number;                     // prazo (limitado a 600 = 50 anos)
  reinvestir: boolean;               // rendimentos voltam para a compra de cotas?
  crescimentoRendimentoAnual?: number; // % ao ano (padrão 0: rendimento constante)
  valorizacaoPrecoAnual?: number;      // % ao ano (padrão 0: preço constante)
  inflacaoAnual?: number;              // % ao ano, só para mostrar valores "em reais de hoje"
}

export interface MesSimulado {
  mes: number;
  cotas: number;
  preco: number;
  caixa: number;               // dinheiro que sobrou por não completar 1 cota
  patrimonio: number;          // cotas × preço + caixa
  patrimonioReal: number;      // patrimônio descontada a inflação (reais de hoje)
  rendaMes: number;            // rendimento recebido neste mês
  totalAportado: number;       // soma do que saiu do bolso até aqui
  totalRendimentos: number;    // soma dos rendimentos recebidos até aqui
}

export interface ResultadoSimulacao {
  meses: MesSimulado[];        // índice 0 = mês 0 (só o aporte inicial)
  final: MesSimulado;
  /** Primeiro mês em que a renda do mês compra 1 cota (null se não atingir no prazo). */
  mesNumeroMagico: number | null;
}

/**
 * Simulação mês a mês. A ordem dentro de cada mês m (1..N) é:
 *   1. recebe o rendimento das cotas que já tinha:  renda = cotas × rendimento por cota do mês
 *   2. entra o aporte mensal no caixa
 *   3. se reinvestir, a renda também entra no caixa (senão ela é "sacada")
 *   4. compra o máximo de cotas inteiras com o caixa; o troco fica para o mês seguinte
 *   5. preço e rendimento crescem pela taxa mensal equivalente: (1 + taxa anual)^(1/12) − 1
 * No mês 0 só acontece a compra com o aporte inicial.
 * Premissas: sem corretagem, sem IR (rendimento de FII é isento para PF), cotas inteiras.
 */
export const TAXA_ANUAL_MIN = -50;
export const TAXA_ANUAL_MAX = 100;
export const limitarTaxa = (t: number) =>
  Number.isFinite(t) ? Math.min(TAXA_ANUAL_MAX, Math.max(TAXA_ANUAL_MIN, t)) : 0;

export function simular(p: ParamsSimulacao): ResultadoSimulacao | null {
  if (!(p.preco > 0) || !Number.isFinite(p.preco) || !rendimentoValido(p.rendimentoMensalPorCota)) return null;
  if (!plausivel(p.rendimentoMensalPorCota, p.preco)) return null;
  const meses = Math.min(600, Math.max(0, Math.floor(p.meses || 0)));
  const valorOuZero = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  const aporteInicial = valorOuZero(p.aporteInicial);
  const aporteMensal = valorOuZero(p.aporteMensal);
  // Taxas anuais limitadas a [-50%, +100%]: -100% zeraria o preço (divisão por zero),
  // abaixo disso a potência vira NaN, e quedas extremas por décadas levam a conta a
  // números astronômicos. Fora dessa faixa não faz sentido para FII.
  const fator = (anual = 0) => Math.pow(1 + limitarTaxa(anual) / 100, 1 / 12);
  const fRend = fator(p.crescimentoRendimentoAnual);
  const fPreco = fator(p.valorizacaoPrecoAnual);
  const fInfl = fator(p.inflacaoAnual);

  let preco = p.preco;
  let rend = p.rendimentoMensalPorCota;
  let caixa = aporteInicial;
  let cotas = 0;
  let totalAportado = aporteInicial;
  let totalRendimentos = 0;
  let mesNumeroMagico: number | null = null;

  const comprar = () => {
    const n = Math.floor(caixa / preco + 1e-9);
    cotas += n;
    caixa = Math.max(0, caixa - n * preco);
  };
  const registrar = (mes: number, rendaMes: number): MesSimulado => {
    const patrimonio = cotas * preco + caixa;
    return {
      mes, cotas, preco, caixa, patrimonio,
      patrimonioReal: patrimonio / Math.pow(fInfl, mes),
      rendaMes, totalAportado, totalRendimentos,
    };
  };

  comprar();
  const serie: MesSimulado[] = [registrar(0, 0)];
  for (let m = 1; m <= meses; m++) {
    const renda = cotas * rend;
    totalRendimentos += renda;
    caixa += aporteMensal;
    totalAportado += aporteMensal;
    if (p.reinvestir) caixa += renda;
    if (mesNumeroMagico === null && renda >= preco - 1e-9 && renda > 0) mesNumeroMagico = m;
    comprar();
    // Proteção: combinações extremas (cota quase de graça e rendimento alto
    // reinvestido por décadas) estouram o limite numérico. Melhor não mostrar nada.
    if (!Number.isFinite(cotas) || !Number.isFinite(caixa) || !Number.isFinite(cotas * preco)) return null;
    serie.push(registrar(m, renda));
    preco *= fPreco;
    rend *= fRend;
  }
  return { meses: serie, final: serie[serie.length - 1], mesNumeroMagico };
}

// ---------------------------------------------------------------------------
// Bloco 5 — E se eu tivesse investido em uma data passada (dados reais)
// ---------------------------------------------------------------------------

export interface PrecoDia { data: string; preco: number }        // data ISO "AAAA-MM-DD"
export interface Provento { dataEx: string; valor: number }      // R$ por cota

export interface PagamentoRecebido {
  dataEx: string;
  valorPorCota: number;
  cotas: number;             // cotas que tinha (e que receberam)
  recebido: number;          // cotas × valor por cota
  precoReinvestimento: number;
  cotasCompradas: number;    // só com reinvestimento
}

export interface PontoHistoricoSim { data: string; patrimonio: number }

export interface ResultadoHistorico {
  dataCompra: string;        // pregão em que a compra foi feita (o 1º a partir da data pedida)
  precoCompra: number;
  dataFinal: string;         // último pregão disponível
  precoFinal: number;
  capitalInicial: number;    // o que saiu do bolso
  cotasIniciais: number;
  cotasFinais: number;
  caixa: number;             // troco + rendimentos que não completaram 1 cota
  rendimentosRecebidos: number;
  /** Valor final: cotas × preço final + caixa (+ rendimentos sacados, sem reinvestimento). */
  valorFinal: number;
  retornoTotalPct: number;   // valorFinal ÷ capitalInicial − 1
  variacaoPrecoPct: number;  // só o preço: preço final ÷ preço de compra − 1
  pagamentos: PagamentoRecebido[];
  serie: PontoHistoricoSim[];
}

/**
 * Refaz o investimento com preços e rendimentos REAIS:
 *  1. Compra no fechamento do 1º pregão a partir de `dataPedida` (fim de semana/feriado
 *     vai para o próximo pregão). Modo "valor": máximo de cotas inteiras, troco no caixa.
 *  2. Recebe todo rendimento com data-ex DEPOIS do dia da compra: quem tem a cota no
 *     fechamento da data-com (pregão anterior à data-ex) recebe. Comprou na própria
 *     data-ex? Esse rendimento não é seu.
 *  3. Reinvestindo: o rendimento vai para o caixa e compra cotas no fechamento do 1º
 *     pregão a partir da data-ex. (Aproximação: o dinheiro de fato cai alguns dias depois.)
 *     Sem reinvestir: o rendimento é somado à parte (dinheiro recebido).
 *  4. Valor final = cotas × preço do último pregão + caixa (+ rendimentos, sem reinvestir).
 * `precos` e `proventos` podem vir em qualquer ordem; preços inválidos são ignorados.
 */
export function simularHistorico(
  precos: PrecoDia[], proventos: Provento[], dataPedida: string,
  modo: ModoEntrada, entrada: number, reinvestir: boolean,
): ResultadoHistorico | null {
  const serieP = precos.filter((p) => p.preco > 0 && Number.isFinite(p.preco)).sort((a, b) => a.data.localeCompare(b.data));
  if (!serieP.length || !(entrada > 0) || !Number.isFinite(entrada)) return null;
  const iCompra = serieP.findIndex((p) => p.data >= dataPedida);
  if (iCompra < 0 || iCompra === serieP.length - 1) return null; // precisa de pelo menos 1 pregão depois
  const compra = serieP[iCompra];
  const final = serieP[serieP.length - 1];

  const pos = montarPosicao(modo, entrada, compra.preco);
  if (pos.cotas === 0) return null;
  const capitalInicial = modo === "valor" ? entrada : pos.valorAplicado;
  let cotas = pos.cotas;
  let caixa = pos.sobra;
  let recebidos = 0;

  const provs = proventos
    .filter((d) => d.valor > 0 && Number.isFinite(d.valor) && d.dataEx > compra.data && d.dataEx <= final.data)
    .sort((a, b) => a.dataEx.localeCompare(b.dataEx));
  const pagamentos: PagamentoRecebido[] = [];
  const serie: PontoHistoricoSim[] = [];
  let k = 0;
  for (let i = iCompra; i < serieP.length; i++) {
    const dia = serieP[i];
    // rendimentos cuja data-ex já chegou (pode haver mais de um até este pregão)
    while (k < provs.length && provs[k].dataEx <= dia.data) {
      const d = provs[k++];
      const recebido = cotas * d.valor;
      recebidos += recebido;
      let compradas = 0;
      if (reinvestir) {
        caixa += recebido;
        compradas = Math.floor(caixa / dia.preco + 1e-9);
        cotas += compradas;
        caixa = Math.max(0, caixa - compradas * dia.preco);
      }
      pagamentos.push({
        dataEx: d.dataEx, valorPorCota: d.valor, cotas: cotas - compradas, recebido,
        precoReinvestimento: dia.preco, cotasCompradas: compradas,
      });
    }
    serie.push({ data: dia.data, patrimonio: cotas * dia.preco + caixa + (reinvestir ? 0 : recebidos) });
  }
  const valorFinal = cotas * final.preco + caixa + (reinvestir ? 0 : recebidos);
  return {
    dataCompra: compra.data, precoCompra: compra.preco, dataFinal: final.data, precoFinal: final.preco,
    capitalInicial, cotasIniciais: pos.cotas, cotasFinais: cotas, caixa, rendimentosRecebidos: recebidos,
    valorFinal, retornoTotalPct: (valorFinal / capitalInicial - 1) * 100,
    variacaoPrecoPct: (final.preco / compra.preco - 1) * 100,
    pagamentos, serie,
  };
}
