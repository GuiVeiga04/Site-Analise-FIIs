import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { traduzirErro } from "./authUtil";
import type { Operacao } from "./carteira";

/**
 * Leitura e gravação das operações no Supabase (tabela public.operacoes).
 * O filtro por usuário é feito pelo próprio banco (RLS): cada pessoa só recebe
 * e só altera as suas linhas, mesmo que alguém mexa no código do site.
 */
const COLUNAS = "id, ticker, tipo, data, quantidade, preco";

function normalizar(r: Record<string, unknown>): Operacao {
  return {
    id: Number(r.id),
    ticker: String(r.ticker),
    tipo: r.tipo === "venda" ? "venda" : "compra",
    data: String(r.data).slice(0, 10),
    quantidade: Number(r.quantidade),
    preco: Number(r.preco),   // coluna numeric pode chegar como texto
  };
}

const semId = ({ ticker, tipo, data, quantidade, preco }: Operacao) => ({ ticker, tipo, data, quantidade, preco });

export async function listarOperacoes(): Promise<Operacao[]> {
  const { data, error } = await supabase.from("operacoes").select(COLUNAS)
    .order("data", { ascending: false }).order("id", { ascending: false });
  if (error) throw new Error(traduzirErro(error.message));
  return (data ?? []).map(normalizar);
}

export async function incluirOperacao(op: Operacao): Promise<Operacao> {
  const { data, error } = await supabase.from("operacoes").insert(semId(op)).select(COLUNAS).single();
  if (error) throw new Error(traduzirErro(error.message));
  return normalizar(data);
}

/** Várias de uma vez (importação), em lotes de 500. */
export async function incluirOperacoes(ops: Operacao[]): Promise<number> {
  let total = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const { data, error } = await supabase.from("operacoes").insert(ops.slice(i, i + 500).map(semId)).select("id");
    if (error) throw new Error(traduzirErro(error.message) + (total ? ` (${total} já tinham sido importadas)` : ""));
    total += data?.length ?? 0;
  }
  return total;
}

/**
 * Apaga a conta e todas as operações. Quem faz isso é a função
 * public.excluir_minha_conta() no banco (security definer): o navegador não tem
 * permissão de apagar usuários, e a função só apaga o usuário que a chamou.
 */
export async function excluirConta(): Promise<void> {
  const { error } = await supabase.rpc("excluir_minha_conta");
  if (error) {
    if (/could not find the function|does not exist|PGRST202/i.test(error.message + (error.code ?? "")))
      throw new Error("A função de exclusão ainda não foi criada no Supabase (falta rodar o SQL do bloco 5).");
    throw new Error(traduzirErro(error.message));
  }
  // O usuário já não existe: só limpa a sessão guardada neste navegador
  await supabase.auth.signOut({ scope: "local" });
}

export async function atualizarOperacao(op: Operacao): Promise<Operacao> {
  if (op.id == null) throw new Error("Operação sem id");
  const { data, error } = await supabase.from("operacoes").update(semId(op)).eq("id", op.id).select(COLUNAS).single();
  if (error) throw new Error(traduzirErro(error.message));
  return normalizar(data);
}

export async function excluirOperacao(id: number): Promise<void> {
  const { error } = await supabase.from("operacoes").delete().eq("id", id);
  if (error) throw new Error(traduzirErro(error.message));
}

/** Operações do usuário logado, com recarregar() depois de cada alteração. */
export function useOperacoes(usuarioId: string | null) {
  const [ops, setOps] = useState<Operacao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    if (!usuarioId) { setOps([]); setCarregando(false); return; }
    setCarregando(true);
    try {
      setOps(await listarOperacoes());
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [usuarioId]);

  useEffect(() => { recarregar(); }, [recarregar]);
  return { ops, carregando, erro, recarregar };
}
