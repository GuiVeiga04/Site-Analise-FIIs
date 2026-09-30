import type { FundoSnapshot } from "../api/types";

/**
 * Agregações simples sobre o conjunto FILTRADO (equivalentes às medidas de
 * cartão do Power BI). As métricas por fundo vêm prontas do Python; aqui
 * só somamos/médias do que está na tela.
 */
export function kpis(fundos: FundoSnapshot[]) {
  const liq = fundos.map((f) => f.volume_financeiro_medio ?? 0);
  const total = liq.reduce((a, b) => a + b, 0);
  const top5 = [...liq].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  const vars = fundos.map((f) => f.variacao_periodo_pct).filter((v): v is number => v != null);
  return {
    fundos: fundos.length,
    liquidezTotal: total,
    variacaoMedia: vars.length ? vars.reduce((a, b) => a + b, 0) / vars.length : null,
    altas: vars.filter((v) => v > 0.005).length,
    baixas: vars.filter((v) => v < -0.005).length,
    estaveis: vars.filter((v) => Math.abs(v) <= 0.005).length,
    concentracaoTop5: total ? (top5 / total) * 100 : null,
    dyMediano: mediana(fundos.map((f) => f.dy_12m_pct)),
    pvpMediano: mediana(fundos.map((f) => f.p_vp)),
    comPvp: fundos.filter((f) => f.p_vp != null).length,
    abaixoVp: fundos.filter((f) => f.p_vp != null && f.p_vp < 1).length,
    comDividendos: fundos.filter((f) => f.dy_12m_pct != null).length,
  };
}

export function mediana(valores: (number | null | undefined)[]): number | null {
  const v = valores.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function liquidezPorTipo(fundos: FundoSnapshot[]) {
  const mapa = new Map<string, { tipo: string; liquidez: number; fundos: number }>();
  for (const f of fundos) {
    const t = f.tipo_gestao ?? "—";
    const item = mapa.get(t) ?? { tipo: t, liquidez: 0, fundos: 0 };
    item.liquidez += f.volume_financeiro_medio ?? 0;
    item.fundos += 1;
    mapa.set(t, item);
  }
  const ordem = ["Papel", "Tijolo", "Híbrido", "FoF"];
  return [...mapa.values()].sort((a, b) => ordem.indexOf(a.tipo) - ordem.indexOf(b.tipo));
}
