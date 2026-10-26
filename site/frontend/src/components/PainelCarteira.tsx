import { useState } from "react";
import { Link } from "react-router-dom";
import type { FundoSnapshot } from "../api/types";
import type { Fatia, ResumoCarteira } from "../lib/carteira";
import { brl, data, inteiro, pct, taxa } from "../lib/format";
import { KpiCard, SinalBadge, TipoPill } from "./ui";

const sinalTxt = (v: number | null) => pct(v);           // já vem com "+" quando positivo
/** R$ com sinal na frente: "+R$ 100,00" / "−R$ 10,50". */
const brlSinal = (v: number | null) =>
  v == null ? "—" : `${v > 0.004 ? "+" : v < -0.004 ? "−" : ""}${brl(Math.abs(v))}`;
const fatiaPct = (v: number | null) => taxa(v, 1);       // participação: sem sinal
const classe = (v: number | null) => (v == null || Math.abs(v) < 0.005 ? "" : v > 0 ? "up" : "down");

/** Bloco 3: os quatro números da carteira. */
export function KpisCarteira({ r }: { r: ResumoCarteira }) {
  return (
    <section className="kpis kpis-4" aria-label="Resumo da carteira">
      <KpiCard label="Patrimônio" value={brl(r.valor)} sub={`você pagou ${brl(r.custo)}`} />
      <KpiCard label="Resultado" value={<span className={classe(r.resultado)}>{brlSinal(r.resultado)}</span>}
        sub={<><span className={classe(r.resultadoPct)}>{sinalTxt(r.resultadoPct)}</span> · só a variação das cotas, sem os rendimentos</>} />
      <KpiCard label="Renda mensal estimada" value={brl(r.rendaMensal)}
        sub={`último rendimento × cotas · ${brl(r.renda12m)} em 12 meses`} />
      <KpiCard label="Yield on cost" value={taxa(r.yocPct)}
        sub={`rendimentos de 12 meses ÷ o que você pagou · sobre o valor atual: ${taxa(r.dyAtualPct)}`} />
    </section>
  );
}

/** Tabela de posições com preço atual, resultado e renda de cada fundo. */
export function TabelaPosicao({ r, porTicker }: { r: ResumoCarteira; porTicker: Map<string, FundoSnapshot> }) {
  const ultimoPregao = r.linhas.map((l) => porTicker.get(l.ticker)?.data_pregao).filter(Boolean).sort().at(-1);
  return (
    <div className="card">
      <div className="chart-title">Posição</div>
      <div className="chart-sub">
        Preço atual do último pregão{ultimoPregao ? ` (${data(ultimoPregao)})` : ""}. Preço médio pelo método da Receita: compras
        somam ao custo; vendas não mudam o preço médio.
      </div>
      <div className="table-wrap" style={{ border: 0 }}>
        <table className="calc-tabela tabela-posicao">
          <thead>
            <tr>
              <th>Fundo</th><th>Checklist</th><th className="r">Cotas</th><th className="r">Preço médio</th>
              <th className="r">Preço atual</th><th className="r">Valor atual</th><th className="r">Resultado</th>
              <th className="r">Renda/mês</th><th className="r">Yield on cost</th><th className="r">Peso</th>
            </tr>
          </thead>
          <tbody>
            {r.linhas.map((l) => {
              const f = porTicker.get(l.ticker);
              return (
                <tr key={l.ticker}>
                  <td>
                    <Link to={`/fundo/${l.ticker}`} className="mono" style={{ fontWeight: 600 }}>{l.ticker}</Link>{" "}
                    <TipoPill tipo={f?.tipo_gestao ?? null} />
                    <span className="sub-name">{f?.nome ?? "fora da lista do site"}</span>
                  </td>
                  <td>{f ? <SinalBadge sinal={f.checklist_sinal} nota={f.checklist_nota} compacto /> : "—"}</td>
                  <td className="r num">{inteiro(l.quantidade)}</td>
                  <td className="r num">{brl(l.precoMedio)}</td>
                  <td className="r num">{brl(l.precoAtual)}</td>
                  <td className="r num"><b>{brl(l.valorAtual)}</b></td>
                  <td className="r num">
                    <span className={classe(l.resultado)}>{brlSinal(l.resultado)}</span>
                    <span className="sub-name"><span className={classe(l.resultadoPct)}>{sinalTxt(l.resultadoPct)}</span></span>
                  </td>
                  <td className="r num">{brl(l.rendaMensal)}</td>
                  <td className="r num">{taxa(l.yocPct)}</td>
                  <td className="r num">{fatiaPct(l.pesoPct)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td><b>Total</b></td><td /><td /><td className="r num">{brl(r.custo)}<span className="sub-name">custo total</span></td><td />
              <td className="r num"><b>{brl(r.valor)}</b></td>
              <td className="r num"><b className={classe(r.resultado)}>{brlSinal(r.resultado)}</b>
                <span className="sub-name"><span className={classe(r.resultadoPct)}>{sinalTxt(r.resultadoPct)}</span></span></td>
              <td className="r num"><b>{brl(r.rendaMensal)}</b></td>
              <td className="r num"><b>{taxa(r.yocPct)}</b></td>
              <td className="r num">100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {r.semPreco.length > 0 && (
        <p className="calc-aviso">
          Sem cotação no site: {r.semPreco.join(", ")}. Esses fundos entram no custo, mas ficam fora do patrimônio,
          do resultado e da divisão da carteira.
        </p>
      )}
      <p className="calc-dica">
        Renda/mês usa o último rendimento pago por cota; yield on cost usa os rendimentos por cota dos últimos 12
        meses sobre o seu preço médio. O resultado ainda não soma os rendimentos que você recebeu (próximo bloco).
      </p>
    </div>
  );
}

function ListaBarras({ fatias }: { fatias: Fatia[] }) {
  const maior = Math.max(...fatias.map((f) => f.pct), 0);
  return (
    <ul className="barras" role="list">
      {fatias.map((f) => (
        <li key={f.nome} title={`${f.nome}: ${fatiaPct(f.pct)} · ${brl(f.valor)} · ${f.fundos} fundo${f.fundos > 1 ? "s" : ""}`}>
          <span className="barra-nome">{f.nome}</span>
          <span className="barra-trilho" aria-hidden="true">
            <span className="barra" style={{ width: `${maior > 0 ? (f.pct / maior) * 100 : 0}%` }} />
          </span>
          <span className="barra-pct num">{fatiaPct(f.pct)}</span>
          <span className="barra-valor num">{brl(f.valor, 0)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Divisão do patrimônio por segmento ou por tipo de gestão. */
export function DivisaoCarteira({ r }: { r: ResumoCarteira }) {
  const [por, setPor] = useState<"segmento" | "tipo">("segmento");
  const fatias = por === "segmento" ? r.porSegmento : r.porTipo;
  const maior = fatias[0];
  return (
    <div className="card">
      <div className="checklist-head">
        <div>
          <div className="chart-title">Divisão da carteira</div>
          <div className="chart-sub">Fatia do patrimônio atual.</div>
        </div>
        <div className="seg" role="radiogroup" aria-label="Dividir por">
          <button role="radio" aria-checked={por === "segmento"} onClick={() => setPor("segmento")}>Segmento</button>
          <button role="radio" aria-checked={por === "tipo"} onClick={() => setPor("tipo")}>Tipo</button>
        </div>
      </div>
      {fatias.length ? <ListaBarras fatias={fatias} /> : <p className="carteira-vazia-txt">Sem fundos com cotação.</p>}
      {maior && maior.pct >= 50 && fatias.length > 0 && (
        <p className="calc-aviso">
          {taxa(maior.pct, 0)} do patrimônio está em {por === "segmento" ? "um só segmento" : "um só tipo"} ({maior.nome}).
          Concentração alta deixa a carteira mais sensível a um mesmo risco.
        </p>
      )}
    </div>
  );
}
