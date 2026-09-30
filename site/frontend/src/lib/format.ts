const nf = (min: number, max: number) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max });

export function brl(v: number | null | undefined, casas = 2) {
  return v == null ? "—" : "R$ " + nf(casas, casas).format(v);
}

export function compacto(v: number | null | undefined) {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `R$ ${nf(0, 1).format(v / 1e9)} bi`;
  if (a >= 1e6) return `R$ ${nf(0, 1).format(v / 1e6)} mi`;
  if (a >= 1e3) return `R$ ${nf(0, 0).format(v / 1e3)} mil`;
  return brl(v, 0);
}

export function pct(v: number | null | undefined, casas = 2) {
  if (v == null) return "—";
  return (v > 0 ? "+" : "") + nf(casas, casas).format(v) + "%";
}

export function inteiro(v: number | null | undefined) {
  return v == null ? "—" : nf(0, 0).format(v);
}

export function data(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Percentual sem sinal (DY, por exemplo, nunca é "+9,6%"). */
export function taxa(v: number | null | undefined, casas = 2) {
  return v == null ? "—" : nf(casas, casas).format(v) + "%";
}

/** Rendimento por cota: até 4 casas, porque FII paga coisas como R$ 0,1045. */
export function brlDiv(v: number | null | undefined) {
  return v == null ? "—" : "R$ " + nf(2, 4).format(v);
}

/** Pontos percentuais com sinal (diferença entre duas taxas). */
export function pp(v: number | null | undefined, casas = 2) {
  if (v == null) return "—";
  return (v > 0 ? "+" : "") + nf(casas, casas).format(v) + " p.p.";
}

/** Múltiplo com 2 casas (P/VP 0,95). */
export function mult(v: number | null | undefined) {
  return v == null ? "—" : nf(2, 2).format(v);
}

/** "2026-07-01" -> "07/2026" (mês de referência de informe). */
export function mesAno(iso: string | null | undefined) {
  if (!iso) return "—";
  return `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function direcao(v: number | null | undefined): "up" | "down" | "flat" {
  if (v == null || Math.abs(v) < 0.005) return "flat";
  return v > 0 ? "up" : "down";
}
