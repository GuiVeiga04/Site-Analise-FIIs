/** Funções puras do login (testadas em authUtil.test.ts). */

/** Endereço para onde o Google e os links de e-mail devolvem a pessoa:
 *  a página atual sem query nem "#/rota" (ex: https://guiveiga04.github.io/Site-Analise-FIIs/). */
export function urlDeRetorno(href: string): string {
  const u = new URL(href);
  return u.origin + u.pathname;
}

const MENSAGENS: [RegExp, string][] = [
  [/invalid login credentials/i, "E-mail ou senha incorretos."],
  [/email not confirmed/i, "Confirme seu e-mail antes de entrar: abra o link que enviamos para a sua caixa de entrada."],
  [/user already registered|already been registered/i, "Já existe uma conta com esse e-mail. Use \"Entrar\" ou \"Esqueci a senha\"."],
  [/password should be at least (\d+)/i, "A senha precisa ter pelo menos $1 caracteres."],
  [/weak.?password|password is too weak|pwned/i, "Senha fraca: use pelo menos 8 caracteres, misturando letras e números."],
  [/unable to validate email|invalid email|email address .* is invalid/i, "E-mail inválido."],
  [/rate limit|too many requests|security purposes/i, "Muitas tentativas em pouco tempo. Espere um minuto e tente de novo."],
  [/same.?password|different from the old/i, "A nova senha precisa ser diferente da anterior."],
  [/provider is not enabled|unsupported provider/i, "Login com Google ainda não está ativado no Supabase."],
  [/failed to fetch|network/i, "Sem conexão com o servidor de login. Verifique a internet e tente de novo."],
  [/expired|invalid.*(link|code|flow)|otp/i, "O link expirou ou já foi usado. Peça um novo."],
  [/access_denied|cancel/i, "Login cancelado."],
];

/** Mensagem do Supabase (em inglês) -> português. Desconhecida: devolve a original. */
export function traduzirErro(mensagem: string | null | undefined): string {
  const m = (mensagem ?? "").trim();
  if (!m) return "Algo deu errado. Tente de novo.";
  for (const [padrao, texto] of MENSAGENS) {
    const achou = m.match(padrao);
    if (achou) return texto.replace("$1", achou[1] ?? "");
  }
  return m;
}

/** Erro devolvido pelo Supabase na URL (?error_description=...), se houver. */
export function erroNaUrl(href: string): string | null {
  const u = new URL(href);
  const q = u.searchParams;
  const desc = q.get("error_description") ?? q.get("error");
  return desc ? desc.replace(/\+/g, " ") : null;
}

/** URL sem os parâmetros de erro do Supabase (mantém o "#/rota"). */
export function urlSemErro(href: string): string {
  const u = new URL(href);
  ["error", "error_code", "error_description"].forEach((k) => u.searchParams.delete(k));
  return u.toString();
}

export function senhaValida(senha: string): string | null {
  if (senha.length < 8) return "Use pelo menos 8 caracteres.";
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return "Misture letras e números.";
  return null;
}
