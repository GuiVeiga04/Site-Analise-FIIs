import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { Operacao, ProventoFundo } from "./carteira";

/** Rendimentos por cota de cada fundo que já passou pela carteira (mesmo os vendidos).
 *  null enquanto carrega. */
export function useProventos(ops: Operacao[]): Map<string, ProventoFundo[]> | null {
  const tickers = useMemo(() => [...new Set(ops.map((o) => o.ticker))].sort().join(","), [ops]);
  const [proventos, setProventos] = useState<Map<string, ProventoFundo[]> | null>(null);
  useEffect(() => {
    if (!tickers) { setProventos(new Map()); return; }
    let vivo = true;
    setProventos(null);
    Promise.all(tickers.split(",").map((t) =>
      api.dividendos(t).then((d) => [t, d.map((x) => ({ dataEx: x.data_ex, valor: x.valor }))] as const).catch(() => [t, []] as const),
    )).then((pares) => { if (vivo) setProventos(new Map(pares.map(([t, d]) => [t, [...d]]))); });
    return () => { vivo = false; };
  }, [tickers]);
  return proventos;
}
