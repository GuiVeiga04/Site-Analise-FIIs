import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { senhaValida } from "../lib/authUtil";

type Aba = "entrar" | "criar" | "esqueci";

/** Tela de login: Google ou e-mail e senha (com criar conta e "esqueci a senha"). */
export default function Entrar() {
  const auth = useAuth();
  const [aba, setAba] = useState<Aba>("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { setErro(null); setAviso(null); }, [aba]);
  useEffect(() => {
    if (auth.erroRetorno) { setErro(auth.erroRetorno); auth.limparErroRetorno(); }
  }, [auth.erroRetorno]); // eslint-disable-line react-hooks/exhaustive-deps

  if (auth.usuario) return <Navigate to="/carteira" replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null); setAviso(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErro("Informe um e-mail válido."); return; }
    if (aba === "criar") {
      const fraca = senhaValida(senha);
      if (fraca) { setErro(fraca); return; }
      if (senha !== senha2) { setErro("As duas senhas não são iguais."); return; }
    }
    setEnviando(true);
    try {
      if (aba === "entrar") {
        const r = await auth.entrarComEmail(email, senha);
        if (r) setErro(r);
      } else if (aba === "criar") {
        const r = await auth.criarConta(email, senha);
        if (r.erro) setErro(r.erro);
        else if (r.precisaConfirmar) {
          setAviso(`Conta criada. Enviamos um link de confirmação para ${email.trim()}: abra o e-mail e clique nele para ativar a conta. Confira também a caixa de spam.`);
          setSenha(""); setSenha2("");
        }
      } else {
        const r = await auth.enviarRecuperacao(email);
        if (r) setErro(r);
        else setAviso(`Se existir uma conta com ${email.trim()}, enviamos um link para criar uma nova senha.`);
      }
    } finally {
      setEnviando(false);
    }
  }

  async function google() {
    setErro(null);
    const r = await auth.entrarComGoogle();  // se der certo, o navegador sai do site e volta logado
    if (r) setErro(r);
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>{aba === "criar" ? "Criar conta" : aba === "esqueci" ? "Recuperar senha" : "Entrar"}</h1>
        <p className="chart-sub">Entre para montar e acompanhar a sua carteira de FIIs.</p>

        {aba !== "esqueci" && (
          <>
            <button type="button" className="btn btn-google" onClick={google} disabled={enviando}>
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
              </svg>
              Continuar com Google
            </button>
            <div className="auth-ou"><span>ou com e-mail</span></div>
          </>
        )}

        <form className="calc-form" onSubmit={enviar} noValidate>
          <label>E-mail
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {aba !== "esqueci" && (
            <label>Senha
              <input type="password" autoComplete={aba === "criar" ? "new-password" : "current-password"}
                value={senha} onChange={(e) => setSenha(e.target.value)} />
              {aba === "criar" && <span className="calc-dica">Pelo menos 8 caracteres, com letras e números.</span>}
            </label>
          )}
          {aba === "criar" && (
            <label>Repita a senha
              <input type="password" autoComplete="new-password" value={senha2} onChange={(e) => setSenha2(e.target.value)} />
            </label>
          )}
          {erro && <p className="auth-erro" role="alert">{erro}</p>}
          {aviso && <p className="auth-aviso" role="status">{aviso}</p>}
          <button type="submit" className="btn btn-primario" disabled={enviando}>
            {enviando ? "Aguarde…" : aba === "criar" ? "Criar conta" : aba === "esqueci" ? "Enviar link" : "Entrar"}
          </button>
        </form>

        <div className="auth-links">
          {aba === "entrar" && <>
            <button type="button" className="link-btn" onClick={() => setAba("esqueci")}>Esqueci a senha</button>
            <button type="button" className="link-btn" onClick={() => setAba("criar")}>Criar conta</button>
          </>}
          {aba !== "entrar" && <button type="button" className="link-btn" onClick={() => setAba("entrar")}>Já tenho conta: entrar</button>}
        </div>
        <p className="aviso-triagem">
          Guardamos só o seu e-mail e os fundos que você cadastrar na carteira, para mostrar a você mesmo. Nada é
          compartilhado com terceiros, e você pode excluir a conta quando quiser.
        </p>
      </div>
    </div>
  );
}
