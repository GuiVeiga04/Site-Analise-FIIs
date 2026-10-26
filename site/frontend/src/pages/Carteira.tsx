import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { FormOperacao } from "../components/FormOperacao";
import { DivisaoCarteira, KpisCarteira, TabelaPosicao } from "../components/PainelCarteira";
import { Estado } from "../components/ui";
import { useAuth } from "../lib/auth";
import { calcularPosicoes, primeiraVendaSemCotas, resumirCarteira, type Operacao } from "../lib/carteira";
import { excluirOperacao, useOperacoes } from "../lib/carteiraApi";
import { brl, data, inteiro } from "../lib/format";
import { useAsync } from "../lib/useAsync";

/**
 * Minha carteira (só para quem está logado).
 * Bloco 2: lançar, editar e excluir compras e vendas; posição e preço médio.
 * Bloco 3: valor atual, resultado, renda, yield on cost e divisão por segmento/tipo.
 * Bloco 4: rendimentos recebidos.
 */
export default function Carteira() {
  const auth = useAuth();
  const snap = useAsync(api.snapshot, []);
  const { ops, carregando, erro, recarregar } = useOperacoes(auth.usuario?.id ?? null);
  const [editando, setEditando] = useState<Operacao | null>(null);
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const fundos = useMemo(() => [...(snap.data ?? [])].sort((a, b) => a.ticker.localeCompare(b.ticker)), [snap.data]);
  const porTicker = useMemo(() => new Map(fundos.map((f) => [f.ticker, f])), [fundos]);
  const resumo = useMemo(() => resumirCarteira(calcularPosicoes(ops), porTicker), [ops, porTicker]);
  const temPosicao = resumo.linhas.length > 0;

  if (auth.carregando) return <p className="state">Carregando…</p>;
  if (!auth.usuario) return <Navigate to="/entrar" replace />;
  if (!snap.data) return <Estado loading={snap.loading} error={snap.error} />;

  async function excluir(op: Operacao) {
    setErroExcluir(null);
    const problema = primeiraVendaSemCotas(ops.filter((o) => o.id !== op.id), op.ticker);
    if (problema) {
      setErroExcluir(`Não dá para excluir: a venda de ${op.ticker} em ${data(problema.data)} ficaria sem cotas. Exclua ou ajuste a venda antes.`);
      setConfirmando(null);
      return;
    }
    try {
      await excluirOperacao(op.id!);
      if (editando?.id === op.id) setEditando(null);
      setConfirmando(null);
      setAviso(`Operação de ${op.ticker} em ${data(op.data)} excluída.`);
      await recarregar();
    } catch (e) {
      setErroExcluir((e as Error).message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Minha carteira</h1>
          <p>Conectado como <b>{auth.usuario.email}</b>. Lance cada compra e venda; o site calcula a posição e o preço médio.</p>
        </div>
        <div className="head-acoes">
          <button className="btn" onClick={() => auth.sair()}>Sair</button>
        </div>
      </div>

      {temPosicao && (
        <>
          <KpisCarteira r={resumo} />
          <section><TabelaPosicao r={resumo} porTicker={porTicker} /></section>
        </>
      )}

      <div className={`carteira-grid${temPosicao ? " carteira-grid-baixo" : ""}`}>
        <div className="card" id="form-operacao">
          <div className="chart-title">{editando ? `Editar operação de ${editando.ticker}` : "Lançar operação"}</div>
          <div className="chart-sub">Os dados da sua nota de corretagem. Só você vê a sua carteira.</div>
          <FormOperacao fundos={fundos} existentes={ops} editando={editando}
            onSalvo={async (op) => {
              setAviso(`${op.tipo === "compra" ? "Compra" : "Venda"} de ${inteiro(op.quantidade)} ${op.ticker} em ${data(op.data)} ${editando ? "alterada" : "lançada"}.`);
              setEditando(null);
              await recarregar();
            }}
            onCancelar={() => setEditando(null)} />
        </div>

        {erro ? <div className="card"><p className="auth-erro">Não foi possível carregar a carteira: {erro}</p></div>
          : carregando && !ops.length ? <div className="card"><p className="state">Carregando…</p></div>
          : temPosicao ? <DivisaoCarteira r={resumo} />
          : (
            <div className="card">
              <div className="chart-title">Sua carteira</div>
              <p className="carteira-vazia-txt">Nenhuma cota na carteira ainda. Lance a primeira compra ao lado.</p>
            </div>
          )}
      </div>

      {aviso && <p className="auth-aviso carteira-aviso" role="status">{aviso} <button className="link-btn" onClick={() => setAviso(null)}>ok</button></p>}

      <section>
        <div className="card">
          <div className="chart-title">Operações</div>
          <div className="chart-sub">{ops.length ? `${ops.length} lançamento${ops.length > 1 ? "s" : ""}, do mais recente para o mais antigo.` : "Nenhum lançamento ainda."}</div>
          {erroExcluir && <p className="auth-erro" role="alert">{erroExcluir}</p>}
          {ops.length > 0 && (
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="calc-tabela tabela-operacoes">
                <thead><tr><th>Data</th><th>Tipo</th><th>Fundo</th><th className="r">Cotas</th><th className="r">Preço</th><th className="r">Total</th><th /></tr></thead>
                <tbody>
                  {ops.map((o) => (
                    <tr key={o.id} className={editando?.id === o.id ? "atual" : ""}>
                      <td className="num">{data(o.data)}</td>
                      <td><span className={`op-tipo op-${o.tipo}`}>{o.tipo === "compra" ? "Compra" : "Venda"}</span></td>
                      <td className="mono">{o.ticker}</td>
                      <td className="r num">{inteiro(o.quantidade)}</td>
                      <td className="r num">{brl(o.preco)}</td>
                      <td className="r num">{brl(o.quantidade * o.preco)}</td>
                      <td className="r op-acoes">
                        {confirmando === o.id ? (
                          <>
                            <button className="link-btn perigo" onClick={() => excluir(o)}>Confirmar exclusão</button>
                            <button className="link-btn" onClick={() => setConfirmando(null)}>cancelar</button>
                          </>
                        ) : (
                          <>
                            <button className="link-btn" onClick={() => {
                              setEditando(o); setConfirmando(null);
                              document.getElementById("form-operacao")?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }}>Editar</button>
                            <button className="link-btn" onClick={() => { setConfirmando(o.id!); setErroExcluir(null); }}>Excluir</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
