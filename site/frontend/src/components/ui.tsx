import type { ReactNode } from "react";
import type { Liquidez, PontoHistorico, Sinal, StatusCriterio } from "../api/types";
import { direcao, pct } from "../lib/format";

export const COR_TIPO: Record<string, string> = {
  Papel: "var(--papel)", Tijolo: "var(--tijolo)", "Híbrido": "var(--hibrido)", FoF: "var(--fof)",
};

export function KpiCard({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value num">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function TipoPill({ tipo }: { tipo: string | null }) {
  if (!tipo) return null;
  return <span className="pill" style={{ ["--c" as string]: COR_TIPO[tipo] ?? "var(--muted)" }}>{tipo}</span>;
}

export function LiquidezBadge({ valor }: { valor: Liquidez }) {
  return <span className={`liq liq-${valor}`}>{valor}</span>;
}

export function Delta({ valor }: { valor: number | null }) {
  return <span className={`num ${direcao(valor)}`}>{pct(valor)}</span>;
}

export function Estado({ loading, error }: { loading?: boolean; error?: Error }) {
  if (error) return <div className="state">Não foi possível carregar os dados: {error.message}</div>;
  if (loading) return <div className="state">Carregando…</div>;
  return null;
}

/** Mini-gráfico de preço (histórico curto), usado na tabela de fundos. */
export function Sparkline({ serie }: { serie?: PontoHistorico[] }) {
  const vals = (serie ?? []).map((p) => p.preco).filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const w = 46;
  const h = 16;
  const pts = vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = max === min ? h / 2 : h - ((v - min) / (max - min)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const subiu = vals[vals.length - 1] >= vals[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="sparkline" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={subiu ? "var(--good)" : "var(--crit)"} strokeWidth={1.6} />
    </svg>
  );
}

export const ROTULO_SINAL: Record<Sinal, string> = {
  verde: "Verde", amarelo: "Amarelo", vermelho: "Vermelho", cinza: "Poucos dados",
};

/** Semáforo do checklist. Cor + texto (nunca só cor). */
export function SinalBadge({ sinal, nota, compacto = false }: { sinal: Sinal | StatusCriterio; nota?: number | null; compacto?: boolean }) {
  const s = sinal === "sem_dado" ? "cinza" : sinal;
  return (
    <span className={`sinal sinal-${s}`} title={ROTULO_SINAL[s]}>
      <i aria-hidden="true" />
      {compacto ? (nota ?? "—") : <>{ROTULO_SINAL[s]}{nota != null && <b className="num"> {nota}</b>}</>}
    </span>
  );
}
