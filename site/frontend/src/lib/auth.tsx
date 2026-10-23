import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { erroNaUrl, traduzirErro, urlDeRetorno, urlSemErro } from "./authUtil";

interface EstadoAuth {
  usuario: User | null;
  carregando: boolean;
  /** true depois que a pessoa abriu o link de "esqueci a senha": mostra o formulário de nova senha */
  recuperandoSenha: boolean;
  /** erro que veio na URL (link expirado, login cancelado...) */
  erroRetorno: string | null;
  limparErroRetorno: () => void;
  entrarComGoogle: () => Promise<string | null>;
  entrarComEmail: (email: string, senha: string) => Promise<string | null>;
  criarConta: (email: string, senha: string) => Promise<{ erro: string | null; precisaConfirmar: boolean }>;
  enviarRecuperacao: (email: string) => Promise<string | null>;
  definirNovaSenha: (senha: string) => Promise<string | null>;
  sair: () => Promise<void>;
}

const Ctx = createContext<EstadoAuth | null>(null);

const retorno = () => urlDeRetorno(window.location.href);

// Para onde ir depois de voltar do Google ou do link do e-mail. Não vai no
// redirectTo (com "#/rota" ele deixaria de bater com as URLs liberadas no Supabase).
const CHAVE_DESTINO = "fiis-destino-pos-login";
function lembrarDestino(hash: string) {
  try { sessionStorage.setItem(CHAVE_DESTINO, hash); } catch { /* navegação privada */ }
}
function irParaDestinoGuardado() {
  try {
    const destino = sessionStorage.getItem(CHAVE_DESTINO);
    if (destino) {
      sessionStorage.removeItem(CHAVE_DESTINO);
      window.location.hash = destino;
    }
  } catch { /* navegação privada */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [recuperandoSenha, setRecuperandoSenha] = useState(false);
  const [erroRetorno, setErroRetorno] = useState<string | null>(null);

  useEffect(() => {
    const erro = erroNaUrl(window.location.href);
    if (erro) {
      setErroRetorno(traduzirErro(erro));
      window.history.replaceState(window.history.state, "", urlSemErro(window.location.href));
    }
    supabase.auth.getSession().then(({ data }) => {
      setSessao(data.session);
      setCarregando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      setSessao(s);
      setCarregando(false);
      if (evento === "PASSWORD_RECOVERY") {
        setRecuperandoSenha(true);
        window.location.hash = "#/nova-senha";
      } else if (evento === "SIGNED_IN") {
        irParaDestinoGuardado();
      }
      if (evento === "SIGNED_OUT") setRecuperandoSenha(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const valor: EstadoAuth = {
    usuario: sessao?.user ?? null,
    carregando,
    recuperandoSenha,
    erroRetorno,
    limparErroRetorno: () => setErroRetorno(null),
    async entrarComGoogle() {
      lembrarDestino("#/carteira");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: retorno(), queryParams: { prompt: "select_account" } },
      });
      return error ? traduzirErro(error.message) : null;
    },
    async entrarComEmail(email, senha) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
      return error ? traduzirErro(error.message) : null;
    },
    async criarConta(email, senha) {
      lembrarDestino("#/carteira");
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(), password: senha, options: { emailRedirectTo: retorno() },
      });
      if (error) return { erro: traduzirErro(error.message), precisaConfirmar: false };
      // Com "confirmar e-mail" ligado no Supabase, a conta só vale depois do link.
      // Se o e-mail já existia, o Supabase devolve um usuário sem identidades (não revela que existe).
      const jaExistia = data.user && (data.user.identities ?? []).length === 0;
      if (jaExistia) return { erro: traduzirErro("User already registered"), precisaConfirmar: false };
      return { erro: null, precisaConfirmar: !data.session };
    },
    async enviarRecuperacao(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: retorno() });
      return error ? traduzirErro(error.message) : null;
    },
    async definirNovaSenha(senha) {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) return traduzirErro(error.message);
      setRecuperandoSenha(false);
      return null;
    },
    async sair() {
      await supabase.auth.signOut();
    },
  };
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useAuth(): EstadoAuth {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth fora do AuthProvider");
  return c;
}
