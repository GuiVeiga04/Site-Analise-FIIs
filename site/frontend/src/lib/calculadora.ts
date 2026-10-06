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
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
  return Number(t);
}

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
  if (rendimentoPorCota == null || !(rendimentoPorCota >= 0)) return null;
  const mensal = pos.cotas * rendimentoPorCota;
  return montarRenda(pos, rendimentoPorCota, mensal, mensal * 12);
}

/**
 * Cenário "12 meses reais": usa a SOMA do que o fundo pagou por cota nos
 * últimos 12 meses (inclui meses sem pagamento e rendimentos extraordinários).
 *   anual = cotas × soma 12m;  mensal = anual ÷ 12 (média por mês)
 */
export function rendaMedia12m(pos: Posicao, soma12mPorCota: number | null | undefined): Renda | null {
  if (soma12mPorCota == null || !(soma12mPorCota >= 0)) return null;
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
