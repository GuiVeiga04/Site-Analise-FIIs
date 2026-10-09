import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../api/client";
import type { FundoSnapshot } from "../api/types";
import { lerNumero, simularHistorico, type ModoEntrada, type PrecoDia, type Provento } from "../lib/calculadora";
import { brl, brlDiv, data, inteiro, taxa } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const eixo = { fontSize: 11, fill: "var(--muted)" };
/** Eixo Y em reais inteiros (10.250): aqui a faixa é estreita e "10 mil" se repetiria. */
const fmtEixo = (v: number) =>
  v >= 1e6 ? `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`
    : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

/** "2026-10-08" menos N meses, no formato ISO (dia ajustado ao fim do mês se preciso). */
function mesesAtras(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 - n, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimoDia));
  return alvo.toISOString().slice(0, 10);
}

const PERIODOS: { rotulo: string; meses: number | null }[] = [
  { rotulo: "3 meses", meses: 3 }, { rotulo: "6 meses", meses: 6 }, { rotulo: "12 meses", meses: 12 }, { rotulo: "Desde o início", meses: null },
];

const sinal = (v: number) => (v > 0 ? "+" : "") + taxa(v);

/**
 * Bloco 5 — E se eu tivesse investido em uma data passada.
 * Usa os preços de fechamento e os rendimentos REAIS do fundo.
 * Toda conta está em lib/calculadora.ts (simularHistorico); aqui só busca de dados, entrada e exibição.
 */
export function CalcHistorico({ f }: { f: FundoSnapshot }) {
  const hist = useAsync(() => api.historico(f.ticker), [f.ticker]);
  const divs = useAsync(() => api.dividendos(f.ticker), [f.ticker]);
  const [modo, setModo] = useState<ModoEntrada>("valor");
  const [entrada, setEntrada] = useState("10.000");
  const [dataTxt, setDataTxt] = useState("");

  const precos: PrecoDia[] = useMemo(
    () => (hist.data ?? []).filter((p) => p.preco != null).map((p) => ({ data: p.data_pregao, preco: p.preco as number })),
    [hist.data]);
  const proventos: Provento[] = useMemo(
    () => (divs.data ?? []).map((d) => ({ dataEx: d.data_ex, valor: d.valor })),
    [divs.data]);
  const primeiro = precos[0]?.data;
  const ultimo = precos[precos.length - 1]?.data;

  const dataPara = (meses: number | null) =>
    !primeiro || !ultimo ? "" : meses == null ? primeiro : (mesesAtras(ultimo, meses) < primeiro ? primeiro : mesesAtras(ultimo, meses));

  // Trocou de fundo (ou os dados chegaram): começa em "12 meses atrás"
  useEffect(() => { setDataTxt(dataPara(12)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [f.ticker, primeiro, ultimo]);

  const valorEntrada = lerNumero(entrada);
  const [com, sem] = useMemo(() => [
    simularHistorico(precos, proventos, dataTxt, modo, valorEntrada, true),
    simularHistorico(precos, proventos, dataTxt, modo, valorEntrada, false),
  ], [precos, proventos, dataTxt, modo, valorEntrada]);

  const serie = useMemo(() => {
    if (!com || !sem) return [];
    return com.serie.map((p, i) => ({
      data: p.data, com: Math.round(p.patrimonio * 100) / 100, sem: Math.round(sem.serie[i].patrimonio * 100) / 100,
      capital: com.capitalInicial,
    }));
  }, [com, sem]);

  const carregando = hist.loading || divs.loading;
  const erro = hist.error ?? divs.error;
  const dataForaDoHistorico = !!dataTxt && !!primeiro && dataTxt < primeiro;

  let aviso: string | null = null;
  if (carregando) aviso = "Carregando o histórico de preços e rendimentos…";
  else if (erro) aviso = `Não foi possível carregar o histórico: ${erro.message}`;
  else if (precos.length < 2) aviso = "Ainda não há histórico de preços suficiente para este fundo.";
  else if (!(valorEntrada > 0)) aviso = modo === "valor" ? "Informe um valor maior que zero." : "Informe o número de cotas.";
  else if (!dataTxt) aviso = "Escolha a data da compra.";
  else if (!com) aviso = dataTxt >= (ultimo ?? "")
    ? `Escolha uma data anterior ao último pregão (${data(ultimo)}).`
    : `Com esse valor não dá para comprar uma cota inteira (a cota estava perto de ${brl(precos.find((p) => p.data >= dataTxt)?.preco)}).`;

  const periodoAtivo = PERIODOS.find((p) => dataPara(p.meses) === dataTxt)?.rotulo;

  return (
    <div className="card calc-bloco">
      <div className="chart-title">5. E se eu tivesse investido em uma data passada?</div>
      <div className="chart-sub">Compra no fechamento do pregão escolhido e acompanha até hoje com os preços e rendimentos reais do fundo.</div>

      <div className="calc-grid">
        <div className="calc-form">
          <div className="seg" role="radiogroup" aria-label="Período">
            {PERIODOS.map((p) => (
              <button key={p.rotulo} role="radio" aria-checked={periodoAtivo === p.rotulo} onClick={() => setDataTxt(dataPara(p.meses))}>{p.rotulo}</button>
            ))}
          </div>
          <label>Data da compra
            <input type="date" value={dataTxt} min={primeiro} max={ultimo} onChange={(e) => setDataTxt(e.target.value)} />
            <span className="calc-dica">
              {primeiro ? <>Histórico disponível de {data(primeiro)} a {data(ultimo)}. Fim de semana ou feriado: usa o pregão seguinte.</> : " "}
            </span>
          </label>
          <div className="seg" role="radiogroup" aria-label="Informar por">
            <button role="radio" aria-checked={modo === "valor"} onClick={() => setModo("valor")}>Valor (R$)</button>
            <button role="radio" aria-checked={modo === "cotas"} onClick={() => setModo("cotas")}>Nº de cotas</button>
          </div>
          <label>{modo === "valor" ? "Quanto teria investido (R$)" : "Quantas cotas teria comprado"}
            <input inputMode="decimal" value={entrada} onChange={(e) => setEntrada(e.target.value)} />
          </label>
          {dataForaDoHistorico && <p className="calc-aviso">O histórico começa em {data(primeiro)}; a simulação usa esse primeiro pregão.</p>}
        </div>

        <div>
          {aviso || !com || !sem ? (
            <p className="calc-aviso">{aviso ?? "Não foi possível simular com esses dados."}</p>
          ) : (
            <>
              <p className="calc-frase">
                Comprando <b className="num">{inteiro(com.cotasIniciais)} cotas</b> de {f.ticker} em <b>{data(com.dataCompra)}</b> a <b className="num">{brl(com.precoCompra)}</b>,
                você teria recebido <b className="num">{brl(sem.rendimentosRecebidos)}</b> em rendimentos ({sem.pagamentos.length} pagamento{sem.pagamentos.length === 1 ? "" : "s"}).
                Em {data(com.dataFinal)}, reinvestindo, o investimento valeria <b className="num">{brl(com.valorFinal)}</b> ({sinal(com.retornoTotalPct)});
                só com a cota, a variação foi de <b className="num">{sinal(com.variacaoPrecoPct)}</b>.
              </p>
              <div className="table-wrap" style={{ border: 0 }}>
                <table className="calc-tabela" style={{ minWidth: 560 }}>
                  <thead>
                    <tr><th></th><th className="r">Reinvestindo</th><th className="r">Sem reinvestir</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>Investido em {data(com.dataCompra)}<span className="sub-name">{inteiro(com.cotasIniciais)} cotas a {brl(com.precoCompra)}{com.caixa > 0 || modo === "valor" ? " + troco" : ""}</span></td>
                      <td className="r num">{brl(com.capitalInicial)}</td><td className="r num">{brl(sem.capitalInicial)}</td></tr>
                    <tr><td>Rendimentos recebidos</td><td className="r num">{brl(com.rendimentosRecebidos)}</td><td className="r num">{brl(sem.rendimentosRecebidos)}</td></tr>
                    <tr><td>Cotas hoje</td><td className="r num">{inteiro(com.cotasFinais)}</td><td className="r num">{inteiro(sem.cotasFinais)}</td></tr>
                    <tr><td>Valor em {data(com.dataFinal)}<span className="sub-name">cotas × {brl(com.precoFinal)} + troco{" "}(+ rendimentos, sem reinvestir)</span></td>
                      <td className="r num"><b>{brl(com.valorFinal)}</b></td><td className="r num"><b>{brl(sem.valorFinal)}</b></td></tr>
                    <tr><td>Retorno total</td><td className="r num"><b>{sinal(com.retornoTotalPct)}</b></td><td className="r num"><b>{sinal(sem.retornoTotalPct)}</b></td></tr>
                    <tr><td>Só a variação da cota</td><td className="r num">{sinal(com.variacaoPrecoPct)}</td><td className="r num">{sinal(sem.variacaoPrecoPct)}</td></tr>
                  </tbody>
                </table>
              </div>

              <div className="calc-graficos">
                <div className="chart-title">Valor do investimento, pregão a pregão</div>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={serie} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="data" tick={eixo} tickLine={false} axisLine={{ stroke: "var(--baseline)" }} minTickGap={40}
                      tickFormatter={(d: string) => d.slice(5).split("-").reverse().join("/")} />
                    <YAxis tick={eixo} width={72} tickFormatter={fmtEixo} domain={["auto", "auto"]} />
                    <Tooltip content={({ payload }) => {
                      const p = payload?.[0]?.payload;
                      return p ? <div className="tip">{data(p.data)}<br />Reinvestindo: <b>{brl(p.com)}</b><br />Sem reinvestir: <b>{brl(p.sem)}</b><br />Investido: {brl(p.capital)}</div> : null;
                    }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => ({ com: "Reinvestindo", sem: "Sem reinvestir", capital: "Investido" } as Record<string, string>)[v]} />
                    <Line isAnimationActive={false} dataKey="com" stroke="var(--cmp-a)" strokeWidth={2} dot={false} />
                    <Line isAnimationActive={false} dataKey="sem" stroke="var(--cmp-b)" strokeWidth={2} dot={false} />
                    <Line isAnimationActive={false} dataKey="capital" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {com.pagamentos.length > 0 && (
                <details className="calc-formulas">
                  <summary>Rendimentos recebidos, um a um ({com.pagamentos.length})</summary>
                  <div className="table-wrap" style={{ border: 0 }}>
                    <table className="calc-tabela" style={{ minWidth: 560 }}>
                      <thead>
                        <tr><th>Data-ex</th><th className="r">Por cota</th><th className="r">Cotas</th><th className="r">Recebido</th>
                          <th className="r">Preço p/ reinvestir</th><th className="r">Cotas compradas</th></tr>
                      </thead>
                      <tbody>
                        {com.pagamentos.map((p) => (
                          <tr key={p.dataEx}>
                            <td>{data(p.dataEx)}</td><td className="r num">{brlDiv(p.valorPorCota)}</td><td className="r num">{inteiro(p.cotas)}</td>
                            <td className="r num">{brl(p.recebido)}</td><td className="r num">{brl(p.precoReinvestimento)}</td><td className="r num">{inteiro(p.cotasCompradas)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="calc-dica">Coluna "Cotas" e "Recebido" na versão reinvestindo. Sem reinvestir, você fica sempre com {inteiro(sem.cotasIniciais)} cotas.</p>
                </details>
              )}
            </>
          )}
          <details className="calc-formulas">
            <summary>Como a conta é feita</summary>
            <ul>
              <li>Compra no <b>preço de fechamento</b> do primeiro pregão na data escolhida ou depois dela, só cotas inteiras; o troco fica guardado.</li>
              <li>Recebe todo rendimento com <b>data-ex depois do dia da compra</b> (quem compra na própria data-ex já não leva aquele rendimento) e até o último pregão.</li>
              <li><b>Reinvestindo</b>: o rendimento soma ao troco e compra cotas inteiras no fechamento da data-ex. É uma aproximação: o dinheiro de verdade cai alguns dias depois, na data de pagamento.</li>
              <li><b>Sem reinvestir</b>: os rendimentos ficam fora, somados ao valor final.</li>
              <li>Retorno total = valor final ÷ valor investido − 1. Sem corretagem e sem IR (rendimento de FII é isento para pessoa física, regra geral).</li>
              <li>Preços já passam pelo filtro de cotações anômalas do painel. Resultado passado não garante resultado futuro.</li>
            </ul>
          </details>
        </div>
      </div>
    </div>
  );
}
