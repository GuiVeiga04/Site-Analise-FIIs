import type { ReactNode } from "react";
import type { Liquidez, Sinal, StatusCriterio } from "../api/types";
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
