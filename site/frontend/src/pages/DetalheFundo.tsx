import { useNavigate, useParams } from "react-router-dom";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../api/client";
import { Link } from "react-router-dom";
import { ChecklistCard, TabelaPares } from "../components/Checklist";
import { DiagnosticoIA } from "../components/Diagnostico";
import { Delta, Estado, KpiCard, LiquidezBadge, SinalBadge, TipoPill } from "../components/ui";
import { brl, brlDiv, compacto, data, inteiro, mesAno, mult, pct, pp, taxa } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const eixo = { fontSize: 11, fill: "var(--muted)" };

export default function DetalheFundo() {
  const { ticker = "" } = useParams();
  const nav = useNavigate();
  const snap = useAsync(api.snapshot, []);
  const hist = useAsync(() => api.historico(ticker), [ticker]);
  const divs = useAsync(() => api.dividendos(ticker), [ticker]);

  if (!snap.data) return <Estado loading={snap.loading} error={snap.error} />;
  const ordenados = [...snap.data].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const f = snap.data.find((x) => x.ticker === ticker.toUpperCase());

  const seletor = (
    <select value={f?.ticker ?? ""} onChange={(e) => nav(`/fundo/${e.target.value}`)} aria-label="Escolher fundo">
      {!f && <option value="">Escolha um fundo…</option>}
      {ordenados.map((x) => <option key={x.ticker} value={x.ticker}>{x.ticker} — {x.nome}</option>)}
    </select>
  );

  if (!f) return (
    <>
      <div className="page-head"><div><h1>Detalhe por fundo</h1><p>Selecione um fundo para ver o histórico.</p></div>{seletor}</div>
    </>
  );

  const pontos = hist.data ?? [];
  const longa = pontos.length > 60;
  // Séries longas: rótulo mm/aa (dd/mm fica ambíguo quando cruza o ano)
  const serie = pontos.map((p) => ({ ...p, rotulo: data(p.data_pregao).slice(0, 5) }));
  // Em séries longas, um rótulo por mês (primeiro pregão do mês), no formato mm/aa
  const ticksMes = longa
    ? pontos.filter((p, i) => i > 0 && p.data_pregao.slice(0, 7) !== pontos[i - 1].data_pregao.slice(0, 7)).map((p) => p.data_pregao)
    : undefined;
  const eixoX = longa
    ? { dataKey: "data_pregao", ticks: ticksMes, tickFormatter: (v: string) => v.slice(5, 7) + "/" + v.slice(2, 4), interval: "preserveStartEnd" as const, minTickGap: 16 }
    : { dataKey: "rotulo" };
  const maxDiv = Math.max(0, ...(divs.data ?? []).map((d) => d.valor));
  const casasDiv = maxDiv < 1 ? 3 : 2;
  const serieDiv = (divs.data ?? []).slice(-24).map((d) => ({ ...d, rotulo: data(d.data_ex).slice(3, 5) + "/" + d.data_ex.slice(2, 4) }));
  const tendencia = f.tendencia_dividendo_pct;

  return (
    <>
      <div className="page-head">
        <div>
          <h1><span className="mono">{f.ticker}</span> <TipoPill tipo={f.tipo_gestao} />{" "}
            {f.checklist.length > 0 && <SinalBadge sinal={f.checklist_sinal} nota={f.checklist_nota} />}</h1>
          <p>{f.nome} · {f.gestora} · {f.segmento}</p>
        </div>
        <div className="head-acoes">
          <Link className="btn" to={`/comparar?a=${f.ticker}`}>Comparar com…</Link>
          {seletor}
        </div>
      </div>

      <section className="kpis kpis-3">
        <KpiCard label="Preço atual" value={brl(f.preco)} sub={`pregão de ${data(f.data_pregao)}`} />
        <KpiCard label="Último dividendo" value={brlDiv(f.ultimo_dividendo)}
          sub={f.data_ultimo_dividendo ? `data-ex ${data(f.data_ultimo_dividendo)} · DY do mês ${taxa(f.dy_ultimo_pct)}` : "sem rendimentos coletados"} />
        <KpiCard label="Dividend yield 12m" value={taxa(f.dy_12m_pct)}
          sub={f.dy_12m_vs_pares_pp != null
            ? <><span className={f.dy_12m_vs_pares_pp >= 0 ? "up" : "down"}>{pp(f.dy_12m_vs_pares_pp)}</span> vs. mediana de {f.grupo_pares} ({taxa(f.dy_12m_mediana_pares_pct)})</>
            : `${f.pagamentos_12m} pagamentos em 12 meses`} />
        <KpiCard label="Retorno total 12m" value={<Delta valor={f.retorno_total_12m_pct} />}
          sub={f.retorno_total_12m_pct != null ? <>preço {pct(f.variacao_preco_12m_pct)} + rendimentos {brlDiv(f.dividendos_12m)}</> : "precisa de 12 meses de cotações"} />
        <KpiCard label="P/VP" value={mult(f.p_vp)}
          sub={f.p_vp == null ? "sem valor patrimonial coletado" : <>
            {f.vp_cota != null ? <>VP/cota {brl(f.vp_cota)} ({f.fonte_p_vp} {mesAno(f.data_ref_vp)})</> : `fonte: ${f.fonte_p_vp}`}
            {f.p_vp_vs_pares != null && <><br /><span className={f.p_vp_vs_pares <= 0 ? "up" : "down"}>{f.p_vp_vs_pares > 0 ? "+" : ""}{mult(f.p_vp_vs_pares)}</span> vs. mediana de {f.grupo_pares} ({mult(f.p_vp_mediana_pares)})</>}
          </>} />
        <KpiCard label="Classificação de liquidez" value={<LiquidezBadge valor={f.liquidez} />}
          sub={`${f.rank_liquidez}º de ${snap.data.length} · ${compacto(f.volume_financeiro_medio)}/pregão`} />
      </section>

      <section className="stack">
        <ChecklistCard f={f} />
        <DiagnosticoIA tickers={[f.ticker]} />
        <TabelaPares f={f} todos={snap.data} />
      </section>

      <section className="card">
        <div className="chart-title">Preço de fechamento</div>
        <div className="chart-sub">R$ por cota, um ponto por pregão coletado</div>
        {hist.data ? (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={serie} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis {...eixoX} tick={eixo} tickLine={false} axisLine={{ stroke: "var(--baseline)" }} />
              <YAxis domain={["auto", "auto"]} tick={eixo} width={56} tickFormatter={(v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
              <Tooltip content={({ payload }) => {
                const p = payload?.[0]?.payload;
                return p ? <div className="tip">{data(p.data_pregao)}<br /><b>{brl(p.preco)}</b> ({pct(p.variacao_dia_pct)})</div> : null;
              }} />
              <Area isAnimationActive={false} type="monotone" dataKey="preco" stroke="var(--accent)" strokeWidth={2} fill="url(#g)" dot={longa ? false : { r: 3 }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : <Estado loading={hist.loading} error={hist.error} />}
      </section>

      <section className="card">
        <div className="chart-title">Rendimentos por cota</div>
        <div className="chart-sub">
          Últimos {serieDiv.length} pagamentos, pela data-ex (R$ por cota). No tooltip, o DY de cada pagamento sobre o
          preço do último dia com direito ao rendimento.
        </div>
        {divs.data ? (serieDiv.length ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={serieDiv} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="rotulo" tick={eixo} tickLine={false} axisLine={{ stroke: "var(--baseline)" }} />
              <YAxis tick={eixo} width={56} tickFormatter={(v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: casasDiv, maximumFractionDigits: casasDiv })} />
              <Tooltip cursor={{ fill: "var(--accent-wash)" }} content={({ payload }) => {
                const p = payload?.[0]?.payload;
                return p ? <div className="tip">data-ex {data(p.data_ex)}<br /><b>{brlDiv(p.valor)}</b>{p.dy_pct != null && <> · DY {taxa(p.dy_pct)}</>}</div> : null;
              }} />
              <Bar isAnimationActive={false} dataKey="valor" fill="var(--hibrido)" radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        ) : <div className="state">Nenhum rendimento registrado para este fundo.</div>)
          : <Estado loading={divs.loading} error={divs.error} />}
      </section>

      <section className="stack">
        <div className="card">
          <div className="chart-title">Volume financeiro por pregão</div>
          <div className="chart-sub">Preço × cotas negociadas (R$)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={serie} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <XAxis {...eixoX} tick={eixo} tickLine={false} axisLine={{ stroke: "var(--baseline)" }} />
              <YAxis tick={eixo} width={72} tickFormatter={(v: number) => (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi"} />
              <Tooltip cursor={{ fill: "var(--accent-wash)" }} content={({ payload }) => {
                const p = payload?.[0]?.payload;
                return p ? <div className="tip">{data(p.data_pregao)}<br /><b>{brl(p.volume_financeiro, 0)}</b><br />{inteiro(p.volume_cotas)} cotas</div> : null;
              }} />
              <Bar isAnimationActive={false} dataKey="volume_financeiro" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <div className="chart-title">Estatísticas</div>
          <div className="stats-group">Renda (12 meses)</div>
          <dl className="stats">
            <div><dt>Rendimentos somados</dt><dd className="num">{brlDiv(f.dividendos_12m)}</dd></div>
            <div><dt>Pagamentos</dt><dd className="num">{f.pagamentos_12m}</dd></div>
            <div><dt>Média por pagamento</dt><dd className="num">{brlDiv(f.media_dividendo_12m)}</dd></div>
            <div><dt>Média dos 3 últimos</dt><dd className="num">{brlDiv(f.media_dividendo_3_ult)}</dd></div>
            <div><dt>Tendência (3 últimos vs. 12m)</dt>
              <dd className={`num ${tendencia == null ? "" : tendencia <= -10 ? "crit" : tendencia < -3 ? "warn" : "up"}`}>{pct(tendencia, 1)}</dd></div>
            <div><dt>Variação dos pagamentos (CV)</dt>
              <dd className={`num ${f.estabilidade_cv_pct == null ? "" : f.estabilidade_cv_pct > 25 ? "warn" : ""}`}>{taxa(f.estabilidade_cv_pct, 1)}</dd></div>
            <div><dt>Quedas de rendimento</dt>
              <dd className={`num ${f.quedas_dividendo_12m ? "crit" : ""}`}>{f.quedas_dividendo_12m ?? "—"}</dd></div>
            <div><dt>DY 12m − CDI líquido de IR</dt>
              <dd className={`num ${f.spread_cdi_liquido_pp == null ? "" : f.spread_cdi_liquido_pp >= 0 ? "up" : "down"}`}>{pp(f.spread_cdi_liquido_pp)}</dd></div>
            <div><dt>DY real (descontado IPCA 12m)</dt><dd className="num">{taxa(f.dy_real_pct)}</dd></div>
          </dl>
          <div className="stats-group">Fundamentos{f.data_ref_vp ? ` (informe CVM ${mesAno(f.data_ref_vp)})` : ""}</div>
          <dl className="stats">
            <div><dt>Patrimônio líquido</dt><dd className="num">{compacto(f.patrimonio_liquido)}</dd></div>
            <div><dt>VP por cota em 12 meses</dt>
              <dd className={`num ${f.vp_var_12m_pct == null ? "" : f.vp_var_12m_pct <= -5 ? "crit" : f.vp_var_12m_pct < 0 ? "warn" : ""}`}>{pct(f.vp_var_12m_pct)}</dd></div>
            <div><dt>Cotistas</dt><dd className="num">{inteiro(f.cotistas)}{f.cotistas_var_12m_pct != null && <span className="dd-sub"> ({pct(f.cotistas_var_12m_pct, 1)} em 12m)</span>}</dd></div>
            {(f.qtd_imoveis ?? 0) > 0 && <>
              <div><dt>Imóveis</dt><dd className="num">{inteiro(f.qtd_imoveis)}</dd></div>
              <div><dt>Vacância média</dt>
                <dd className={`num ${f.vacancia_pct == null ? "" : f.vacancia_pct > 15 ? "crit" : f.vacancia_pct > 7 ? "warn" : ""}`}>{taxa(f.vacancia_pct)}</dd></div>
              <div><dt>Cap rate</dt><dd className="num">{taxa(f.cap_rate_pct)}</dd></div>
            </>}
            <div><dt>FFO yield</dt><dd className="num">{taxa(f.ffo_yield_pct)}</dd></div>
          </dl>
          <div className="stats-group">Preço e negociação (período coletado)</div>
          <dl className="stats">
            <div><dt>Variação no período</dt><dd><Delta valor={f.variacao_periodo_pct} /></dd></div>
            <div><dt>Variação no último pregão</dt><dd><Delta valor={f.variacao_dia_pct} /></dd></div>
            <div><dt>Mínima</dt><dd className="num">{brl(f.preco_min)}</dd></div>
            <div><dt>Máxima</dt><dd className="num">{brl(f.preco_max)}</dd></div>
            <div><dt>Volatilidade (desvio dos retornos diários)</dt><dd className="num">{taxa(f.volatilidade_pct)}</dd></div>
            <div><dt>Pregões coletados</dt><dd className="num">{f.pregoes}</dd></div>
            <div><dt>Cotas negociadas (último pregão)</dt><dd className="num">{inteiro(f.volume_cotas)}</dd></div>
            <div><dt>Volume financeiro (último pregão)</dt><dd className="num">{brl(f.volume_financeiro, 0)}</dd></div>
          </dl>
        </div>
      </section>
    </>
  );
}
