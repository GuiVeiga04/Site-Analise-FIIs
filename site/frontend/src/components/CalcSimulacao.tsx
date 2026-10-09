import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { FundoSnapshot } from "../api/types";
import { TAXA_ANUAL_MAX, TAXA_ANUAL_MIN, lerNumero, limitarTaxa, mediaMensal12m, simular, type ResultadoSimulacao } from "../lib/calculadora";
import { brl, brlDiv, inteiro } from "../lib/format";
import { alertasRenda, avisoRendimento, fmtEntrada } from "./CalcRenda";

type Cenario = "media" | "ultimo" | "personalizado";
const eixo = { fontSize: 11, fill: "var(--muted)" };

/** Eixo Y sem arredondar demais: 1.200 continua 1.200 (e não "1 mil"). */
const fmtEixo = (v: number) =>
  v >= 1e6 ? `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`
    : v >= 1e4 ? `${Math.round(v / 1e3).toLocaleString("pt-BR")} mil`
      : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

/** Prazo por extenso: "10 anos", "1 ano", "30 meses". */
const prazoTexto = (m: number) =>
  m % 12 === 0 ? `${m / 12} ano${m === 12 ? "" : "s"}` : `${m} ${m === 1 ? "mês" : "meses"}`;

/** Rótulo de tempo: "ano 3" ou "mês 7". */
const rotuloMes = (m: number) => (m % 12 === 0 ? `ano ${m / 12}` : `mês ${m}`);

/**
 * Bloco 4 — Simulação com aporte mensal e reinvestimento.
 * Toda conta está em lib/calculadora.ts (simular); aqui só entrada, gráfico e resumo.
 */
export function CalcSimulacao({ f }: { f: FundoSnapshot }) {
  const [inicialTxt, setInicialTxt] = useState("10.000");
  const [mensalTxt, setMensalTxt] = useState("1.000");
  const [anosTxt, setAnosTxt] = useState("10");
  const [cenario, setCenario] = useState<Cenario>("media");
  const [personalizadoTxt, setPersonalizadoTxt] = useState("");
  const [precoTxt, setPrecoTxt] = useState(fmtEntrada(f.preco));
  const [crescRendTxt, setCrescRendTxt] = useState("0");
  const [valorizTxt, setValorizTxt] = useState("0");
  const [inflTxt, setInflTxt] = useState("0");

  useEffect(() => { setPrecoTxt(fmtEntrada(f.preco)); setPersonalizadoTxt(""); }, [f.ticker, f.preco]);

  const rendimento =
    cenario === "ultimo" ? f.ultimo_dividendo
      : cenario === "media" ? mediaMensal12m(f.dividendos_12m)
        : lerNumero(personalizadoTxt);
  const anos = lerNumero(anosTxt);
  const parametros = {
    preco: lerNumero(precoTxt),
    rendimentoMensalPorCota: rendimento ?? Number.NaN,
    aporteInicial: lerNumero(inicialTxt) || 0,
    aporteMensal: lerNumero(mensalTxt) || 0,
    meses: Math.round((Number.isFinite(anos) ? anos : 0) * 12),
    crescimentoRendimentoAnual: lerNumero(crescRendTxt) || 0,
    valorizacaoPrecoAnual: lerNumero(valorizTxt) || 0,
    inflacaoAnual: lerNumero(inflTxt) || 0,
  };
  const chave = JSON.stringify(parametros);
  const [com, sem] = useMemo((): [ResultadoSimulacao | null, ResultadoSimulacao | null] => [
    simular({ ...parametros, reinvestir: true }),
    simular({ ...parametros, reinvestir: false }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [chave]);

  // Gráfico: até 3 anos mês a mês; acima disso, um ponto por ano
  const serie = useMemo(() => {
    if (!com || !sem) return [];
    const passo = com.meses.length > 37 ? 12 : 1;
    return com.meses.filter((m) => m.mes % passo === 0 || m.mes === com.final.mes).map((m) => ({
      mes: m.mes,
      com: Math.round(m.patrimonio),
      sem: Math.round(sem.meses[m.mes].patrimonio),
      aportado: Math.round(m.totalAportado),
      rendaCom: Math.round(m.rendaMes * 100) / 100,
      rendaSem: Math.round(sem.meses[m.mes].rendaMes * 100) / 100,
    }));
  }, [com, sem]);

  const ajustes = parametros.crescimentoRendimentoAnual !== 0 || parametros.valorizacaoPrecoAnual !== 0;
  const alertas = alertasRenda(f);
  const prazoInvalido = parametros.meses <= 0;

  return (
    <div className="card calc-bloco">
      <div className="chart-title">4. Simulação com aporte e reinvestimento</div>
      <div className="chart-sub">Mês a mês: recebe os rendimentos, soma o aporte e compra cotas. Compara reinvestir os rendimentos com gastá-los.</div>

      <div className="calc-grid">
        <div className="calc-form">
          <label>Aporte inicial (R$)<input inputMode="decimal" value={inicialTxt} onChange={(e) => setInicialTxt(e.target.value)} /></label>
          <label>Aporte mensal (R$)<input inputMode="decimal" value={mensalTxt} onChange={(e) => setMensalTxt(e.target.value)} /></label>
          <label>Prazo (anos)<input inputMode="decimal" value={anosTxt} onChange={(e) => setAnosTxt(e.target.value)} />
            <span className="calc-dica">Até 50 anos.</span></label>
          <label>
            Rendimento por cota
            <select value={cenario} onChange={(e) => setCenario(e.target.value as Cenario)}>
              <option value="media">Média dos últimos 12 meses ({brlDiv(mediaMensal12m(f.dividendos_12m))}/mês)</option>
              <option value="ultimo">Último dividendo ({brlDiv(f.ultimo_dividendo)}/mês)</option>
              <option value="personalizado">Digitar um valor</option>
            </select>
          </label>
          {cenario === "personalizado" && (
            <label>Rendimento por cota/mês (R$)<input inputMode="decimal" placeholder={fmtEntrada(f.ultimo_dividendo)}
              value={personalizadoTxt} onChange={(e) => setPersonalizadoTxt(e.target.value)} /></label>
          )}
          <details className="calc-avancado">
            <summary>Premissas avançadas</summary>
            <label>Preço da cota hoje (R$)<input inputMode="decimal" value={precoTxt} onChange={(e) => setPrecoTxt(e.target.value)} /></label>
            <label>Crescimento do rendimento (% ao ano)<input inputMode="decimal" value={crescRendTxt} onChange={(e) => setCrescRendTxt(e.target.value)} /></label>
            <label>Valorização da cota (% ao ano)<input inputMode="decimal" value={valorizTxt} onChange={(e) => setValorizTxt(e.target.value)} /></label>
            <label>Inflação (% ao ano)<input inputMode="decimal" value={inflTxt} onChange={(e) => setInflTxt(e.target.value)} />
              <span className="calc-dica">Só para mostrar o patrimônio final em reais de hoje.</span></label>
            <span className="calc-dica">As taxas anuais ficam limitadas entre {TAXA_ANUAL_MIN}% e +{TAXA_ANUAL_MAX}% ao ano.</span>
          </details>
        </div>

        <div>
          {!com || !sem || prazoInvalido ? (
            <p className="calc-aviso">
              {avisoRendimento(parametros.rendimentoMensalPorCota, parametros.preco)
                ?? (prazoInvalido || !(parametros.preco > 0) || !(parametros.rendimentoMensalPorCota >= 0)
                  ? "Informe preço, rendimento e um prazo maior que zero."
                  : "Essa combinação de premissas leva a valores fora de escala. Revise as premissas avançadas.")}
            </p>
          ) : (
            <>
              <p className="calc-frase">
                Em <b>{prazoTexto(com.final.mes)}</b> você
                teria aportado <b className="num">{brl(com.final.totalAportado)}</b>. Reinvestindo os rendimentos, chegaria
                a <b className="num">{inteiro(com.final.cotas)} cotas</b> de {f.ticker}, valendo cerca
                de <b className="num">{brl(com.final.patrimonio)}</b> e rendendo <b className="num">{brl(com.final.rendaMes)}</b> por mês.
                {com.mesNumeroMagico != null
                  ? <> O número mágico seria atingido no <b>{rotuloMes(com.mesNumeroMagico)}</b>.</>
                  : <> O número mágico não seria atingido nesse prazo.</>}
              </p>
              <div className="table-wrap" style={{ border: 0 }}>
                <table className="calc-tabela" style={{ minWidth: 560 }}>
                  <thead>
                    <tr><th></th><th className="r">Reinvestindo</th><th className="r">Sem reinvestir</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>Saiu do seu bolso</td><td className="r num">{brl(com.final.totalAportado)}</td><td className="r num">{brl(sem.final.totalAportado)}</td></tr>
                    <tr><td>Cotas no final</td><td className="r num">{inteiro(com.final.cotas)}</td><td className="r num">{inteiro(sem.final.cotas)}</td></tr>
                    <tr><td>Patrimônio final<span className="sub-name">cotas × preço + troco</span></td>
                      <td className="r num"><b>{brl(com.final.patrimonio)}</b></td><td className="r num"><b>{brl(sem.final.patrimonio)}</b></td></tr>
                    {parametros.inflacaoAnual !== 0 && (
                      <tr><td>Patrimônio em reais de hoje<span className="sub-name">descontada a inflação de {limitarTaxa(parametros.inflacaoAnual).toLocaleString("pt-BR")}% a.a.</span></td>
                        <td className="r num">{brl(com.final.patrimonioReal)}</td><td className="r num">{brl(sem.final.patrimonioReal)}</td></tr>
                    )}
                    <tr><td>Renda no último mês</td><td className="r num"><b>{brl(com.final.rendaMes)}</b></td><td className="r num"><b>{brl(sem.final.rendaMes)}</b></td></tr>
                    <tr><td>Rendimentos recebidos no período<span className="sub-name">sem reinvestir: dinheiro que você gastou ou guardou fora</span></td>
                      <td className="r num">{brl(com.final.totalRendimentos)}</td><td className="r num">{brl(sem.final.totalRendimentos)}</td></tr>
                  </tbody>
                </table>
              </div>

              <div className="grid-2 grid-2-even calc-graficos">
                <div>
                  <div className="chart-title">Patrimônio</div>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={serie} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="var(--grid)" vertical={false} />
                      <XAxis dataKey="mes" tick={eixo} tickLine={false} axisLine={{ stroke: "var(--baseline)" }}
                        tickFormatter={(m: number) => (serie.length > 37 || m % 12 === 0 ? `${Math.round(m / 12)}a` : `${m}m`)} />
                      <YAxis tick={eixo} width={64} tickFormatter={fmtEixo} />
                      <Tooltip content={({ payload }) => {
                        const p = payload?.[0]?.payload;
                        return p ? <div className="tip">{rotuloMes(p.mes)}<br />Reinvestindo: <b>{brl(p.com, 0)}</b><br />Sem reinvestir: <b>{brl(p.sem, 0)}</b><br />Aportado: {brl(p.aportado, 0)}</div> : null;
                      }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => ({ com: "Reinvestindo", sem: "Sem reinvestir", aportado: "Aportado" } as Record<string, string>)[v]} />
                      <Line isAnimationActive={false} dataKey="com" stroke="var(--cmp-a)" strokeWidth={2} dot={false} />
                      <Line isAnimationActive={false} dataKey="sem" stroke="var(--cmp-b)" strokeWidth={2} dot={false} />
                      <Line isAnimationActive={false} dataKey="aportado" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <div className="chart-title">Renda mensal</div>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={serie} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="var(--grid)" vertical={false} />
                      <XAxis dataKey="mes" tick={eixo} tickLine={false} axisLine={{ stroke: "var(--baseline)" }}
                        tickFormatter={(m: number) => (serie.length > 37 || m % 12 === 0 ? `${Math.round(m / 12)}a` : `${m}m`)} />
                      <YAxis tick={eixo} width={64} tickFormatter={fmtEixo} />
                      <Tooltip content={({ payload }) => {
                        const p = payload?.[0]?.payload;
                        return p ? <div className="tip">{rotuloMes(p.mes)}<br />Reinvestindo: <b>{brl(p.rendaCom)}</b><br />Sem reinvestir: <b>{brl(p.rendaSem)}</b></div> : null;
                      }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => ({ rendaCom: "Reinvestindo", rendaSem: "Sem reinvestir" } as Record<string, string>)[v]} />
                      <Line isAnimationActive={false} dataKey="rendaCom" stroke="var(--cmp-a)" strokeWidth={2} dot={false} />
                      <Line isAnimationActive={false} dataKey="rendaSem" stroke="var(--cmp-b)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <p className={ajustes ? "calc-dica" : "calc-aviso"}>
                {ajustes
                  ? `Premissas: rendimento crescendo ${limitarTaxa(parametros.crescimentoRendimentoAnual).toLocaleString("pt-BR")}% e cota valorizando ${limitarTaxa(parametros.valorizacaoPrecoAnual).toLocaleString("pt-BR")}% ao ano.`
                  : "Preço e rendimento fixos em valores de hoje durante todo o prazo (por isso a linha \"sem reinvestir\" coincide com o total aportado). Na prática os dois oscilam: use as premissas avançadas para testar cenários."}
              </p>
            </>
          )}
          {alertas.length > 0 && <ul className="calc-alertas">{alertas.map((a) => <li key={a}>{a}</li>)}</ul>}
          <details className="calc-formulas">
            <summary>Como a conta é feita</summary>
            <ul>
              <li>No <b>mês 0</b> o aporte inicial compra o máximo de cotas inteiras.</li>
              <li>Em cada mês seguinte, nesta ordem: recebe <b>cotas × rendimento por cota</b>; soma o aporte mensal ao
                caixa; se reinvestir, soma também os rendimentos; compra o máximo de cotas inteiras; o troco fica para o mês seguinte.</li>
              <li><b>Sem reinvestir</b>, os rendimentos são recebidos mas não compram cotas (você gasta ou guarda fora).</li>
              <li>O mês 1 usa o preço e o rendimento de hoje. Com as premissas avançadas, os dois mudam todo mês pela taxa
                equivalente: (1 + taxa anual)^(1/12) − 1.</li>
              <li><b>Número mágico</b> atingido = primeiro mês em que a renda do mês é maior ou igual ao preço de uma cota.</li>
              <li>Sem corretagem e sem IR (rendimento de FII é isento para pessoa física, regra geral). Simulação, não promessa de retorno.</li>
            </ul>
          </details>
        </div>
      </div>
    </div>
  );
}
