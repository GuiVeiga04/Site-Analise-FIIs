import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ZAxis, ReferenceLine,
} from "recharts";
import { useNavigate } from "react-router-dom";
import type { FundoSnapshot } from "../api/types";
import { brl, brlDiv, compacto, mult, pct, taxa } from "../lib/format";
import { liquidezPorTipo } from "../lib/agregados";
import { COR_TIPO } from "./ui";

const eixo = { fontSize: 11, fill: "var(--muted)" };

/* Rótulo de valor sem quebra de linha (o LabelList padrão quebra em barras estreitas) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rotulo = (pos: "top" | "right") => (p: any) => {
  const { x, y, width, height, value } = p;
  const top = pos === "top";
  return (
    <text x={top ? x + width / 2 : x + width + 6} y={top ? y - 6 : y + height / 2 + 4}
      textAnchor={top ? "middle" : "start"} fontSize={11} fontWeight={600} fill="var(--text)">
      {compacto(value)}
    </text>
  );
};

export function LiquidezPorTipo({ fundos }: { fundos: FundoSnapshot[] }) {
  const dados = liquidezPorTipo(fundos);
  return (
    <div className="card">
      <div className="chart-title">Liquidez por tipo de gestão</div>
      <div className="chart-sub">Volume financeiro médio somado (R$/pregão)</div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={dados} margin={{ top: 24, right: 8, left: 8, bottom: 0 }}>
          <XAxis dataKey="tipo" tick={eixo} axisLine={{ stroke: "var(--baseline)" }} tickLine={false} />
          <YAxis hide />
          <Tooltip cursor={{ fill: "var(--accent-wash)" }} content={({ payload }) =>
            payload?.[0] ? (
              <div className="tip"><b>{payload[0].payload.tipo}</b><br />
                {brl(payload[0].payload.liquidez, 0)} · {payload[0].payload.fundos} fundos</div>
            ) : null} />
          <Bar isAnimationActive={false} dataKey="liquidez" radius={[4, 4, 0, 0]} maxBarSize={64}>
            {dados.map((d) => <Cell key={d.tipo} fill={COR_TIPO[d.tipo] ?? "var(--muted)"} />)}
            <LabelList dataKey="liquidez" content={rotulo("top")} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RankingLiquidez({ fundos, top = 15 }: { fundos: FundoSnapshot[]; top?: number }) {
  const nav = useNavigate();
  const dados = [...fundos]
    .sort((a, b) => (b.volume_financeiro_medio ?? 0) - (a.volume_financeiro_medio ?? 0))
    .slice(0, top);
  return (
    <div className="card">
      <div className="chart-title">Ranking de liquidez — top {top}</div>
      <div className="chart-sub">Volume financeiro médio diário (R$). Clique para ver o fundo.</div>
      <ResponsiveContainer width="100%" height={Math.max(160, dados.length * 22 + 20)}>
        <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="ticker" width={62} tickLine={false} axisLine={false}
            tick={{ ...eixo, fill: "var(--text-2)", fontFamily: "IBM Plex Mono" }} />
          <Tooltip cursor={{ fill: "var(--accent-wash)" }} content={({ payload }) => {
            const f = payload?.[0]?.payload as FundoSnapshot | undefined;
            return f ? <div className="tip"><b>{f.ticker}</b> {f.nome}<br />{brl(f.volume_financeiro_medio, 0)}/pregão</div> : null;
          }} />
          <Bar isAnimationActive={false} dataKey="volume_financeiro_medio" fill="var(--accent)" radius={[0, 3, 3, 0]} barSize={14}
            cursor="pointer" onClick={(d) => nav(`/fundo/${(d as unknown as FundoSnapshot).ticker}`)}>
            <LabelList dataKey="volume_financeiro_medio" content={rotulo("right")} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DispersaoLiquidez({ fundos }: { fundos: FundoSnapshot[] }) {
  const nav = useNavigate();
  const tipos = [...new Set(fundos.map((f) => f.tipo_gestao ?? "—"))];
  const pontos = fundos.filter((f) => (f.volume_financeiro_medio ?? 0) > 0 && f.variacao_periodo_pct != null);
  return (
    <div className="card">
      <div className="chart-title">Liquidez × variação de preço no período</div>
      <div className="chart-sub">
        Eixo X em escala logarítmica. Fundos pouco negociados com variação forte podem ter o preço movido por poucos negócios.
      </div>
      <ResponsiveContainer width="100%" height={340}>
        <ScatterChart margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="var(--grid)" />
          <XAxis type="number" dataKey="volume_financeiro_medio" scale="log" domain={["auto", "auto"]}
            tickFormatter={compacto} tick={eixo} name="Liquidez" />
          <YAxis type="number" dataKey="variacao_periodo_pct" tickFormatter={(v: number) => `${v.toLocaleString("pt-BR")}%`} tick={eixo} width={48} />
          <ZAxis range={[70, 70]} />
          <ReferenceLine y={0} stroke="var(--baseline)" strokeDasharray="3 3" />
          <Tooltip content={({ payload }) => {
            const f = payload?.[0]?.payload as FundoSnapshot | undefined;
            return f ? (
              <div className="tip"><b>{f.ticker}</b> {f.nome}<br />{f.segmento}<br />
                Liquidez: {brl(f.volume_financeiro_medio, 0)}<br />Variação: {pct(f.variacao_periodo_pct)}</div>
            ) : null;
          }} />
          {tipos.map((t) => (
            <Scatter isAnimationActive={false} key={t} name={t} data={pontos.filter((f) => (f.tipo_gestao ?? "—") === t)}
              fill={COR_TIPO[t] ?? "var(--muted)"} stroke="var(--surface)" strokeWidth={1.5} cursor="pointer"
              onClick={(d) => nav(`/fundo/${(d as unknown as FundoSnapshot).ticker}`)} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
      <div className="legend">
        {tipos.map((t) => <span key={t}><i style={{ background: COR_TIPO[t] ?? "var(--muted)" }} />{t}</span>)}
      </div>
    </div>
  );
}

/** DY 12m por fundo, com a mediana do conjunto filtrado como referência. */
export function RankingDY({ fundos, top = 15 }: { fundos: FundoSnapshot[]; top?: number }) {
  const nav = useNavigate();
  const com = fundos.filter((f) => f.dy_12m_pct != null);
  const dados = [...com].sort((a, b) => (b.dy_12m_pct ?? 0) - (a.dy_12m_pct ?? 0)).slice(0, top);
  const v = com.map((f) => f.dy_12m_pct as number).sort((a, b) => a - b);
  const med = v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
  return (
    <div className="card">
      <div className="chart-title">Dividend yield 12 meses — top {Math.min(top, dados.length)}</div>
      <div className="chart-sub">
        Rendimentos dos últimos 12 meses ÷ preço atual. Linha tracejada = mediana dos fundos na tela
        {med != null ? ` (${taxa(med)})` : ""}. Cor = tipo de gestão.
      </div>
      {dados.length === 0 ? <div className="state">Sem rendimentos coletados ainda — rode coletar_dividendos.py.</div> : (
        <ResponsiveContainer width="100%" height={Math.max(160, dados.length * 22 + 20)}>
          <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }}>
            <XAxis type="number" hide domain={[0, "auto"]} />
            <YAxis type="category" dataKey="ticker" width={62} tickLine={false} axisLine={false}
              tick={{ ...eixo, fill: "var(--text-2)", fontFamily: "IBM Plex Mono" }} />
            {med != null && <ReferenceLine x={med} stroke="var(--text-2)" strokeDasharray="4 3" />}
            <Tooltip cursor={{ fill: "var(--accent-wash)" }} content={({ payload }) => {
              const f = payload?.[0]?.payload as FundoSnapshot | undefined;
              return f ? (
                <div className="tip"><b>{f.ticker}</b> {f.nome}<br />
                  DY 12m {taxa(f.dy_12m_pct)} · último {brlDiv(f.ultimo_dividendo)} ({taxa(f.dy_ultimo_pct)})<br />
                  {f.pagamentos_12m} pagamentos em 12 meses</div>
              ) : null;
            }} />
            <Bar isAnimationActive={false} dataKey="dy_12m_pct" radius={[0, 3, 3, 0]} barSize={14} cursor="pointer"
              onClick={(d) => nav(`/fundo/${(d as unknown as FundoSnapshot).ticker}`)}>
              {dados.map((f) => <Cell key={f.ticker} fill={COR_TIPO[f.tipo_gestao ?? ""] ?? "var(--muted)"} />)}
              <LabelList dataKey="dy_12m_pct" content={(p: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                <text x={p.x + p.width + 6} y={p.y + p.height / 2 + 4} fontSize={11} fontWeight={600} fill="var(--text)">
                  {taxa(p.value)}
                </text>
              )} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/** Preço × renda: P/VP no eixo X, DY 12m no Y. Referências: P/VP = 1 e o CDI
 *  líquido de IR. O canto superior esquerdo (abaixo do patrimônio e rendendo
 *  acima do CDI líquido) é onde vale olhar primeiro. */
export function DispersaoDYPVP({ fundos, cdiLiquido }: { fundos: FundoSnapshot[]; cdiLiquido: number | null }) {
  const nav = useNavigate();
  const pontos = fundos.filter((f) => f.p_vp != null && f.dy_12m_pct != null);
  const tipos = [...new Set(pontos.map((f) => f.tipo_gestao ?? "—"))];
  return (
    <div className="card">
      <div className="chart-title">Dividend yield 12m × P/VP</div>
      <div className="chart-sub">
        À esquerda da linha vertical, a cota custa menos que o patrimônio. Acima da horizontal, o DY supera o CDI
        líquido de IR{cdiLiquido != null ? ` (${taxa(cdiLiquido)})` : ""}. Canto superior esquerdo = barato e rendendo mais.
      </div>
      {pontos.length === 0 ? <div className="state">Precisa de P/VP (coletar_fundamentos.py) e DY (coletar_dividendos.py).</div> : (
        <>
          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="var(--grid)" />
              {/* domínios incluem as linhas de referência (P/VP 1 e CDI líquido), senão elas somem */}
              <XAxis type="number" dataKey="p_vp" tick={eixo} tickFormatter={mult} name="P/VP"
                domain={[(min: number) => Math.floor(Math.min(min, 1) * 20 - 1) / 20, (max: number) => Math.ceil(Math.max(max, 1) * 20 + 1) / 20]} />
              <YAxis type="number" dataKey="dy_12m_pct" tick={eixo} width={48}
                domain={[(min: number) => Math.floor(Math.min(min, cdiLiquido ?? min) - 0.5), (max: number) => Math.ceil(Math.max(max, cdiLiquido ?? max) + 0.5)]}
                tickFormatter={(v: number) => `${v.toLocaleString("pt-BR")}%`} />
              <ZAxis range={[70, 70]} />
              <ReferenceLine x={1} stroke="var(--baseline)" strokeDasharray="3 3" />
              {cdiLiquido != null && <ReferenceLine y={cdiLiquido} stroke="var(--baseline)" strokeDasharray="3 3" />}
              <Tooltip content={({ payload }) => {
                const f = payload?.[0]?.payload as FundoSnapshot | undefined;
                return f ? (
                  <div className="tip"><b>{f.ticker}</b> {f.nome}<br />{f.segmento}<br />
                    P/VP {mult(f.p_vp)} · DY 12m {taxa(f.dy_12m_pct)}</div>
                ) : null;
              }} />
              {tipos.map((t) => (
                <Scatter isAnimationActive={false} key={t} name={t} data={pontos.filter((f) => (f.tipo_gestao ?? "—") === t)}
                  fill={COR_TIPO[t] ?? "var(--muted)"} stroke="var(--surface)" strokeWidth={1.5} cursor="pointer"
                  onClick={(d) => nav(`/fundo/${(d as unknown as FundoSnapshot).ticker}`)} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
          <div className="legend">
            {tipos.map((t) => <span key={t}><i style={{ background: COR_TIPO[t] ?? "var(--muted)" }} />{t}</span>)}
          </div>
        </>
      )}
    </div>
  );
}
