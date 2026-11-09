import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RendimentoRecebido, ResumoRendimentos } from "../lib/carteira";
import { brl, brlDiv, data, inteiro } from "../lib/format";

const eixo = { fontSize: 11, fill: "var(--muted)" };
const rotuloMes = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesExtenso = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
const fmtEixo = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : v.toLocaleString("pt-BR"));

/** Bloco 4: rendimentos que caíram na carteira, mês a mês e por fundo. */
export function RendimentosCarteira({ r, lista, carregando }: { r: ResumoRendimentos; lista: RendimentoRecebido[]; carregando: boolean }) {
  const serie = r.porMes.slice(-24).map((p) => ({ ...p, valor: Math.round(p.valor * 100) / 100 }));
  return (
    <div className="card">
      <div className="chart-title">Rendimentos recebidos</div>
      <div className="chart-sub">
        Calculado com os rendimentos reais de cada fundo e as cotas que você tinha na véspera de cada data-ex.
        {carregando && " Carregando os rendimentos…"}
      </div>

      <div className="calc-kpis rend-kpis">
        <div><span>Total recebido</span><b className="num">{brl(r.total)}</b><i>{inteiro(lista.length)} pagamentos</i></div>
        <div><span>Últimos 12 meses</span><b className="num">{brl(r.ultimos12m)}</b></div>
        <div><span>Média por mês</span><b className="num">{brl(r.mediaMensal12m)}</b><i>nos últimos 12 meses</i></div>
      </div>

      {serie.length > 0 && (
        <>
          <div className="chart-title" style={{ marginTop: 8 }}>Por mês{r.porMes.length > 24 ? " (últimos 24 meses)" : ""}</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={serie} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="mes" tick={eixo} tickLine={false} axisLine={{ stroke: "var(--baseline)" }}
                tickFormatter={rotuloMes} minTickGap={8} />
              <YAxis tick={eixo} width={56} tickFormatter={fmtEixo} />
              <Tooltip cursor={{ fill: "var(--accent-wash)" }} content={({ payload }) => {
                const p = payload?.[0]?.payload as { mes: string; valor: number } | undefined;
                if (!p) return null;
                const doMes = lista.filter((x) => x.dataEx.startsWith(p.mes));
                return (
                  <div className="tip">
                    <b>{mesExtenso(p.mes)}: {brl(p.valor)}</b>
                    {doMes.map((x) => <div key={x.ticker + x.dataEx}>{x.ticker}: {brl(x.valor)}</div>)}
                  </div>
                );
              }} />
              <Bar dataKey="valor" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}

      {r.porFundo.length > 0 && (
        <div className="table-wrap" style={{ border: 0 }}>
          <table className="calc-tabela tabela-rend">
            <thead><tr><th>Fundo</th><th className="r">Total recebido</th><th className="r">Pagamentos</th><th className="r">Último (data-ex)</th></tr></thead>
            <tbody>
              {r.porFundo.map((f) => (
                <tr key={f.ticker}>
                  <td className="mono">{f.ticker}</td>
                  <td className="r num">{brl(f.total)}</td>
                  <td className="r num">{inteiro(f.pagamentos)}</td>
                  <td className="r num">{data(f.ultimo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lista.length > 0 && (
        <details className="calc-formulas">
          <summary>Todos os pagamentos ({lista.length})</summary>
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="calc-tabela tabela-rend">
              <thead><tr><th>Data-ex</th><th>Fundo</th><th className="r">Cotas</th><th className="r">Por cota</th><th className="r">Valor</th></tr></thead>
              <tbody>
                {lista.map((x) => (
                  <tr key={x.ticker + x.dataEx}>
                    <td className="num">{data(x.dataEx)}</td><td className="mono">{x.ticker}</td>
                    <td className="r num">{inteiro(x.cotas)}</td><td className="r num">{brlDiv(x.valorPorCota)}</td>
                    <td className="r num">{brl(x.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {!carregando && lista.length === 0 && (
        <p className="carteira-vazia-txt">Nenhum rendimento com data-ex depois das suas compras ainda.</p>
      )}
      <p className="calc-dica">
        A data é a data-ex; o dinheiro cai na conta alguns dias depois, na data de pagamento. Rendimento de FII é isento
        de IR para pessoa física (regra geral). Confira com o extrato da sua corretora: a fonte (Yahoo Finance) pode
        não ter algum pagamento ou amortização.
      </p>
    </div>
  );
}
