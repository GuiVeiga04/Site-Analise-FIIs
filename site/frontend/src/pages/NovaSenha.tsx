import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { senhaValida } from "../lib/authUtil";

/** Aberta pelo link de "esqueci a senha" (o Supabase já entra com a pessoa ao abrir o link). */
export default function NovaSenha() {
  const auth = useAuth();
  const nav = useNavigate();
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (auth.carregando) return <p className="state">Carregando…</p>;
  if (!auth.usuario) {
    return (
      <div className="auth-wrap"><div className="card auth-card">
        <h1>Link inválido</h1>
        <p>Esse link de recuperação expirou ou já foi usado. <Link to="/entrar">Peça um novo</Link> em "Esqueci a senha".</p>
      </div></div>
    );
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const fraca = senhaValida(senha);
    if (fraca) { setErro(fraca); return; }
    if (senha !== senha2) { setErro("As duas senhas não são iguais."); return; }
    setEnviando(true);
    const r = await auth.definirNovaSenha(senha);
    setEnviando(false);
    if (r) setErro(r);
    else nav("/carteira", { replace: true });
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>Nova senha</h1>
        <p className="chart-sub">Conta {auth.usuario.email}</p>
        <form className="calc-form" onSubmit={salvar} noValidate>
          <label>Nova senha
            <input type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
            <span className="calc-dica">Pelo menos 8 caracteres, com letras e números.</span>
          </label>
          <label>Repita a nova senha
            <input type="password" autoComplete="new-password" value={senha2} onChange={(e) => setSenha2(e.target.value)} />
          </label>
          {erro && <p className="auth-erro" role="alert">{erro}</p>}
          <button type="submit" className="btn btn-primario" disabled={enviando}>{enviando ? "Salvando…" : "Salvar nova senha"}</button>
        </form>
      </div>
    </div>
  );
}
