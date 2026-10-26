/**
 * Botão oficial "Fazer login com o Google" (Google Identity Services).
 *
 * Por que não o redirecionamento padrão do Supabase: nele a tela do Google
 * mostra "prosseguir para vcnnmtafyymdpzgzgntm.supabase.co". Com o botão do
 * Google, o login acontece numa janela do próprio Google, a partir da página do
 * site, e o token volta direto para cá; o Supabase só confere esse token
 * (signInWithIdToken). Nada de endereço do Supabase na frente do usuário.
 *
 * O Client ID é público (aparece no código de qualquer site com login Google).
 */
export const GOOGLE_CLIENT_ID =
  import.meta.env?.VITE_GOOGLE_CLIENT_ID ?? "914641311549-aa45jjksotcmftqmh6l0bt3i9o4im2qn.apps.googleusercontent.com";

interface CredencialGoogle { credential: string }
interface GoogleId {
  initialize(cfg: {
    client_id: string; callback: (r: CredencialGoogle) => void; nonce?: string;
    use_fedcm_for_prompt?: boolean; ux_mode?: "popup" | "redirect"; itp_support?: boolean;
  }): void;
  renderButton(el: HTMLElement, opcoes: Record<string, unknown>): void;
  disableAutoSelect(): void;
}
declare global {
  interface Window { google?: { accounts: { id: GoogleId } } }
}

let carregando: Promise<GoogleId> | null = null;

/** Carrega o script do Google uma vez só. Rejeita se não carregar em 10 s (bloqueador, sem internet). */
export function carregarGoogle(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (carregando) return carregando;
  carregando = new Promise<GoogleId>((ok, falha) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    const tempo = window.setTimeout(() => falha(new Error("timeout")), 10000);
    s.onload = () => {
      window.clearTimeout(tempo);
      if (window.google?.accounts?.id) ok(window.google.accounts.id);
      else falha(new Error("script sem google.accounts.id"));
    };
    s.onerror = () => { window.clearTimeout(tempo); falha(new Error("script não carregou")); };
    document.head.appendChild(s);
  }).catch((e) => { carregando = null; throw e; });
  return carregando;
}

/** Nonce: um número aleatório que vai em hash (SHA-256) para o Google e "puro" para o
 *  Supabase, que confere se os dois batem. Impede reaproveitar um token roubado. */
export async function novoNonce(): Promise<{ puro: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const puro = btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, "");
  return { puro, hash: await sha256Hex(puro) };
}

export async function sha256Hex(texto: string): Promise<string> {
  const dig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
