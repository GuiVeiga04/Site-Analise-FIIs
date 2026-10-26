import assert from "node:assert/strict";
import { test } from "node:test";
import { erroNaUrl, senhaValida, traduzirErro, urlDeRetorno, urlSemErro } from "./authUtil.ts";

test("url de retorno: página atual sem query e sem #/rota", () => {
  assert.equal(urlDeRetorno("https://guiveiga04.github.io/Site-Analise-FIIs/?x=1#/carteira"),
    "https://guiveiga04.github.io/Site-Analise-FIIs/");
  assert.equal(urlDeRetorno("http://localhost:5173/#/entrar"), "http://localhost:5173/");
});

test("tradução das mensagens do Supabase", () => {
  assert.equal(traduzirErro("Invalid login credentials"), "E-mail ou senha incorretos.");
  assert.equal(traduzirErro("Password should be at least 6 characters."), "A senha precisa ter pelo menos 6 caracteres.");
  assert.match(traduzirErro("User already registered"), /Já existe uma conta/);
  assert.match(traduzirErro("Email rate limit exceeded"), /Muitas tentativas/);
  assert.equal(traduzirErro("algo novo"), "algo novo");
  assert.equal(traduzirErro(""), "Algo deu errado. Tente de novo.");
});

test("erro devolvido na URL é lido e removido sem perder a rota", () => {
  const href = "https://site/x/?error=access_denied&error_code=403&error_description=Email+link+is+invalid+or+has+expired#/carteira";
  assert.equal(erroNaUrl(href), "Email link is invalid or has expired");
  assert.equal(urlSemErro(href), "https://site/x/#/carteira");
  assert.equal(erroNaUrl("https://site/x/#/carteira"), null);
});

test("regra de senha", () => {
  assert.equal(senhaValida("abc12345"), null);
  assert.match(senhaValida("abc1") ?? "", /8 caracteres/);
  assert.match(senhaValida("abcdefghij") ?? "", /letras e números/);
});

test("hash do nonce do login Google (SHA-256 em hexadecimal)", async () => {
  const { sha256Hex, novoNonce } = await import("./googleGis.ts");
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const n = await novoNonce();
  assert.equal(n.hash, await sha256Hex(n.puro));
  assert.notEqual(n.puro, (await novoNonce()).puro);
});
