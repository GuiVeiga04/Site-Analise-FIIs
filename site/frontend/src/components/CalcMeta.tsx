import { useEffect, useState } from "react";
import type { FundoSnapshot } from "../api/types";
import { calcularMeta, lerNumero, mediaMensal12m, type MetaRenda } from "../lib/calculadora";
import { brl, brlDiv, data, inteiro, taxa } from "../lib/format";
import { alertasRenda, fmtEntrada } from "./CalcRenda";

/**
 * Bloco 2 — Meta de renda: quanto preciso ter para receber R$ X por mês.
 * Toda conta está em lib/calculadora.ts (calcularMeta); aqui só entrada e exibição.
 */
export function CalcMeta({ f }: { f: FundoSnapshot }) {
  const [metaTxt, setMetaTxt] = useState("1.000");
  const [precoTxt, setPrecoTxt] = useState(fmtEntrada(f.preco));
  const [personalizadoTxt, setPersonalizadoTxt] = useState("");

  useEffect(() => { setPrecoTxt(fmtEntrada(f.preco)); setPersonalizadoTxt(""); }, [f.ticker, f.preco]);

  const meta = lerNumero(metaTxt);
  const preco = lerNumero(precoTxt);
  const precoEditado = f.preco != null && Math.abs(preco - f.preco) > 1e-9;
  const personalizado = lerNumero(personalizadoTxt);

  const cenarios: { nome: string; detalhe: string; porCota: number | null; r: MetaRenda | null }[] = [
    {
      nome: "Último dividendo",
      detalhe: f.data_ultimo_dividendo ? `data-ex ${data(f.data_ultimo_dividendo)}` : "sem dado",
      porCota: f.ultimo_dividendo,
      r: calcularMeta(meta, f.ultimo_dividendo, preco),
    },
    {
      nome: "Média dos últimos 12 meses",
      detalhe: `${f.pagamentos_12m} pagamentos, soma ÷ 12`,
      porCota: mediaMensal12m(f.dividendos_12m),
      r: calcularMeta(meta, mediaMensal12m(f.dividendos_12m), preco),
    },
  ];
  if (personalizado > 0) {
    cenarios.push({ nome: "Valor que você digitou", detalhe: "por cota, todo mês", porCota: personalizado, r: calcularMeta(meta, personalizado, preco) });
  }
  const destaque = cenarios[1].r;
  const alertas = alertasRenda(f);

  return (
    <div className="card calc-bloco">
      <div className="chart-title">2. Meta de renda</div>
      <div className="chart-sub">Quantas cotas e quanto capital para receber um valor por mês.</div>

      <div className="calc-grid">
        <div className="calc-form">
          <label>
            Renda mensal desejada (R$)
            <input inputMode="decimal" value={metaTxt} onChange={(e) => setMetaTxt(e.target.value)} />
          </label>
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
            Rendimento por cota para simular (opcional)
            <input inputMode="decimal" placeholder={`ex: ${fmtEntrada(f.ultimo_dividendo)}`} value={personalizadoTxt}
              onChange={(e) => setPersonalizadoTxt(e.target.value)} />
          </label>
        </div>

        <div>
          {destaque ? (
            <p className="calc-frase">
              Para receber <b>{brl(meta)}</b> por mês com {f.ticker}, pela média dos últimos 12 meses, você
              precisaria de <b className="num">{inteiro(destaque.cotas)} cotas</b>, cerca
              de <b className="num">{brl(destaque.capital)}</b> a {brl(preco)} por cota.
            </p>
          ) : (
            <p className="calc-aviso">Informe uma renda mensal e um preço válidos.</p>
          )}
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="calc-tabela" style={{ minWidth: 560 }}>
              <thead>
                <tr><th>Cenário</th><th className="r">Por cota/mês</th><th className="r">Cotas necessárias</th><th className="r">Capital necessário</th><th className="r">Renda obtida</th></tr>
              </thead>
              <tbody>
                {cenarios.map((c) => (
                  <tr key={c.nome}>
                    <td>{c.nome}<span className="sub-name">{c.detalhe}</span></td>
                    <td className="r num">{brlDiv(c.porCota)}{c.r && <span className="sub-name">{taxa(c.r.dyMensal)} ao mês</span>}</td>
                    <td className="r num">{c.r ? inteiro(c.r.cotas) : "—"}</td>
                    <td className="r num"><b>{c.r ? brl(c.r.capital) : "—"}</b></td>
                    <td className="r num">{c.r ? brl(c.r.rendaObtida) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {alertas.length > 0 && <ul className="calc-alertas">{alertas.map((a) => <li key={a}>{a}</li>)}</ul>}
          <details className="calc-formulas">
            <summary>Como a conta é feita</summary>
            <ul>
              <li><b>Cotas necessárias</b> = renda desejada ÷ rendimento mensal por cota, arredondado <b>para cima</b>
                (com uma cota a menos a renda ficaria abaixo da meta).</li>
              <li><b>Capital necessário</b> = cotas × preço. <b>Renda obtida</b> = cotas × rendimento por cota, por isso
                pode passar um pouco da meta.</li>
              <li>Na <b>média de 12 meses</b>, o rendimento mensal por cota é a soma paga em 12 meses
                ({brlDiv(f.dividendos_12m)}) ÷ 12.</li>
              <li>Supõe preço e rendimento constantes, sem corretagem. Rendimento passado não garante rendimento futuro.</li>
            </ul>
          </details>
        </div>
      </div>
    </div>
  );
}
