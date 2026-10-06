import { useEffect, useState } from "react";
import type { FundoSnapshot } from "../api/types";
import {
  lerNumero, montarPosicao, rendaMedia12m, rendaMensalConstante, type ModoEntrada, type Renda,
} from "../lib/calculadora";
import { brl, brlDiv, data, inteiro, taxa } from "../lib/format";

export const fmtEntrada = (v: number | null | undefined) =>
  v == null ? "" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/**
 * Bloco 1 — Quanto vou receber.
 * Toda conta está em lib/calculadora.ts; aqui só entrada e exibição.
 */
export function CalcRenda({ f }: { f: FundoSnapshot }) {
  const [modo, setModo] = useState<ModoEntrada>("valor");
  const [entrada, setEntrada] = useState("10.000");
  const [precoTxt, setPrecoTxt] = useState(fmtEntrada(f.preco));
  const [personalizadoTxt, setPersonalizadoTxt] = useState("");

  // Trocou de fundo: volta o preço para o do último pregão
  useEffect(() => { setPrecoTxt(fmtEntrada(f.preco)); setPersonalizadoTxt(""); }, [f.ticker, f.preco]);

  const preco = lerNumero(precoTxt);
  const valorEntrada = lerNumero(entrada);
  const pos = montarPosicao(modo, valorEntrada, preco);
  const precoEditado = f.preco != null && Math.abs(preco - f.preco) > 1e-9;

  const personalizado = lerNumero(personalizadoTxt);
  const cenarios: { nome: string; detalhe: string; renda: Renda | null }[] = [
    {
      nome: "Último dividendo",
      detalhe: f.data_ultimo_dividendo ? `data-ex ${data(f.data_ultimo_dividendo)}, repetido todo mês` : "sem dado",
      renda: rendaMensalConstante(pos, f.ultimo_dividendo),
    },
    {
      nome: "Média dos últimos 12 meses",
      detalhe: `soma real de ${f.pagamentos_12m} pagamento${f.pagamentos_12m === 1 ? "" : "s"} ÷ 12`,
      renda: rendaMedia12m(pos, f.dividendos_12m),
    },
  ];
  if (personalizado >= 0) {
    cenarios.push({ nome: "Valor que você digitou", detalhe: "repetido todo mês", renda: rendaMensalConstante(pos, personalizado) });
  }

  const alertas = alertasRenda(f);

  return (
    <div className="card calc-bloco">
      <div className="chart-title">1. Quanto vou receber</div>
      <div className="chart-sub">Quantas cotas o valor compra e quanto elas rendem por mês e por ano.</div>

      <div className="calc-grid">
        <div className="calc-form">
          <div className="seg" role="radiogroup" aria-label="Informar por">
            <button role="radio" aria-checked={modo === "valor"} onClick={() => setModo("valor")}>Valor (R$)</button>
            <button role="radio" aria-checked={modo === "cotas"} onClick={() => setModo("cotas")}>Nº de cotas</button>
          </div>
          <label>
            {modo === "valor" ? "Quanto quer investir (R$)" : "Quantas cotas"}
            <input inputMode="decimal" value={entrada} onChange={(e) => setEntrada(e.target.value)} />
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
          <div className="calc-kpis">
            <div><span>Cotas</span><b className="num">{inteiro(pos.cotas)}</b></div>
            <div><span>Valor aplicado</span><b className="num">{brl(pos.valorAplicado)}</b></div>
            {modo === "valor" && <div><span>Sobra (não compra 1 cota)</span><b className="num">{brl(pos.sobra)}</b></div>}
          </div>
          {pos.cotas === 0 && Number.isFinite(valorEntrada) && valorEntrada > 0 && preco > 0 && (
            <p className="calc-aviso">O valor não compra nenhuma cota a {brl(preco)}.</p>
          )}
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="calc-tabela" style={{ minWidth: 520 }}>
              <thead>
                <tr><th>Cenário</th><th className="r">Por cota/mês</th><th className="r">Renda mensal</th><th className="r">Renda anual</th><th className="r">Yield s/ custo</th></tr>
              </thead>
              <tbody>
                {cenarios.map((c) => (
                  <tr key={c.nome}>
                    <td>{c.nome}<span className="sub-name">{c.detalhe}</span></td>
                    <td className="r num">{c.renda ? brlDiv(c.renda.porCota) : "—"}</td>
                    <td className="r num"><b>{c.renda ? brl(c.renda.mensal) : "—"}</b></td>
                    <td className="r num">{c.renda ? brl(c.renda.anual) : "—"}</td>
                    <td className="r num">{c.renda ? taxa(c.renda.yieldSobreCusto) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {alertas.length > 0 && (
            <ul className="calc-alertas">{alertas.map((a) => <li key={a}>{a}</li>)}</ul>
          )}
          <details className="calc-formulas">
            <summary>Como a conta é feita</summary>
            <ul>
              <li><b>Cotas</b> = parte inteira de (valor ÷ preço). <b>Sobra</b> = valor − cotas × preço.</li>
              <li><b>Último dividendo</b>: renda mensal = cotas × último rendimento por cota; anual = mensal × 12.</li>
              <li><b>Média de 12 meses</b>: renda anual = cotas × soma do que o fundo pagou por cota nos últimos 12 meses
                ({brlDiv(f.dividendos_12m)}); mensal = anual ÷ 12. Inclui meses sem pagamento e extras.</li>
              <li><b>Yield sobre custo</b> = renda anual ÷ valor aplicado.</li>
              <li>Sem corretagem e taxas. Rendimento de FII é isento de IR para pessoa física (regra geral).
                Rendimento passado não garante rendimento futuro.</li>
            </ul>
          </details>
        </div>
      </div>
    </div>
  );
}

/** Avisos sobre a qualidade da renda do fundo (usados em mais de um bloco). */
export function alertasRenda(f: FundoSnapshot): string[] {
  const alertas: string[] = [];
  const tendencia = f.tendencia_dividendo_pct;
  if (tendencia != null && tendencia <= -3) alertas.push(`A renda vem caindo: os 3 últimos pagamentos estão ${Math.abs(tendencia).toLocaleString("pt-BR")}% abaixo da média de 12 meses.`);
  if ((f.quedas_dividendo_12m ?? 0) > 0) alertas.push(`O fundo teve ${f.quedas_dividendo_12m} queda${f.quedas_dividendo_12m === 1 ? "" : "s"} de rendimento nos últimos 12 meses.`);
  if (f.pagamentos_12m < 11) alertas.push(`Só ${f.pagamentos_12m} pagamentos nos últimos 12 meses: o "último dividendo repetido todo mês" tende a superestimar.`);
  return alertas;
}
