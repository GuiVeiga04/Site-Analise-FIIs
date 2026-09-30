import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FundoSnapshot } from "../api/types";
import { brl, brlDiv, data, mult, taxa } from "../lib/format";
import { useHistoricos } from "../lib/useHistoricos";
import { Delta, LiquidezBadge, SinalBadge, Sparkline, TipoPill } from "./ui";

type Chave = "ticker" | "checklist_nota" | "segmento" | "preco" | "p_vp" | "dy_12m_pct" | "ultimo_dividendo" | "variacao_periodo_pct"
  | "volume_financeiro_medio" | "rank_liquidez";

const COLUNAS: { chave: Chave; titulo: string; num?: boolean }[] = [
  { chave: "ticker", titulo: "Fundo" },
  { chave: "checklist_nota", titulo: "Checklist" },
  { chave: "segmento", titulo: "Segmento" },
  { chave: "preco", titulo: "Preço atual", num: true },
  { chave: "p_vp", titulo: "P/VP", num: true },
  { chave: "dy_12m_pct", titulo: "DY 12m", num: true },
  { chave: "ultimo_dividendo", titulo: "Último dividendo", num: true },
  { chave: "variacao_periodo_pct", titulo: "Variação período", num: true },
  { chave: "volume_financeiro_medio", titulo: "Liquidez média/dia", num: true },
  { chave: "rank_liquidez", titulo: "Liquidez" },
];

export function TabelaFundos({ fundos }: { fundos: FundoSnapshot[] }) {
  const nav = useNavigate();
  const [ord, setOrd] = useState<{ chave: Chave; dir: 1 | -1 }>({ chave: "volume_financeiro_medio", dir: -1 });
  const historicos = useHistoricos(useMemo(() => fundos.map((f) => f.ticker), [fundos]));

  const linhas = useMemo(() => [...fundos].sort((a, b) => {
    const va = a[ord.chave] ?? -Infinity, vb = b[ord.chave] ?? -Infinity;
    return (va > vb ? 1 : va < vb ? -1 : 0) * ord.dir;
  }), [fundos, ord]);

  const ordenar = (chave: Chave) =>
    setOrd((o) => (o.chave === chave ? { chave, dir: (o.dir * -1) as 1 | -1 } : { chave, dir: chave === "ticker" || chave === "segmento" || chave === "rank_liquidez" ? 1 : -1 }));

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {COLUNAS.map((c) => (
              <th key={c.chave} className={c.num ? "r" : ""}
                aria-sort={ord.chave === c.chave ? (ord.dir === 1 ? "ascending" : "descending") : "none"}>
                <button onClick={() => ordenar(c.chave)}>
                  {c.titulo} {ord.chave === c.chave ? (ord.dir === 1 ? "↑" : "↓") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.length === 0 && (
            <tr><td colSpan={COLUNAS.length} className="state">Nenhum fundo com esses filtros.</td></tr>
          )}
          {linhas.map((f) => (
            <tr key={f.ticker} onClick={() => nav(`/fundo/${f.ticker}`)}>
              <td>
                <span className="mono" style={{ fontWeight: 600 }}>{f.ticker}</span> <TipoPill tipo={f.tipo_gestao} />
                <span className="sub-name">{f.nome}</span>
              </td>
              <td><SinalBadge sinal={f.checklist_sinal} nota={f.checklist_nota} compacto /></td>
              <td>{f.segmento}</td>
              <td className="r num">{brl(f.preco)}<Sparkline serie={historicos[f.ticker]} /></td>
              <td className="r num" title={f.p_vp_mediana_pares != null ? `Mediana dos pares (${f.grupo_pares}): ${mult(f.p_vp_mediana_pares)}` : undefined}>
                {mult(f.p_vp)}
              </td>
              <td className="r num" title={f.dy_12m_mediana_pares_pct != null ? `Mediana dos pares (${f.grupo_pares}): ${taxa(f.dy_12m_mediana_pares_pct)}` : undefined}>
                {taxa(f.dy_12m_pct)}
              </td>
              <td className="r">
                <span className="num">{brlDiv(f.ultimo_dividendo)}</span>
                {f.data_ultimo_dividendo && <span className="sub-name">data-ex {data(f.data_ultimo_dividendo)} · {taxa(f.dy_ultimo_pct)}</span>}
              </td>
              <td className="r"><Delta valor={f.variacao_periodo_pct} /></td>
              <td className="r num">{brl(f.volume_financeiro_medio, 0)}</td>
              <td><LiquidezBadge valor={f.liquidez} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
