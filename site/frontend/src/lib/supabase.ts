import { createClient } from "@supabase/supabase-js";

/**
 * Conexão com o Supabase (login e carteiras).
 *
 * A URL e a chave "publishable" são PÚBLICAS por natureza: ficam no código do
 * site de qualquer jeito. Quem protege as carteiras são as regras (RLS) da
 * tabela no banco: cada usuário só lê e altera as próprias linhas.
 * NUNCA coloque aqui a "secret key" / "service_role" nem a senha do banco.
 *
 * Dá para trocar sem mexer no código com VITE_SUPABASE_URL / VITE_SUPABASE_KEY.
 */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "https://vcnnmtafyymdpzgzgntm.supabase.co";
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY ?? "sb_publishable_pYoVal6qxebfuUYon5FAVA_MjccOF-S";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    // PKCE: o retorno do Google / dos links de e-mail vem como "?code=..." na URL,
    // o que não briga com o HashRouter (que usa o "#/rota").
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
