import { useRef, useState, type ChangeEvent } from "react";
import { validarOperacao, hojeIso, ordenar, type Operacao, type Posicao } from "../lib/carteira";
import { incluirOperacoes } from "../lib/carteiraApi";
import { MODELO_CSV, exportarOperacoesCsv, exportarPosicaoCsv, lerCsvOperacoes, mesmaOperacao } from "../lib/csvCarteira";
import { brl, data, inteiro } from "../lib/format";

export function baixar(nome: string, conteudo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Status = "ok" | "erro" | "duplicada";
interface Previa { linha: number; op: Operacao | null; status: Status; msg: string }

/** Bloco 5: baixar a carteira em planilha e importar várias operações de uma vez. */
export function ImportarExportar({ ops, posicoes, tickers, onImportado }: {
  ops: Operacao[];
  posicoes: (Posicao & { precoAtual?: number | null; valorAtual?: number | null })[];
  tickers: Set<string>;
  onImportado: (n: number) => void;
}) {
  const arquivo = useRef<HTMLInputElement>(null);
  const [nomeArq, setNomeArq] = useState("");
  const [previa, setPrevia] = useState<Previa[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const hoje = hojeIso();
  const sufixo = hoje.replace(/-/g, "");

  async function escolher(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    setErro(null); setAviso(null); setPrevia(null);
    if (!f) return;
    if (/\.(xlsx?|ods)$/i.test(f.name)) {
      setErro("Esse arquivo é do Excel. Abra no Excel e use Arquivo → Salvar como → CSV (separado por vírgulas ou ponto e vírgula), depois importe o .csv.");
      return;
    }
    setNomeArq(f.name);
    const bytes = new Uint8Array(await f.arrayBuffer());
    // Excel em português às vezes salva em Windows-1252 em vez de UTF-8
    let texto = new TextDecoder("utf-8").decode(bytes);
    if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(bytes);
    const r = lerCsvOperacoes(texto);
    if (r.erroGeral) { setErro(r.erroGeral); return; }
    if (r.semColunaTipo) setAviso("A planilha não tem coluna de tipo: todas as linhas foram lidas como compra.");

    // Regras da carteira na ordem das datas, somando as já cadastradas e as válidas anteriores
    const acumulado = [...ops];
    const porLinha = new Map<number, Previa>();
    for (const l of r.linhas.filter((x) => !x.op)) porLinha.set(l.linha, { linha: l.linha, op: null, status: "erro", msg: l.erro! });
    const comOp = r.linhas.filter((x) => x.op);
    const ordem = ordenar(comOp.map((x, i) => ({ ...x.op!, id: 1e12 + i })));
    for (const o of ordem) {
      const l = comOp[o.id! - 1e12];
      const op = { ...l.op! };
      if (ops.some((e) => mesmaOperacao(e, op))) {
        porLinha.set(l.linha, { linha: l.linha, op, status: "duplicada", msg: "Já está na sua carteira (não será importada de novo)" });
        continue;
      }
      const problema = validarOperacao({ ...op }, acumulado, tickers, hoje);
      if (problema) porLinha.set(l.linha, { linha: l.linha, op, status: "erro", msg: problema });
      else {
        acumulado.push({ ...op, id: o.id });
        porLinha.set(l.linha, { linha: l.linha, op, status: "ok", msg: "" });
      }
    }
    setPrevia([...porLinha.values()].sort((a, b) => a.linha - b.linha));
  }

  const validas = previa?.filter((p) => p.status === "ok") ?? [];

  async function importar() {
    setImportando(true); setErro(null);
    try {
      const n = await incluirOperacoes(validas.map((p) => p.op!));
      setPrevia(null); setAviso(null);
      onImportado(n);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setImportando(false);
    }
  }

  return (
    <div className="card">
      <div className="chart-title">Importar e exportar</div>
      <div className="chart-sub">Planilhas no formato CSV, que o Excel e o Google Planilhas abrem e salvam.</div>
      <div className="imp-botoes">
        <button className="btn" disabled={!ops.length} onClick={() => baixar(`carteira-operacoes-${sufixo}.csv`, exportarOperacoesCsv(ops))}>Baixar operações</button>
        <button className="btn" disabled={!posicoes.some((p) => p.quantidade > 0)} onClick={() => baixar(`carteira-posicao-${sufixo}.csv`, exportarPosicaoCsv(posicoes))}>Baixar posição</button>
        <span className="imp-sep" aria-hidden="true" />
        <button className="btn" onClick={() => baixar("modelo-carteira.csv", MODELO_CSV)}>Baixar modelo</button>
        <button className="btn btn-primario" onClick={() => arquivo.current?.click()}>Importar planilha…</button>
        <input ref={arquivo} type="file" accept=".csv,.txt,text/csv,.xlsx,.xls" hidden onChange={escolher} />
      </div>
      <p className="calc-dica">
        Para importar: use o modelo (colunas Data, Tipo, Fundo, Quantidade, Preço) ou o extrato de negociação da B3
        (Área do Investidor → Extratos → Negociação), salvo como CSV. Você confere tudo antes de gravar.
      </p>
      {erro && <p className="auth-erro" role="alert">{erro}</p>}
      {aviso && <p className="calc-aviso">{aviso}</p>}
      {previa && (
        <div className="imp-previa">
          <div className="chart-title">{nomeArq}: {previa.length} linha{previa.length === 1 ? "" : "s"}</div>
          <div className="chart-sub">
            {validas.length} para importar
            {previa.some((p) => p.status === "duplicada") && ` · ${previa.filter((p) => p.status === "duplicada").length} já cadastrada(s)`}
            {previa.some((p) => p.status === "erro") && ` · ${previa.filter((p) => p.status === "erro").length} com problema (ficam de fora)`}
          </div>
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="calc-tabela tabela-imp">
              <thead><tr><th className="r">Linha</th><th>Data</th><th>Tipo</th><th>Fundo</th><th className="r">Cotas</th><th className="r">Preço</th><th>Situação</th></tr></thead>
              <tbody>
                {previa.map((p) => (
                  <tr key={p.linha} className={`imp-${p.status}`}>
                    <td className="r num">{p.linha}</td>
                    <td className="num">{p.op ? data(p.op.data) : "—"}</td>
                    <td>{p.op ? (p.op.tipo === "compra" ? "Compra" : "Venda") : "—"}</td>
                    <td className="mono">{p.op?.ticker ?? "—"}</td>
                    <td className="r num">{p.op ? inteiro(p.op.quantidade) : "—"}</td>
                    <td className="r num">{p.op ? brl(p.op.preco) : "—"}</td>
                    <td>{p.status === "ok" ? <span className="imp-tag ok">ok</span> : <span className={`imp-tag ${p.status}`}>{p.msg}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="op-botoes">
            <button className="btn btn-primario" disabled={!validas.length || importando} onClick={importar}>
              {importando ? "Importando…" : `Importar ${validas.length} operaç${validas.length === 1 ? "ão" : "ões"}`}
            </button>
            <button className="btn" onClick={() => { setPrevia(null); setAviso(null); }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
