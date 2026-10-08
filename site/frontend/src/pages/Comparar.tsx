import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../api/client";
import type { FundoSnapshot } from "../api/types";
import { DiagnosticoIA } from "../components/Diagnostico";
import { Estado, SinalBadge, TipoPill } from "../components/ui";
import { brl, brlDiv, compacto, data, inteiro, mult, pct, pp, taxa } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const eixo = { fontSize: 11, fill: "var(--muted)" };
const COR = ["var(--cmp-a)", "var(--cmp-b)"];

type Linha = {
  titulo: string;
  valor: (f: FundoSnapshot) => number | null | undefined;
  fmt: (v: number | null | undefined) => string;
  /** "maior"/"menor" destaca o melhor; null = não há "melhor" óbvio (ex: DY alto pode ser armadilha) */
  melhor: "maior" | "menor" | null;
  nota?: string;
};

const GRUPOS: { titulo: string; linhas: Linha[] }[] = [
  {
    titulo: "Triagem",
    linhas: [
      { titulo: "Nota do checklist", valor: (f) => f.checklist_nota, fmt: (v) => (v == null ? "—" : String(v)), melhor: "maior" },
    ],
  },
  {
    titulo: "Renda",
    linhas: [
      { titulo: "DY 12 meses", valor: (f) => f.dy_12m_pct, fmt: (v) => taxa(v), melhor: null, nota: "DY muito alto pode ser preço derrubado" },
      { titulo: "DY vs. mediana dos pares", valor: (f) => f.dy_12m_vs_pares_pp, fmt: (v) => pp(v), melhor: null },
      { titulo: "DY − CDI líquido", valor: (f) => f.spread_cdi_liquido_pp, fmt: (v) => pp(v), melhor: null },
      { titulo: "Último dividendo (DY do mês)", valor: (f) => f.dy_ultimo_pct, fmt: (v) => taxa(v), melhor: null },
      { titulo: "Tendência da renda", valor: (f) => f.tendencia_dividendo_pct, fmt: (v) => pct(v, 1), melhor: "maior" },
      { titulo: "Quedas de rendimento em 12m", valor: (f) => f.quedas_dividendo_12m, fmt: (v) => (v == null ? "—" : String(v)), melhor: "menor" },
      { titulo: "Variação dos pagamentos (CV)", valor: (f) => f.estabilidade_cv_pct, fmt: (v) => taxa(v, 1), melhor: "menor" },
    ],
  },
  {
    titulo: "Preço e patrimônio",
    linhas: [
      { titulo: "Preço atual", valor: (f) => f.preco, fmt: (v) => brl(v), melhor: null },
      { titulo: "P/VP", valor: (f) => f.p_vp, fmt: (v) => mult(v), melhor: null, nota: "abaixo de 1 é desconto, mas desconto grande pede cuidado" },
      { titulo: "VP por cota em 12m", valor: (f) => f.vp_var_12m_pct, fmt: (v) => pct(v), melhor: "maior" },
      { titulo: "Retorno total 12m", valor: (f) => f.retorno_total_12m_pct, fmt: (v) => pct(v), melhor: "maior" },
      { titulo: "Patrimônio líquido", valor: (f) => f.patrimonio_liquido, fmt: (v) => compacto(v), melhor: null },
      { titulo: "Cotistas (variação 12m)", valor: (f) => f.cotistas_var_12m_pct, fmt: (v) => pct(v, 1), melhor: null },
    ],
  },
  {
    titulo: "Risco e negociação",
    linhas: [
      { titulo: "Liquidez média diária", valor: (f) => f.volume_financeiro_medio, fmt: (v) => compacto(v), melhor: "maior" },
      { titulo: "Volatilidade diária", valor: (f) => f.volatilidade_pct, fmt: (v) => taxa(v), melhor: "menor" },
      { titulo: "Vacância (Fundamentus)", valor: (f) => f.vacancia_pct, fmt: (v) => taxa(v), melhor: "menor" },
      { titulo: "Imóveis", valor: (f) => f.qtd_imoveis, fmt: (v) => inteiro(v), melhor: null },
    ],
  },
];

function vencedor(l: Linha, a: FundoSnapshot, b: FundoSnapshot): 0 | 1 | null {
  const va = l.valor(a), vb = l.valor(b);
  if (!l.melhor || va == null || vb == null || va === vb) return null;
  return (l.melhor === "maior") === va > vb ? 0 : 1;
}

export default function Comparar() {
  const [params, setParams] = useSearchParams();
  const ta = (params.get("a") ?? "").toUpperCase();
  const tb = (params.get("b") ?? "").toUpperCase();
  const snap = useAsync(api.snapshot, []);
  const ha = useAsync(() => (ta ? api.historico(ta) : Promise.resolve([])), [ta]);
  const hb = useAsync(() => (tb ? api.historico(tb) : Promise.resolve([])), [tb]);
  const da = useAsync(() => (ta ? api.dividendos(ta) : Promise.resolve([])), [ta]);
  const db = useAsync(() => (tb ? api.dividendos(tb) : Promise.resolve([])), [tb]);

  const set = (k: "a" | "b", v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };

  // Preço em base 100, só nas datas em que os dois têm cotação
  const precos = useMemo(() => {
    if (!ha.data?.length || !hb.data?.length) return [];
    const mb = new Map(hb.data.map((p) => [p.data_pregao, p.preco]));
    const comuns = ha.data.filter((p) => p.preco != null && mb.get(p.data_pregao) != null);
    if (!comuns.length) return [];
    const a0 = comuns[0].preco as number, b0 = mb.get(comuns[0].data_pregao) as number;
    return comuns.map((p) => ({
      data: p.data_pregao,
      a: +(((p.preco as number) / a0) * 100).toFixed(2),
      b: +(((mb.get(p.data_pregao) as number) / b0) * 100).toFixed(2),
    }));
  }, [ha.data, hb.data]);

  // DY de cada pagamento dos últimos 12 meses, agrupado por mês da data-ex
  const rendimentos = useMemo(() => {
    const porMes = new Map<string, { mes: string; a?: number | null; b?: number | null }>();
    const add = (lista: typeof da.data, k: "a" | "b") =>
      (lista ?? []).slice(-12).forEach((d) => {
        const mes = d.data_ex.slice(0, 7);
        const item = porMes.get(mes) ?? { mes };
        item[k] = d.dy_pct;
        porMes.set(mes, item);
      });
    add(da.data, "a"); add(db.data, "b");
    return [...porMes.values()].sort((x, y) => x.mes.localeCompare(y.mes)).slice(-12)
      .map((x) => ({ ...x, rotulo: `${x.mes.slice(5, 7)}/${x.mes.slice(2, 4)}` }));
  }, [da.data, db.data]);

  if (!snap.data) return <Estado loading={snap.loading} error={snap.error} />;
  const ordenados = [...snap.data].sort((x, y) => x.ticker.localeCompare(y.ticker));
  const A = snap.data.find((f) => f.ticker === ta);
  const B = snap.data.find((f) => f.ticker === tb);
  const seletor = (k: "a" | "b", atual: string, outro: string) => (
    <select value={atual} onChange={(e) => set(k, e.target.value)} aria-label={`Fundo ${k.toUpperCase()}`}
      className={`sel-cmp sel-${k}`}>
      <option value="">Escolha um fundo…</option>
      {ordenados.map((x) => <option key={x.ticker} value={x.ticker} disabled={x.ticker === outro}>{x.ticker} — {x.nome}</option>)}
    </select>
  );

  // Critérios do checklist lado a lado (união dos dois, na ordem do primeiro)
  const criterios = A && B ? [...new Map([...A.checklist, ...B.checklist].map((i) => [i.id, i.nome])).entries()] : [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Comparar fundos</h1>
          <p>Dois FIIs lado a lado: indicadores, checklist, preço e rendimentos. O destaque ▲ marca o melhor valor
            só onde "melhor" não depende de interpretação.</p>
        </div>
      </div>
      <div className="cmp-seletores">
        {seletor("a", ta, tb)}<span className="vs">×</span>{seletor("b", tb, ta)}
      </div>

      {!(A && B) ? (
        <div className="state">Escolha dois fundos para comparar.</div>
      ) : (
        <>
          <section className="grid-2 grid-2-even">
            {[A, B].map((f, i) => (
              <div key={f.ticker} className="card cmp-fundo" style={{ ["--c" as string]: COR[i] }}>
                <div className="checklist-head">
                  <div>
                    <div className="cmp-ticker"><i aria-hidden="true" /><Link to={`/fundo/${f.ticker}`} className="mono">{f.ticker}</Link> <TipoPill tipo={f.tipo_gestao} /></div>
                    <div className="chart-sub">{f.nome} · {f.segmento}</div>
                  </div>
                  <SinalBadge sinal={f.checklist_sinal} nota={f.checklist_nota} />
                </div>
                <div className="cmp-destaques">
                  <div><span>Preço</span><b className="num">{brl(f.preco)}</b></div>
                  <div><span>DY 12m</span><b className="num">{taxa(f.dy_12m_pct)}</b></div>
                  <div><span>P/VP</span><b className="num">{mult(f.p_vp)}</b></div>
                  <div><span>Último div.</span><b className="num">{brlDiv(f.ultimo_dividendo)}</b></div>
                </div>
              </div>
            ))}
          </section>

          <section className="card">
            <div className="chart-title">Indicadores lado a lado</div>
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="cmp-tabela" style={{ minWidth: 520 }}>
                <thead>
                  <tr><th>Indicador</th><th className="r cmp-a">{A.ticker}</th><th className="r cmp-b">{B.ticker}</th></tr>
                </thead>
                {GRUPOS.map((g) => (
                  <tbody key={g.titulo}>
                    <tr className="grupo"><td colSpan={3}>{g.titulo}</td></tr>
                    {g.linhas.map((l) => {
                      const v = vencedor(l, A, B);
                      return (
                        <tr key={l.titulo}>
                          <td>{l.titulo}{l.nota && <span className="sub-name">{l.nota}</span>}</td>
                          {[A, B].map((f, i) => (
                            <td key={f.ticker} className={`r num ${v === i ? "melhor" : ""}`}>
                              {l.fmt(l.valor(f))}{v === i && <span className="tag-melhor" aria-label="melhor"> ▲</span>}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
                <tbody>
                  <tr className="grupo"><td colSpan={3}>Checklist</td></tr>
                  {criterios.map(([id, nome]) => (
                    <tr key={id}>
                      <td>{nome}</td>
                      {[A, B].map((f) => {
                        const it = f.checklist.find((x) => x.id === id);
                        return (
                          <td key={f.ticker} className="r">
                            {!it ? <span className="sub-name">não se aplica</span>
                              : it.aviso ? <span className="tag-suspeito" title={it.aviso}>suspeito</span>
                              : it.status === "sem_dado" ? <span className="sub-name">sem dado</span>
                                : <SinalBadge sinal={it.status} nota={null} />}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid-2 grid-2-even">
            <div className="card">
              <div className="chart-title">Preço em base 100</div>
              <div className="chart-sub">Os dois começam em 100 no primeiro pregão em comum. Só preço, sem dividendos.</div>
              {precos.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={precos} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="data" tick={eixo} tickLine={false} minTickGap={40}
                      tickFormatter={(v: string) => `${v.slice(5, 7)}/${v.slice(2, 4)}`} axisLine={{ stroke: "var(--baseline)" }} />
                    <YAxis tick={eixo} width={40} domain={["auto", "auto"]} />
                    <Tooltip content={({ payload }) => {
                      const p = payload?.[0]?.payload;
                      return p ? <div className="tip">{data(p.data)}<br /><b>{A.ticker}</b> {p.a} · <b>{B.ticker}</b> {p.b}</div> : null;
                    }} />
                    <Legend formatter={(v) => (v === "a" ? A.ticker : B.ticker)} wrapperStyle={{ fontSize: 12 }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="a" stroke={COR[0]} strokeWidth={2} dot={false} />
                    <Line isAnimationActive={false} type="monotone" dataKey="b" stroke={COR[1]} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <Estado loading={ha.loading || hb.loading} error={ha.error || hb.error} />}
            </div>
            <div className="card">
              <div className="chart-title">DY de cada pagamento (12 meses)</div>
              <div className="chart-sub">Rendimento ÷ preço na data-com, mês a mês.</div>
              {rendimentos.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={rendimentos} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="rotulo" tick={eixo} tickLine={false} axisLine={{ stroke: "var(--baseline)" }} />
                    <YAxis tick={eixo} width={44} tickFormatter={(v: number) => `${v.toLocaleString("pt-BR")}%`} />
                    <Tooltip cursor={{ fill: "var(--accent-wash)" }} content={({ payload }) => {
                      const p = payload?.[0]?.payload;
                      return p ? <div className="tip">{p.rotulo}<br /><b>{A.ticker}</b> {taxa(p.a)} · <b>{B.ticker}</b> {taxa(p.b)}</div> : null;
                    }} />
                    <Legend formatter={(v) => (v === "a" ? A.ticker : B.ticker)} wrapperStyle={{ fontSize: 12 }} />
                    <Bar isAnimationActive={false} dataKey="a" fill={COR[0]} radius={[3, 3, 0, 0]} maxBarSize={18} />
                    <Bar isAnimationActive={false} dataKey="b" fill={COR[1]} radius={[3, 3, 0, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <Estado loading={da.loading || db.loading} error={da.error || db.error} />}
            </div>
          </section>

          <section><DiagnosticoIA tickers={[A.ticker, B.ticker]} /></section>
        </>
      )}
    </>
  );
}
