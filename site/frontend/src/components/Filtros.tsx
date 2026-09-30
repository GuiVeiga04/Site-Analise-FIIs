import { useSearchParams } from "react-router-dom";

/** Filtros da Visão Geral (equivalem aos slicers do Power BI). Ficam na URL,
 *  então um link já abre com o filtro aplicado. */
export function useFiltros() {
  const [params, setParams] = useSearchParams();
  const tipos = params.getAll("tipo");
  const segmento = params.get("segmento") ?? "";
  const busca = params.get("q") ?? "";
  const sinais = params.getAll("sinal");

  function atualizar(fn: (p: URLSearchParams) => void) {
    const p = new URLSearchParams(params);
    fn(p);
    setParams(p, { replace: true });
  }
  return {
    tipos, segmento, busca, sinais,
    alternarSinal: (s: string) =>
      atualizar((p) => {
        const atual = p.getAll("sinal");
        p.delete("sinal");
        (atual.includes(s) ? atual.filter((x) => x !== s) : [...atual, s]).forEach((x) => p.append("sinal", x));
      }),
    alternarTipo: (t: string) =>
      atualizar((p) => {
        const atual = p.getAll("tipo");
        p.delete("tipo");
        (atual.includes(t) ? atual.filter((x) => x !== t) : [...atual, t]).forEach((x) => p.append("tipo", x));
      }),
    setSegmento: (s: string) => atualizar((p) => (s ? p.set("segmento", s) : p.delete("segmento"))),
    setBusca: (q: string) => atualizar((p) => (q ? p.set("q", q) : p.delete("q"))),
    limpar: () => setParams(new URLSearchParams(), { replace: true }),
    ativo: tipos.length > 0 || !!segmento || !!busca || sinais.length > 0,
  };
}

const ORDEM = ["Papel", "Tijolo", "Híbrido", "FoF"];
const SINAIS = ["verde", "amarelo", "vermelho", "cinza"] as const;
const ROTULOS: Record<string, string> = { verde: "Verde", amarelo: "Amarelo", vermelho: "Vermelho", cinza: "Poucos dados" };

/** Resumo do checklist que também funciona como filtro. As contagens são do
 *  conjunto já filtrado por tipo/segmento/busca, sem o próprio filtro de sinal. */
export function FiltroSinal({ contagem, f }: { contagem: Record<string, number>; f: ReturnType<typeof useFiltros> }) {
  return (
    <div className="chips sinal-chips" role="group" aria-label="Filtrar pelo sinal do checklist">
      <span className="chips-label">Checklist:</span>
      {SINAIS.filter((s) => s !== "cinza" || contagem[s]).map((s) => (
        <button key={s} className={`chip chip-sinal sinal-${s}`} aria-pressed={f.sinais.includes(s)} onClick={() => f.alternarSinal(s)}>
          <i aria-hidden="true" />{ROTULOS[s]} <b className="num">{contagem[s] ?? 0}</b>
        </button>
      ))}
    </div>
  );
}

export function BarraFiltros({ tiposDisponiveis, segmentos, f }: {
  tiposDisponiveis: string[]; segmentos: string[]; f: ReturnType<typeof useFiltros>;
}) {
  return (
    <div className="filters" role="group" aria-label="Filtros">
      <div className="chips">
        {[...tiposDisponiveis].sort((a, b) => ORDEM.indexOf(a) - ORDEM.indexOf(b)).map((t) => (
          <button key={t} className="chip" aria-pressed={f.tipos.includes(t)} onClick={() => f.alternarTipo(t)}>
            {t}
          </button>
        ))}
      </div>
      <select value={f.segmento} onChange={(e) => f.setSegmento(e.target.value)} aria-label="Segmento">
        <option value="">Todos os segmentos</option>
        {segmentos.map((s) => <option key={s}>{s}</option>)}
      </select>
      <input type="search" placeholder="Buscar ticker ou nome…" value={f.busca}
        onChange={(e) => f.setBusca(e.target.value)} aria-label="Buscar fundo" />
      {f.ativo && <button className="link-btn" onClick={f.limpar}>Limpar filtros</button>}
    </div>
  );
}
