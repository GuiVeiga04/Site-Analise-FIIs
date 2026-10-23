import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

/**
 * Minha carteira (só para quem está logado).
 * Bloco 1: só a estrutura e o login. Bloco 2: lançar compras e vendas.
 * Bloco 3: painel (preço médio, resultado, renda, segmentos). Bloco 4: rendimentos recebidos.
 */
export default function Carteira() {
  const auth = useAuth();
  if (auth.carregando) return <p className="state">Carregando…</p>;
  if (!auth.usuario) return <Navigate to="/entrar" replace />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Minha carteira</h1>
          <p>Conectado como <b>{auth.usuario.email}</b>.</p>
        </div>
        <div className="head-acoes">
          <button className="btn" onClick={() => auth.sair()}>Sair</button>
        </div>
      </div>
      <div className="card carteira-vazia">
        <div className="chart-title">Sua carteira ainda está vazia</div>
        <p className="chart-sub">
          Em breve você poderá cadastrar aqui cada compra (fundo, data, quantidade e preço) e acompanhar preço médio,
          resultado, renda mensal e os rendimentos recebidos.
        </p>
      </div>
    </>
  );
}
