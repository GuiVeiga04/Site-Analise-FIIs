import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api/client";
import { baixar } from "../components/ImportarExportar";
import { Estado } from "../components/ui";
import { useAuth } from "../lib/auth";
import { hojeIso, rendimentosRecebidos } from "../lib/carteira";
import { useOperacoes } from "../lib/carteiraApi";
import { brl, data, inteiro } from "../lib/format";
import {
  ALIQUOTA_FII, BENS_CODIGO, BENS_GRUPO, CODIGO_DARF, DARF_MINIMO, anosDaCarteira, apurarMeses, bensEDireitos, darfsProximos,
  fichaFiiAnual, rendimentosIsentos, vendasRealizadas, type InfoIR,
} from "../lib/impostoRenda";
import { useAsync } from "../lib/useAsync";
import { useProventos } from "../lib/useProventos";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const mesExtenso = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
const resultadoTxt = (v: number) => (Math.abs(v) < 0.005 ? brl(0) : `${v > 0 ? "+" : "−"}${brl(Math.abs(v))}`);
const cls = (v: number) => (v > 0.004 ? "up" : v < -0.004 ? "down" : "");

function Copiar({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="link-btn" onClick={async () => {
      try { await navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* sem permissão */ }
    }}>{ok ? "copiado ✓" : "copiar"}</button>
  );
}

/**
 * Imposto de Renda da carteira: apuração mensal das vendas (DARF) e os dados
 * da declaração anual. Toda conta está em lib/impostoRenda.ts.
 */
export default function ImpostoRenda() {
  const auth = useAuth();
  const snap = useAsync(api.snapshot, []);
  const { ops, carregando, erro } = useOperacoes(auth.usuario?.id ?? null);
  const proventos = useProventos(ops);
  const hoje = hojeIso();
  const anos = useMemo(() => anosDaCarteira(ops, hoje), [ops, hoje]);
  const [anoEscolhido, setAno] = useState<number | null>(null);
  // Na época da declaração (até maio) o ano que interessa é o anterior
  const anoPadrao = anos.includes(Number(hoje.slice(0, 4)) - 1) && Number(hoje.slice(5, 7)) <= 5 ? Number(hoje.slice(0, 4)) - 1 : anos[0];
  const ano = anoEscolhido ?? anoPadrao;

  const info = useMemo(() => new Map<string, InfoIR>((snap.data ?? []).map((f) => [f.ticker, { nome: f.nome, cnpj: f.cnpj ?? null }])), [snap.data]);
  const vendas = useMemo(() => vendasRealizadas(ops), [ops]);
  const meses = useMemo(() => apurarMeses(vendas), [vendas]);
  const proximos = darfsProximos(meses, hoje);
  const recebidos = useMemo(() => (proventos ? rendimentosRecebidos(ops, proventos, hoje) : []), [ops, proventos, hoje]);
  const bens = useMemo(() => (ano ? bensEDireitos(ops, ano, info) : []), [ops, ano, info]);
  const isentos = useMemo(() => (ano ? rendimentosIsentos(recebidos, ano, info) : []), [recebidos, ano, info]);
  const ficha = useMemo(() => (ano ? fichaFiiAnual(meses, ano) : []), [meses, ano]);

  if (auth.carregando) return <p className="state">Carregando…</p>;
  if (!auth.usuario) return <Navigate to="/entrar" replace />;
  if (!snap.data || (carregando && !ops.length)) return <Estado loading={snap.loading || carregando} error={snap.error} />;

  const prejuizoAtual = meses.at(-1)?.prejuizoAcumulado ?? 0;
  const pendente = meses.at(-1)?.acumulaProximo ?? 0;

  function baixarRelatorio() {
    if (!ano) return;
    const L = (c: (string | number)[]) => c.map((x) => (typeof x === "number" ? x.toFixed(2).replace(".", ",") : `"${String(x).replace(/"/g, '""')}"`)).join(";");
    const linhas = [
      `"Relatório de IR – FIIs – ano-calendário ${ano}"`, "",
      '"BENS E DIREITOS (grupo 07, código 03)"', L(["Fundo", "CNPJ", `Situação em 31/12/${ano - 1}`, `Situação em 31/12/${ano}`, "Discriminação"]),
      ...bens.map((b) => L([b.ticker, b.cnpj ?? "", b.custoAnterior, b.custo, b.discriminacao])), "",
      '"RENDIMENTOS ISENTOS (FII)"', L(["Fundo", "CNPJ", "Nome", "Valor"]),
      ...isentos.map((r) => L([r.ticker, r.cnpj ?? "", r.nome, r.valor])), "",
      '"RENDA VARIÁVEL – FUNDOS DE INVESTIMENTO IMOBILIÁRIO"', L(["Mês", "Resultado líquido", "Prejuízo a compensar", "Imposto devido", "IRRF", "Imposto pago"]),
      ...ficha.map((f) => L([mesExtenso(f.mes), f.resultado, f.prejuizoACompensar ?? 0, f.impostoDevido, f.irrf, f.impostoPago])),
    ];
    baixar(`ir-fiis-${ano}.csv`, "﻿" + linhas.join("\r\n") + "\r\n");
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Imposto de Renda</h1>
          <p>DARF das vendas e dados para a declaração anual, calculados com as operações da sua carteira.</p>
        </div>
        <div className="head-acoes"><Link className="btn" to="/carteira">← Minha carteira</Link></div>
      </div>
      {erro && <p className="auth-erro">Não foi possível carregar a carteira: {erro}</p>}

      {proximos.map((m) => (
        <div key={m.mes} className="warn-box ir-alerta">
          <b>DARF de {brl(m.aPagar)}</b> pelas vendas de {mesExtenso(m.mes)}: código {CODIGO_DARF}, vencimento{" "}
          <b>{data(m.vencimento)}</b>{m.vencimento! < hoje ? " (já venceu: pague com multa e juros pelo Sicalc)" : ""}.
        </div>
      ))}

      <section className="card">
        <div className="chart-title">Vendas e DARF</div>
        <div className="chart-sub">
          Lucro na venda de cotas de FII paga {ALIQUOTA_FII * 100}% (não existe a isenção de R$ 20 mil das ações). A apuração é
          mensal; prejuízo de um mês abate o lucro dos meses seguintes. A corretora já retém 0,005% do valor vendido
          (o "dedo-duro"), que é descontado do imposto.
        </div>
        {!meses.length ? <p className="carteira-vazia-txt">Nenhuma venda lançada: não há imposto a pagar sobre vendas.</p> : (
          <>
            <div className="calc-kpis rend-kpis">
              <div><span>Prejuízo para compensar</span><b className="num">{brl(prejuizoAtual)}</b><i>abate lucros de vendas futuras</i></div>
              <div><span>DARF abaixo de R$ {DARF_MINIMO} acumulado</span><b className="num">{brl(pendente)}</b><i>soma ao próximo DARF</i></div>
              <div><span>DARFs já gerados</span><b className="num">{brl(meses.reduce((s, m) => s + m.aPagar, 0))}</b><i>{meses.filter((m) => m.aPagar).length} mês(es)</i></div>
            </div>
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="calc-tabela tabela-ir">
                <thead><tr>
                  <th>Mês da venda</th><th className="r">Vendido</th><th className="r">Resultado</th><th className="r">Prejuízo usado</th>
                  <th className="r">Base</th><th className="r">IR {ALIQUOTA_FII * 100}%</th><th className="r">IRRF abatido</th>
                  <th className="r">DARF</th><th>Vencimento</th>
                </tr></thead>
                <tbody>
                  {[...meses].reverse().map((m) => (
                    <tr key={m.mes}>
                      <td>{mesExtenso(m.mes)}</td>
                      <td className="r num">{brl(m.vendido)}</td>
                      <td className="r num"><span className={cls(m.lucro)}>{resultadoTxt(m.lucro)}</span></td>
                      <td className="r num">{m.prejuizoCompensado ? brl(m.prejuizoCompensado) : "—"}</td>
                      <td className="r num">{brl(m.base)}</td>
                      <td className="r num">{brl(m.impostoDevido)}</td>
                      <td className="r num">{m.irrfUsado ? brl(m.irrfUsado) : "—"}</td>
                      <td className="r num">{m.aPagar ? <b>{brl(m.aPagar)}</b> : m.acumulaProximo > 0 ? <span className="sub-name">{brl(m.acumulaProximo)} acumula</span> : "—"}</td>
                      <td className="num">{m.vencimento ? data(m.vencimento) : m.lucro < 0 ? "prejuízo" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="calc-formulas">
              <summary>Vendas, uma a uma ({vendas.length})</summary>
              <div className="table-wrap" style={{ border: 0 }}>
                <table className="calc-tabela tabela-ir">
                  <thead><tr><th>Data</th><th>Fundo</th><th className="r">Cotas</th><th className="r">Preço de venda</th><th className="r">Preço médio</th><th className="r">Resultado</th></tr></thead>
                  <tbody>
                    {[...vendas].reverse().map((v, i) => (
                      <tr key={i}>
                        <td className="num">{data(v.data)}</td><td className="mono">{v.ticker}</td><td className="r num">{inteiro(v.quantidade)}</td>
                        <td className="r num">{brl(v.preco)}</td><td className="r num">{brl(v.precoMedio)}</td>
                        <td className="r num"><span className={cls(v.lucro)}>{resultadoTxt(v.lucro)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <details className="calc-formulas">
              <summary>Como pagar o DARF</summary>
              <ul>
                <li>Gere no <b>Sicalc Web</b> da Receita (ou no app Receita Federal) com o código <b>{CODIGO_DARF}</b>; período de
                  apuração = o último dia do mês da venda.</li>
                <li>Vence no último dia útil do mês seguinte ao da venda. Depois disso o Sicalc já calcula multa e juros.</li>
                <li>Valor abaixo de R$ {DARF_MINIMO} não se paga: soma ao DARF do próximo mês com imposto.</li>
                <li>Sobra de IRRF que não abateu imposto no ano entra na declaração, na ficha de Renda Variável.</li>
              </ul>
            </details>
          </>
        )}
      </section>

      {anos.length > 0 && ano && (
        <section className="card">
          <div className="checklist-head">
            <div>
              <div className="chart-title">Declaração anual</div>
              <div className="chart-sub">O que vai no programa do IRPF para os seus FIIs.</div>
            </div>
            <div className="head-acoes">
              <select value={ano} onChange={(e) => setAno(Number(e.target.value))} aria-label="Ano-calendário">
                {anos.map((a) => <option key={a} value={a}>Ano-calendário {a}</option>)}
              </select>
              <button className="btn" onClick={baixarRelatorio}>Baixar relatório</button>
            </div>
          </div>

          <h3 className="ir-sec">1. Bens e Direitos <span className="sub-name">grupo {BENS_GRUPO} (Fundos) · código {BENS_CODIGO} (Fundos Imobiliários – FII)</span></h3>
          <p className="calc-dica">Um item por fundo. O valor é o <b>custo de compra</b> (cotas × preço médio), não o valor de mercado.</p>
          {!bens.length ? <p className="carteira-vazia-txt">Nenhum fundo na carteira em 31/12/{ano - 1} nem em 31/12/{ano}.</p> : (
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="calc-tabela tabela-ir">
                <thead><tr><th>Fundo</th><th>CNPJ</th><th className="r">31/12/{ano - 1}</th><th className="r">31/12/{ano}</th><th>Discriminação</th></tr></thead>
                <tbody>
                  {bens.map((b) => (
                    <tr key={b.ticker}>
                      <td><span className="mono" style={{ fontWeight: 600 }}>{b.ticker}</span><span className="sub-name">{b.nome}</span></td>
                      <td className="num">{b.cnpj ?? <span className="sub-name">não encontrado: veja no informe da corretora</span>} {b.cnpj && <Copiar texto={b.cnpj} />}</td>
                      <td className="r num">{brl(b.custoAnterior)}<span className="sub-name">{inteiro(b.quantidadeAnterior)} cotas</span></td>
                      <td className="r num"><b>{brl(b.custo)}</b><span className="sub-name">{inteiro(b.quantidade)} cotas</span></td>
                      <td className="ir-discr">{b.discriminacao} <Copiar texto={b.discriminacao} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="ir-sec">2. Rendimentos isentos e não tributáveis <span className="sub-name">rendimentos de FII · um lançamento por fundo, com o CNPJ</span></h3>
          {proventos == null ? <p className="state">Carregando os rendimentos…</p> : !isentos.length ? (
            <p className="carteira-vazia-txt">Nenhum rendimento com data-ex em {ano}.</p>
          ) : (
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="calc-tabela tabela-ir">
                <thead><tr><th>Fundo</th><th>CNPJ</th><th className="r">Valor recebido em {ano}</th></tr></thead>
                <tbody>
                  {isentos.map((r) => (
                    <tr key={r.ticker}>
                      <td><span className="mono" style={{ fontWeight: 600 }}>{r.ticker}</span><span className="sub-name">{r.nome}</span></td>
                      <td className="num">{r.cnpj ?? "—"} {r.cnpj && <Copiar texto={r.cnpj} />}</td>
                      <td className="r num">{brl(r.valor)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td><b>Total</b></td><td /><td className="r num"><b>{brl(isentos.reduce((s, r) => s + r.valor, 0))}</b></td></tr></tfoot>
              </table>
            </div>
          )}
          <p className="calc-dica">
            Calculado pela data-ex. Na declaração vale a data de pagamento: um rendimento com data-ex no fim de dezembro e
            pago em janeiro entra no ano seguinte. O informe de rendimentos da corretora é o documento oficial.
          </p>

          <h3 className="ir-sec">3. Renda variável: fundos de investimento imobiliário <span className="sub-name">ficha mensal, só se houve vendas</span></h3>
          {!ficha.some((f) => f.resultado || f.impostoPago) ? (
            <p className="carteira-vazia-txt">Nenhuma venda em {ano}: essa ficha fica em branco.</p>
          ) : (
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="calc-tabela tabela-ir">
                <thead><tr><th>Mês</th><th className="r">Resultado líquido</th><th className="r">Prejuízo a compensar</th><th className="r">Imposto devido</th><th className="r">IRRF</th><th className="r">Imposto pago</th></tr></thead>
                <tbody>
                  {ficha.map((f) => (
                    <tr key={f.mes} className={f.resultado ? "" : "ir-vazio"}>
                      <td>{MESES[Number(f.mes.slice(5, 7)) - 1]}</td>
                      <td className="r num"><span className={cls(f.resultado)}>{resultadoTxt(f.resultado)}</span></td>
                      <td className="r num">{f.prejuizoACompensar != null ? brl(f.prejuizoACompensar) : "—"}</td>
                      <td className="r num">{brl(f.impostoDevido)}</td>
                      <td className="r num">{brl(f.irrf)}</td>
                      <td className="r num">{brl(f.impostoPago)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <p className="aviso-triagem">
        Regra geral para pessoa física, com operações comuns (sem day trade) e sem custos de corretagem. Não é
        consultoria tributária: confira com o informe da sua corretora e, na dúvida, com um contador.
      </p>
    </>
  );
}
