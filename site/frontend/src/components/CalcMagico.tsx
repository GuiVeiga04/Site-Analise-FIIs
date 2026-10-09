import { useEffect, useState } from "react";
import type { FundoSnapshot } from "../api/types";
import { calcularNumeroMagico, lerNumero, mediaMensal12m, type NumeroMagico } from "../lib/calculadora";
import { brl, brlDiv, data, inteiro } from "../lib/format";
import { avisoRendimento, fmtEntrada } from "./CalcRenda";

/**
 * Bloco 3 — Número mágico: quantas cotas para que a renda de um mês compre uma cota nova.
 * Toda conta está em lib/calculadora.ts (calcularNumeroMagico).
 */
export function CalcMagico({ f }: { f: FundoSnapshot }) {
  const [precoTxt, setPrecoTxt] = useState(fmtEntrada(f.preco));
  const [temTxt, setTemTxt] = useState("");
  const [personalizadoTxt, setPersonalizadoTxt] = useState("");

  useEffect(() => { setPrecoTxt(fmtEntrada(f.preco)); setPersonalizadoTxt(""); }, [f.ticker, f.preco]);

  const preco = lerNumero(precoTxt);
  const tem = lerNumero(temTxt);
  const temCotas = tem > 0;
  const precoEditado = f.preco != null && Math.abs(preco - f.preco) > 1e-9;
  const personalizado = lerNumero(personalizadoTxt);

  const cenarios: { nome: string; detalhe: string; porCota: number | null; n: NumeroMagico | null }[] = [
    {
      nome: "Último dividendo",
      detalhe: f.data_ultimo_dividendo ? `data-ex ${data(f.data_ultimo_dividendo)}` : "sem dado",
      porCota: f.ultimo_dividendo,
      n: calcularNumeroMagico(preco, f.ultimo_dividendo, tem),
    },
    {
      nome: "Média dos últimos 12 meses",
      detalhe: `${f.pagamentos_12m} pagamentos, soma ÷ 12`,
      porCota: mediaMensal12m(f.dividendos_12m),
      n: calcularNumeroMagico(preco, mediaMensal12m(f.dividendos_12m), tem),
    },
  ];
  const avisoPers = avisoRendimento(personalizado, preco);
  if (personalizado > 0 && !avisoPers) {
    cenarios.push({ nome: "Valor que você digitou", detalhe: "por cota, todo mês", porCota: personalizado, n: calcularNumeroMagico(preco, personalizado, tem) });
  }
  const d = cenarios[1].n;

  return (
    <div className="card calc-bloco">
      <div className="chart-title">3. Número mágico</div>
      <div className="chart-sub">Quantas cotas para que a renda de um mês compre uma cota nova sozinha.</div>

      <div className="calc-grid">
        <div className="calc-form">
          <label>
            Preço da cota (R$)
            <input inputMode="decimal" value={precoTxt} onChange={(e) => setPrecoTxt(e.target.value)} />
            <span className="calc-dica">
              {precoEditado
                ? <>Editado. <button className="link-btn" onClick={() => setPrecoTxt(fmtEntrada(f.preco))}>Voltar ao último pregão ({brl(f.preco)})</button></>
                : <>Fechamento do último pregão ({data(f.data_pregao)}).</>}
            </span>
          </label>
          <label>
            Cotas que você já tem (opcional)
            <input inputMode="numeric" placeholder="0" value={temTxt} onChange={(e) => setTemTxt(e.target.value)} />
          </label>
          <label>
            Rendimento por cota para simular (opcional)
            <input inputMode="decimal" placeholder={`ex: ${fmtEntrada(f.ultimo_dividendo)}`} value={personalizadoTxt}
              onChange={(e) => setPersonalizadoTxt(e.target.value)} />
          </label>
        </div>

        <div>
          {d ? (
            <p className="calc-frase">
              Com <b className="num">{inteiro(d.cotas)} cotas</b> de {f.ticker} (cerca de <b className="num">{brl(d.capital)}</b>),
              a renda de um mês, {brl(d.rendaMensal)} pela média de 12 meses, já paga uma cota nova de {brl(preco)}.
              {temCotas && (d.faltamCotas > 0
                ? <> Você tem {inteiro(Math.floor(tem))}: faltam <b className="num">{inteiro(d.faltamCotas)} cotas</b> ({brl(d.faltamCapital)}).</>
                : <> Você já tem {inteiro(Math.floor(tem))} cotas: <b>já atingiu</b> o número mágico.</>)}
            </p>
          ) : (
            <p className="calc-aviso">Informe um preço válido. O fundo precisa ter rendimento para existir número mágico.</p>
          )}
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="calc-tabela" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Cenário</th><th className="r">Por cota/mês</th><th className="r">Número mágico</th>
                  <th className="r">Capital</th><th className="r">{temCotas ? "Faltam" : "Renda no número"}</th>
                </tr>
              </thead>
              <tbody>
                {cenarios.map((c) => (
                  <tr key={c.nome}>
                    <td>{c.nome}<span className="sub-name">{c.detalhe}</span></td>
                    <td className="r num">{brlDiv(c.porCota)}</td>
                    <td className="r num"><b>{c.n ? `${inteiro(c.n.cotas)} cotas` : "—"}</b></td>
                    <td className="r num">{c.n ? brl(c.n.capital) : "—"}</td>
                    <td className="r num">
                      {!c.n ? "—" : temCotas
                        ? (c.n.faltamCotas > 0 ? <>{inteiro(c.n.faltamCotas)} cotas<span className="sub-name">{brl(c.n.faltamCapital)}</span></> : "atingido")
                        : brl(c.n.rendaMensal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {avisoPers && <p className="calc-aviso">{avisoPers}</p>}
          <details className="calc-formulas">
            <summary>Como a conta é feita</summary>
            <ul>
              <li><b>Número mágico</b> = preço da cota ÷ rendimento mensal por cota, arredondado <b>para cima</b>.
                É a menor quantidade de cotas em que cotas × rendimento ≥ preço.</li>
              <li>Exemplo: {brl(preco)} ÷ {brlDiv(f.ultimo_dividendo)} = {f.ultimo_dividendo && preco > 0 ? (preco / f.ultimo_dividendo).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"}, arredondado
                para cima. Com uma cota a menos, a renda do mês não chegaria ao preço de uma cota.</li>
              <li>É o mesmo que 1 ÷ DY mensal: um fundo que rende 0,8% ao mês tem número mágico perto de 125 cotas,
                qualquer que seja o preço. O <b>capital</b> é que muda com o preço da cota.</li>
              <li>Depois de atingido, reinvestindo os rendimentos você compra pelo menos uma cota por mês sem tirar
                dinheiro do bolso, e cada cota nova aumenta a renda do mês seguinte (efeito "bola de neve").</li>
              <li>Supõe preço e rendimento constantes, sem corretagem. Rendimento passado não garante rendimento futuro.</li>
            </ul>
          </details>
        </div>
      </div>
    </div>
  );
}
