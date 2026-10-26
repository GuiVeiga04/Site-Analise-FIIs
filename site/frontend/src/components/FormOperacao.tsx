import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { FundoSnapshot } from "../api/types";
import { lerNumero } from "../lib/calculadora";
import { calcularPosicoes, hojeIso, precoNaData, validarOperacao, type Operacao, type TipoOperacao } from "../lib/carteira";
import { atualizarOperacao, incluirOperacao } from "../lib/carteiraApi";
import { brl, data, inteiro } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { fmtEntrada } from "./CalcRenda";

interface Props {
  fundos: FundoSnapshot[];
  existentes: Operacao[];
  /** operação sendo editada (null = nova) */
  editando: Operacao | null;
  onSalvo: (op: Operacao) => void;
  onCancelar: () => void;
}

/** Formulário de compra/venda. Toda regra fica em lib/carteira.ts; aqui só entrada e mensagens. */
export function FormOperacao({ fundos, existentes, editando, onSalvo, onCancelar }: Props) {
  const hoje = hojeIso();
  const [tipo, setTipo] = useState<TipoOperacao>("compra");
  const [fundoTxt, setFundoTxt] = useState("");
  const [dataTxt, setDataTxt] = useState(hoje);
  const [qtdTxt, setQtdTxt] = useState("");
  const [precoTxt, setPrecoTxt] = useState("");
  const [precoTocado, setPrecoTocado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Abriu uma operação para editar: preenche o formulário com ela
  useEffect(() => {
    if (editando) {
      setTipo(editando.tipo); setFundoTxt(editando.ticker); setDataTxt(editando.data);
      setQtdTxt(String(editando.quantidade)); setPrecoTxt(fmtEntrada(editando.preco)); setPrecoTocado(true);
    } else {
      setTipo("compra"); setFundoTxt(""); setDataTxt(hoje); setQtdTxt(""); setPrecoTxt(""); setPrecoTocado(false);
    }
    setErro(null);
  }, [editando]); // eslint-disable-line react-hooks/exhaustive-deps

  const porTicker = useMemo(() => new Map(fundos.map((f) => [f.ticker, f])), [fundos]);
  const ticker = fundoTxt.trim().toUpperCase().split(/[\s—-]/)[0];
  const fundo = porTicker.get(ticker);

  // Preço de fechamento do dia escolhido, para sugerir
  const hist = useAsync(() => (fundo ? api.historico(fundo.ticker) : Promise.resolve([])), [fundo?.ticker]);
  const sugerido = fundo && hist.data ? precoNaData(hist.data, dataTxt) : null;
  useEffect(() => {
    if (sugerido && !precoTocado) setPrecoTxt(fmtEntrada(sugerido.preco));
  }, [sugerido?.preco, sugerido?.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const qtd = lerNumero(qtdTxt);
  const preco = lerNumero(precoTxt);
  const total = Number.isFinite(qtd) && Number.isFinite(preco) ? qtd * preco : null;
  const tenho = useMemo(() => {
    const outras = existentes.filter((e) => !editando || e.id !== editando.id);
    return calcularPosicoes(outras.filter((o) => o.data <= dataTxt)).find((p) => p.ticker === ticker)?.quantidade ?? 0;
  }, [existentes, editando, dataTxt, ticker]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const op: Operacao = {
      id: editando?.id, ticker, tipo, data: dataTxt,
      quantidade: qtd, preco: Math.round(preco * 100) / 100,
    };
    const problema = validarOperacao(op, existentes, new Set(porTicker.keys()), hoje);
    if (problema) { setErro(problema); return; }
    setSalvando(true);
    setErro(null);
    try {
      const salva = editando ? await atualizarOperacao(op) : await incluirOperacao(op);
      onSalvo(salva);
      if (!editando) { setQtdTxt(""); setPrecoTocado(false); }
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form className="calc-form form-operacao" onSubmit={salvar} noValidate>
      <div className="seg" role="radiogroup" aria-label="Tipo de operação">
        <button type="button" role="radio" aria-checked={tipo === "compra"} onClick={() => setTipo("compra")}>Compra</button>
        <button type="button" role="radio" aria-checked={tipo === "venda"} onClick={() => setTipo("venda")}>Venda</button>
      </div>
      <label>Fundo
        <input list="lista-fundos" placeholder="Digite o ticker ou o nome" value={fundoTxt} autoComplete="off"
          onChange={(e) => setFundoTxt(e.target.value)}
          onBlur={() => { if (fundo) setFundoTxt(fundo.ticker); }} />
        <datalist id="lista-fundos">
          {fundos.map((f) => <option key={f.ticker} value={f.ticker}>{f.nome}</option>)}
        </datalist>
        <span className="calc-dica">{fundo ? `${fundo.nome} · ${fundo.segmento ?? ""}` : " "}</span>
      </label>
      <label>Data
        <input type="date" value={dataTxt} max={hoje} onChange={(e) => setDataTxt(e.target.value)} />
      </label>
      <label>Quantidade de cotas
        <input inputMode="numeric" value={qtdTxt} onChange={(e) => setQtdTxt(e.target.value)} />
        {tipo === "venda" && fundo && <span className="calc-dica">Você tinha {inteiro(tenho)} cotas nessa data.</span>}
      </label>
      <label>Preço por cota (R$)
        <input inputMode="decimal" value={precoTxt} onChange={(e) => { setPrecoTxt(e.target.value); setPrecoTocado(true); }} />
        <span className="calc-dica">
          {sugerido
            ? <>Fechamento de {data(sugerido.data)}: {brl(sugerido.preco)}.{" "}
                {Math.abs(preco - sugerido.preco) > 0.004 && (
                  <button type="button" className="link-btn" onClick={() => { setPrecoTxt(fmtEntrada(sugerido.preco)); setPrecoTocado(false); }}>Usar esse</button>
                )}</>
            : fundo ? "Sem cotação do site nessa data: use o preço da sua nota de corretagem." : " "}
        </span>
      </label>
      <div className="op-total">Total: <b className="num">{total != null && total > 0 ? brl(total) : "—"}</b></div>
      {erro && <p className="auth-erro" role="alert">{erro}</p>}
      <div className="op-botoes">
        <button type="submit" className="btn btn-primario" disabled={salvando}>
          {salvando ? "Salvando…" : editando ? "Salvar alteração" : tipo === "compra" ? "Lançar compra" : "Lançar venda"}
        </button>
        {editando && <button type="button" className="btn" onClick={onCancelar}>Cancelar</button>}
      </div>
    </form>
  );
}
