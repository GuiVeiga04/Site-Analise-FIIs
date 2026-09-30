import { useEffect, useState } from "react";

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  useEffect(() => {
    let vivo = true;
    setState((s) => ({ ...s, loading: true }));
    fn()
      .then((data) => vivo && setState({ data, loading: false }))
      .catch((error) => vivo && setState({ error, loading: false }));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
