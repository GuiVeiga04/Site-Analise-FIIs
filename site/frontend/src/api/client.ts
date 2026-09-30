import type { FundoSnapshot, Meta, PontoDividendo, PontoHistorico } from "./types";

/**
 * Cliente de dados com dois modos:
 *  - "api"    -> FastAPI (/api/...), usado em desenvolvimento
 *  - "static" -> JSON exportado em public/data (GitHub Pages)
 * As telas não sabem de onde o dado vem.
 */
// Padrão: "api" no `npm run dev`, "static" no build. VITE_DATA_MODE força um dos dois.
export const MODO = (import.meta.env.VITE_DATA_MODE ?? (import.meta.env.DEV ? "api" : "static")) as "api" | "static";
const BASE = import.meta.env.BASE_URL;

const ROTAS = {
  meta: { api: "/api/meta", static: "data/meta.json" },
  snapshot: { api: "/api/snapshot", static: "data/snapshot.json" },
  historico: (t: string) => ({
    api: `/api/fundos/${t}/historico`,
    static: `data/historico/${t}.json`,
  }),
  dividendos: (t: string) => ({
    api: `/api/fundos/${t}/dividendos`,
    static: `data/dividendos/${t}.json`,
  }),
};

const cache = new Map<string, Promise<unknown>>();

function buscar<T>(rota: { api: string; static: string }): Promise<T> {
  const url = MODO === "api" ? rota.api : BASE + rota.static;
  if (!cache.has(url)) {
    const p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Erro ${r.status} ao carregar ${url}`);
      return r.json();
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return cache.get(url) as Promise<T>;
}

export const api = {
  meta: () => buscar<Meta>(ROTAS.meta),
  snapshot: () => buscar<FundoSnapshot[]>(ROTAS.snapshot),
  historico: (ticker: string) => buscar<PontoHistorico[]>(ROTAS.historico(ticker.toUpperCase())),
  dividendos: (ticker: string) => buscar<PontoDividendo[]>(ROTAS.dividendos(ticker.toUpperCase())),
};

// ---------------------------------------------------------------------------
// Diagnóstico de IA
//  - modo "api": o FastAPI chama o Claude e devolve o texto em streaming
//  - modo "static" (Pages): só existe o diagnóstico diário pré-gerado
//    (data/ia/{TICKER}.json); a chave da API nunca vai para o navegador.
// ---------------------------------------------------------------------------

export interface StatusIA { disponivel: boolean; modelo: string | null }
export interface DiagnosticoSalvo { ticker: string; modelo: string; gerado_em: string; dados_ate: string | null; texto: string }

export async function iaStatus(): Promise<StatusIA> {
  if (MODO !== "api") return { disponivel: false, modelo: null };
  try {
    const r = await fetch("/api/ia/status");
    return r.ok ? r.json() : { disponivel: false, modelo: null };
  } catch {
    return { disponivel: false, modelo: null };
  }
}

/** Diagnóstico pré-gerado (Pages). null se ainda não existe. */
export async function iaSalvo(ticker: string): Promise<DiagnosticoSalvo | null> {
  const r = await fetch(`${BASE}data/ia/${ticker.toUpperCase()}.json`).catch(() => null);
  if (!r || !r.ok) return null;
  try {
    return await r.json();
  } catch {
    return null; // o servidor de dev devolve index.html para arquivo inexistente
  }
}

/** Streaming: chama `aoReceber` com o texto acumulado a cada pedaço. */
export async function iaGerar(
  tickers: string[], aoReceber: (textoAteAgora: string) => void, sinal?: AbortSignal,
): Promise<{ modelo: string | null; texto: string }> {
  const r = await fetch("/api/ia/diagnostico", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers }),
    signal: sinal,
  });
  if (!r.ok || !r.body) {
    const erro = await r.json().catch(() => ({ detail: `Erro ${r.status}` }));
    throw new Error(erro.detail ?? `Erro ${r.status}`);
  }
  const leitor = r.body.getReader();
  const dec = new TextDecoder();
  let texto = "";
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    texto += dec.decode(value, { stream: true });
    aoReceber(texto);
  }
  return { modelo: r.headers.get("X-Modelo"), texto };
}
