import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { CalcHistorico } from "../components/CalcHistorico";
import { CalcMagico } from "../components/CalcMagico";
import { CalcMeta } from "../components/CalcMeta";
import { CalcRenda } from "../components/CalcRenda";
import { CalcSimulacao } from "../components/CalcSimulacao";
import { Estado, SinalBadge, TipoPill } from "../components/ui";
import { brl, brlDiv, data, taxa } from "../lib/format";
import { useAsync } from "../lib/useAsync";

/**
 * Calculadora de dividendos. Os blocos são construídos um de cada vez:
 *  1. Quanto vou receber            (feito)
 *  2. Meta de renda                 (feito)
 *  3. Número mágico                (feito)
 *  4. Simulação com aporte e reinvestimento (feito)
 *  5. E se eu tivesse investido em data passada (feito)
 */
export default function Calculadora() {
  const [params, setParams] = useSearchParams();
  const snap = useAsync(api.snapshot, []);
  if (!snap.data) return <Estado loading={snap.loading} error={snap.error} />;

  const ordenados = [...snap.data].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const ticker = (params.get("t") ?? "").toUpperCase();
  const f = snap.data.find((x) => x.ticker === ticker) ?? ordenados[0];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Calculadora de dividendos</h1>
          <p>Simulações com os preços e rendimentos reais do painel. Estimativas, não promessa de renda.</p>
        </div>
        <select value={f.ticker} aria-label="Escolher fundo"
          onChange={(e) => setParams((p) => { const n = new URLSearchParams(p); n.set("t", e.target.value); return n; }, { replace: true })}>
          {ordenados.map((x) => <option key={x.ticker} value={x.ticker}>{x.ticker} — {x.nome}</option>)}
        </select>
      </div>

      <div className="card calc-fundo">
        <div>
          <Link to={`/fundo/${f.ticker}`} className="mono calc-ticker">{f.ticker}</Link> <TipoPill tipo={f.tipo_gestao} />{" "}
          <SinalBadge sinal={f.checklist_sinal} nota={f.checklist_nota} />
          <div className="chart-sub">{f.nome} · {f.segmento}</div>
        </div>
        <div className="calc-resumo">
          <div><span>Preço</span><b className="num">{brl(f.preco)}</b><i>{data(f.data_pregao)}</i></div>
          <div><span>Último dividendo</span><b className="num">{brlDiv(f.ultimo_dividendo)}</b><i>data-ex {data(f.data_ultimo_dividendo)}</i></div>
          <div><span>Pago em 12 meses</span><b className="num">{brlDiv(f.dividendos_12m)}</b><i>{f.pagamentos_12m} pagamentos</i></div>
          <div><span>DY 12m</span><b className="num">{taxa(f.dy_12m_pct)}</b><i>sobre o preço atual</i></div>
        </div>
      </div>

      <section><CalcRenda f={f} /></section>
      <section><CalcMeta f={f} /></section>
      <section><CalcMagico f={f} /></section>
      <section><CalcSimulacao f={f} /></section>
      <section><CalcHistorico f={f} /></section>
    </>
  );
}
