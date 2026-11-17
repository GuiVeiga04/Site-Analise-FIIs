import { useState } from "react";
import type { Operacao } from "../lib/carteira";
import { excluirConta } from "../lib/carteiraApi";
import { exportarOperacoesCsv } from "../lib/csvCarteira";
import { baixar } from "./ImportarExportar";

export const CHAVE_CONTA_EXCLUIDA = "fiis-conta-excluida";

/** Bloco 5: dados da conta e "Excluir minha conta" (apaga login e operações). */
export function ContaCard({ email, ops }: { email: string; ops: Operacao[] }) {
  const [aberto, setAberto] = useState(false);
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  async function excluir() {
    setExcluindo(true); setErro(null);
    // Guarda o aviso ANTES: ao sair, a página já pula para a tela de entrar, que o lê
    const lembrar = (v: string | null) => {
      try { if (v) sessionStorage.setItem(CHAVE_CONTA_EXCLUIDA, v); else sessionStorage.removeItem(CHAVE_CONTA_EXCLUIDA); } catch { /* navegação privada */ }
    };
    lembrar(email);
    try {
      await excluirConta();
      window.location.hash = "#/entrar";
    } catch (e) {
      lembrar(null);
      setErro((e as Error).message);
      setExcluindo(false);
    }
  }

  return (
    <div className="card conta-card">
      <div className="chart-title">Sua conta</div>
      <div className="chart-sub">Conectado como {email}. A carteira fica guardada só para você.</div>
      {!aberto ? (
        <button className="link-btn perigo" onClick={() => setAberto(true)}>Excluir minha conta…</button>
      ) : (
        <div className="conta-excluir calc-form">
          <p>
            Isso apaga <b>para sempre</b> o seu login e {ops.length ? <>as suas <b>{ops.length} operações</b></> : "a sua carteira"}.
            Não dá para desfazer.
            {ops.length > 0 && <> Se quiser guardar uma cópia,{" "}
              <button className="link-btn" onClick={() => baixar("minha-carteira.csv", exportarOperacoesCsv(ops))}>baixe as operações</button> antes.</>}
          </p>
          <label>Para confirmar, digite <b>EXCLUIR</b>
            <input value={confirma} onChange={(e) => setConfirma(e.target.value)} autoComplete="off" />
          </label>
          {erro && <p className="auth-erro" role="alert">{erro}</p>}
          <div className="op-botoes">
            <button className="btn btn-perigo" disabled={confirma.trim().toUpperCase() !== "EXCLUIR" || excluindo} onClick={excluir}>
              {excluindo ? "Excluindo…" : "Excluir conta e dados"}
            </button>
            <button className="btn" onClick={() => { setAberto(false); setConfirma(""); setErro(null); }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
