import { useNavigate } from "react-router-dom";
import type { Faixa, FundoSnapshot, ItemChecklist } from "../api/types";
import { compacto, mult, taxa } from "../lib/format";
import { SinalBadge } from "./ui";

const nf = (casas: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas });

/** Formata um valor (ou limite de faixa) conforme a unidade do critério. */
function fmt(v: number | null, unidade: string, sinal = false): string {
  if (v == null) return "—";
  if (unidade === "R$") return compacto(v);
  if (unidade === "x") return mult(v);
  const s = sinal && v > 0 ? "+" : "";
  if (unidade === "p.p.") return `${s}${nf(2).format(v)} p.p.`;
  if (unidade === "%") return `${s}${nf(2).format(v)}%`;
  return nf(2).format(v);
}

function faixa(f: Faixa | null, unidade: string): string {
  if (!f || (f.min == null && f.max == null)) return "—";
  if (f.min != null && f.max != null) return `${fmt(f.min, unidade)} a ${fmt(f.max, unidade)}`;
  if (f.min != null) return `≥ ${fmt(f.min, unidade)}`;
  return `≤ ${fmt(f.max, unidade)}`;
}

/** Mostra "+" em diferenças e variações (p.p., ou % com faixas negativas),
 *  mas não em níveis como vacância. */
function comSinal(i: ItemChecklist): boolean {
  if (i.unidade === "p.p.") return true;
  if (i.unidade !== "%") return false;
  return [i.verde, i.amarelo].some((f) => (f?.min ?? 0) < 0 || (f?.max ?? 0) < 0);
}

export function ChecklistCard({ f }: { f: FundoSnapshot }) {
  if (!f.checklist.length) return null;
  const verdes = f.checklist.filter((i) => i.status === "verde").length;
  const vermelhos = f.checklist.filter((i) => i.status === "vermelho").length;
  const semDado = f.checklist.filter((i) => i.status === "sem_dado").length;
  return (
    <div className="card">
      <div className="checklist-head">
        <div>
          <div className="chart-title">Checklist de triagem</div>
          <div className="chart-sub">
            {verdes} de {f.checklist.length} critérios no verde · {vermelhos} no vermelho
            {semDado ? ` · ${semDado} sem dado` : ""} · cobertura {f.checklist_cobertura_pct}% do peso
          </div>
        </div>
        <SinalBadge sinal={f.checklist_sinal} nota={f.checklist_nota} />
      </div>
      <ul className="checklist">
        {f.checklist.map((i: ItemChecklist) => (
          <li key={i.id} className={`sinal-${i.status === "sem_dado" ? "cinza" : i.status}`}>
            <i aria-hidden="true" />
            <span className="nome">
              {i.nome}
              {i.eliminatorio && <span className="tag-elim" title="Se ficar vermelho, o sinal geral fica vermelho">eliminatório</span>}
            </span>
            <span className="valor num" aria-label={`${i.nome}: ${i.status}`}>
              {i.aviso
                ? <>{fmt(i.valor, i.unidade, comSinal(i))} <span className="tag-suspeito">suspeito</span></>
                : i.status === "sem_dado" ? "sem dado" : fmt(i.valor, i.unidade, comSinal(i))}
            </span>
            <span className="regra">
              verde {faixa(i.verde, i.unidade)} · amarelo {faixa(i.amarelo, i.unidade)} · peso {i.peso}
            </span>
            {i.aviso && <span className="aviso-dado">{i.aviso}</span>}
            {i.descricao && <span className="desc">{i.descricao}</span>}
          </li>
        ))}
      </ul>
      <p className="aviso-triagem">
        Triagem automática com critérios ajustáveis em <code>criterios_checklist.json</code>. Aponta onde olhar
        primeiro; não é recomendação de compra.
      </p>
    </div>
  );
}

/** Fundo atual lado a lado com os pares (mesmo grupo usado nas medianas). */
export function TabelaPares({ f, todos }: { f: FundoSnapshot; todos: FundoSnapshot[] }) {
  const nav = useNavigate();
  const pares = todos
    .filter((x) => x.grupo_pares && x.grupo_pares === f.grupo_pares)
    .sort((a, b) => (b.checklist_nota ?? -1) - (a.checklist_nota ?? -1));
  if (pares.length < 2) return null;
  return (
    <div className="card">
      <div className="chart-title">Comparação com os pares — {f.grupo_pares}</div>
      <div className="chart-sub">{pares.length} fundos do mesmo grupo, ordenados pela nota do checklist. Clique para abrir.</div>
      <div className="table-wrap" style={{ border: 0 }}>
        <table style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th>Fundo</th><th>Segmento</th><th>Checklist</th><th className="r">P/VP</th><th className="r">DY 12m</th>
              <th className="r">DY do mês</th><th className="r">Quedas 12m</th><th className="r">Liquidez/dia</th>
            </tr>
          </thead>
          <tbody>
            {pares.map((p) => (
              <tr key={p.ticker} className={p.ticker === f.ticker ? "atual" : ""} onClick={() => nav(`/fundo/${p.ticker}`)}>
                <td><span className="mono" style={{ fontWeight: 600 }}>{p.ticker}</span><span className="sub-name">{p.nome}</span></td>
                <td>{p.segmento}</td>
                <td><SinalBadge sinal={p.checklist_sinal} nota={p.checklist_nota} compacto /></td>
                <td className="r num">{mult(p.p_vp)}</td>
                <td className="r num">{taxa(p.dy_12m_pct)}</td>
                <td className="r num">{taxa(p.dy_ultimo_pct)}</td>
                <td className="r num">{p.quedas_dividendo_12m ?? "—"}</td>
                <td className="r num">{compacto(p.volume_financeiro_medio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
