import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { PontoHistorico } from "../api/types";

/**
 * Busca o histórico de preço de vários tickers (para as sparklines da
 * tabela). O client.ts já faz cache por URL, então trocar de filtro não
 * refaz requisições para tickers já carregados.
 */
export function useHistoricos(tickers: string[]) {
  const [mapa, setMapa] = useState<Record<string, PontoHistorico[]>>({});

  useEffect(() => {
    let vivo = true;
    tickers.forEach((t) => {
      if (mapa[t]) return;
      api.historico(t).then((serie) => {
        if (vivo) setMapa((m) => (m[t] ? m : { ...m, [t]: serie }));
      }).catch(() => {
        if (vivo) setMapa((m) => (m[t] ? m : { ...m, [t]: [] }));
      });
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join(",")]);

  return mapa;
}
