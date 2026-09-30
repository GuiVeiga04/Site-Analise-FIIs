import { useEffect, useRef, useState, type ReactNode } from "react";
import { MODO, iaGerar, iaSalvo, iaStatus, type DiagnosticoSalvo, type StatusIA } from "../api/client";

const NOME_MODELO: Record<string, string> = {
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "claude-sonnet-5": "Claude Sonnet 5",
};
const nomeModelo = (m: string | null | undefined) => (m ? NOME_MODELO[m] ?? m : "Claude");

/* ---- Markdown mínimo e seguro (sem innerHTML): ## títulos, - listas, **negrito** ---- */
function inline(t: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>);
}

export function Markdown({ texto }: { texto: string }) {
  const blocos: ReactNode[] = [];
  let lista: string[] = [];
  const fecharLista = () => {
    if (lista.length) blocos.push(<ul key={`l${blocos.length}`}>{lista.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    lista = [];
  };
  texto.split("\n").forEach((linha) => {
    const l = linha.trim();
    if (/^[-*] /.test(l)) { lista.push(l.slice(2)); return; }
    fecharLista();
    if (!l) return;
    if (l.startsWith("#")) blocos.push(<h3 key={blocos.length}>{inline(l.replace(/^#+\s*/, ""))}</h3>);
    else blocos.push(<p key={blocos.length}>{inline(l)}</p>);
  });
  fecharLista();
  return <div className="md">{blocos}</div>;
}

const AVISO = "Texto gerado por IA a partir dos números deste painel. Pode conter erros e não é recomendação de investimento.";

/**
 * Card de diagnóstico.
 *  - 1 ticker: diagnóstico do fundo; 2 tickers: comparação.
 *  - Local (FastAPI com ANTHROPIC_API_KEY): botão que gera em tempo real.
 *  - GitHub Pages: mostra o diagnóstico diário pré-gerado (só para 1 fundo).
 */
export function DiagnosticoIA({ tickers }: { tickers: string[] }) {
  const chave = tickers.join(",");
  const comparacao = tickers.length === 2;
  const [status, setStatus] = useState<StatusIA | null>(null);
  const [salvo, setSalvo] = useState<DiagnosticoSalvo | null | undefined>(undefined);
  const [texto, setTexto] = useState("");
  const [modelo, setModelo] = useState<string | null>(null);
  const [estado, setEstado] = useState<"parado" | "gerando" | "pronto" | "erro">("parado");
  const [erro, setErro] = useState("");
  const abortar = useRef<AbortController | null>(null);

  useEffect(() => { iaStatus().then(setStatus); }, []);
  useEffect(() => {
    abortar.current?.abort();
    setTexto(""); setEstado("parado"); setErro(""); setSalvo(undefined);
    if (!comparacao) iaSalvo(tickers[0]).then(setSalvo);
    else setSalvo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  async function gerar() {
    abortar.current?.abort();
    const ctrl = new AbortController();
    abortar.current = ctrl;
    setTexto(""); setErro(""); setEstado("gerando");
    try {
      const r = await iaGerar(tickers, setTexto, ctrl.signal);
      setModelo(r.modelo); setEstado("pronto");
    } catch (e) {
      if ((e as Error).name === "AbortError") { setEstado(texto ? "pronto" : "parado"); return; }
      setErro((e as Error).message); setEstado("erro");
    }
  }

  const aoVivo = MODO === "api" && status?.disponivel;
  const titulo = comparacao ? `Comparação por IA — ${tickers.join(" × ")}` : "Diagnóstico por IA";

  return (
    <div className="card ia-card">
      <div className="checklist-head">
        <div>
          <div className="chart-title">✦ {titulo}</div>
          <div className="chart-sub">
            {aoVivo
              ? `${nomeModelo(status?.modelo)} lê os números do painel e explica o que eles dizem. Gerado na hora.`
              : "Leitura dos números do painel feita pelo Claude."}
          </div>
        </div>
        {aoVivo && (
          estado === "gerando"
            ? <button className="btn" onClick={() => abortar.current?.abort()}>Parar</button>
            : <button className="btn btn-primario" onClick={gerar}>{texto ? "Gerar de novo" : comparacao ? "Comparar com IA" : "Gerar diagnóstico"}</button>
        )}
      </div>

      {/* Tempo real */}
      {aoVivo && estado === "parado" && !texto && salvo && <SalvoView d={salvo} />}
      {aoVivo && (texto || estado === "gerando") && (
        <div aria-live="polite" aria-busy={estado === "gerando"}>
          {texto ? <Markdown texto={texto} /> : <p className="ia-espera">Analisando os dados…</p>}
          {estado === "gerando" && texto && <span className="cursor" aria-hidden="true" />}
          {estado === "pronto" && <p className="ia-meta">{nomeModelo(modelo)} · agora há pouco</p>}
        </div>
      )}
      {estado === "erro" && <p className="ia-erro">Não foi possível gerar: {erro}</p>}

      {/* Sem IA ao vivo */}
      {!aoVivo && status && (
        salvo ? <SalvoView d={salvo} />
          : salvo === null && (
            <p className="ia-espera">
              {MODO === "api"
                ? <>Para gerar aqui, defina a variável <code>ANTHROPIC_API_KEY</code> antes de subir o <code>uvicorn</code> (veja o README).</>
                : comparacao
                  ? "A comparação por IA roda na hora e fica disponível na versão local do site. Aqui, veja o diagnóstico diário de cada fundo na página dele."
                  : "O diagnóstico diário deste fundo ainda não foi gerado."}
            </p>
          )
      )}
      <p className="aviso-triagem">{AVISO}</p>
    </div>
  );
}

function SalvoView({ d }: { d: DiagnosticoSalvo }) {
  const quando = new Date(d.gerado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  return (
    <>
      <Markdown texto={d.texto} />
      <p className="ia-meta">{nomeModelo(d.modelo)} · gerado em {quando}{d.dados_ate ? ` com dados até ${d.dados_ate.split("-").reverse().join("/")}` : ""}</p>
    </>
  );
}
