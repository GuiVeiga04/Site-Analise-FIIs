import { useMemo } from "react";
import { api } from "../api/client";
import { BarraFiltros, FiltroSinal, useFiltros } from "../components/Filtros";
import { DispersaoDYPVP, DispersaoLiquidez, LiquidezPorTipo, RankingDY, RankingLiquidez } from "../components/Graficos";
import { Insights } from "../components/Insights";
import { TabelaFundos } from "../components/TabelaFundos";
import { Estado, KpiCard } from "../components/ui";
import { kpis } from "../lib/agregados";
import { compacto, data, inteiro, mult, pct, taxa } from "../lib/format";
import { useAsync } from "../lib/useAsync";

export default function VisaoGeral() {
  const meta = useAsync(api.meta, []);
  const snap = useAsync(api.snapshot, []);
  const f = useFiltros();

  // Filtros de tipo/segmento/busca primeiro; o de sinal por último, para que a
  // contagem dos chips do checklist mostre quantos há de cada cor na seleção.
  const semSinal = useMemo(() => {
    const q = f.busca.toLowerCase();
    return (snap.data ?? []).filter((x) =>
      (!f.tipos.length || f.tipos.includes(x.tipo_gestao ?? "")) &&
      (!f.segmento || x.segmento === f.segmento) &&
      (!q || x.ticker.toLowerCase().includes(q) || x.nome.toLowerCase().includes(q)));
  }, [snap.data, f.tipos, f.segmento, f.busca]);
  const filtrados = useMemo(
    () => semSinal.filter((x) => !f.sinais.length || f.sinais.includes(x.checklist_sinal)),
    [semSinal, f.sinais]);
  const contagemSinal = useMemo(() => {
    const c: Record<string, number> = {};
    semSinal.forEach((x) => { c[x.checklist_sinal] = (c[x.checklist_sinal] ?? 0) + 1; });
    return c;
  }, [semSinal]);

  if (!snap.data || !meta.data) return <Estado loading={snap.loading || meta.loading} error={snap.error || meta.error} />;
  const k = kpis(filtrados);
  const cdi = meta.data.indicadores?.CDI_aa?.valor ?? null;
  const cdiLiquido = cdi != null ? cdi * 0.85 : null;
  const segmentos = [...new Set(snap.data.filter((x) => !f.tipos.length || f.tipos.includes(x.tipo_gestao ?? ""))
    .map((x) => x.segmento ?? ""))].filter(Boolean).sort();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Visão Geral</h1>
          <p>Renda, liquidez e variação de preço dos {meta.data.total_fundos} FIIs monitorados.</p>
        </div>
      </div>

      {meta.data.pregoes.length < 10 && (
        <div className="warn-box">
          Histórico ainda curto ({meta.data.pregoes.length} pregões coletados). Variação e volatilidade ganham
          significado a cada semana de coleta.
        </div>
      )}

      <BarraFiltros tiposDisponiveis={meta.data.tipos_gestao} segmentos={segmentos} f={f} />
      <FiltroSinal contagem={contagemSinal} f={f} />

      <section className="kpis kpis-3" aria-label="Indicadores">
        <KpiCard label="Fundos monitorados" value={inteiro(k.fundos)}
          sub={f.ativo ? `de ${meta.data.total_fundos} no total` : "em todos os perfis"} />
        <KpiCard label="DY 12m mediano" value={taxa(k.dyMediano)}
          sub={k.comDividendos
            ? <>{k.comDividendos} fundos com rendimentos{cdiLiquido != null && <> · CDI líquido de IR {taxa(cdiLiquido)}</>}<br />último em {data(meta.data.ultimo_dividendo_registrado)}</>
            : "sem rendimentos coletados"} />
        <KpiCard label="P/VP mediano" value={mult(k.pvpMediano)}
          sub={k.comPvp ? `${k.abaixoVp} de ${k.comPvp} fundos abaixo do valor patrimonial` : "sem P/VP coletado"} />
        <KpiCard label="Liquidez total do grupo" value={compacto(k.liquidezTotal)} sub="soma do volume financeiro médio/pregão" />
        <KpiCard label="Variação média do período" value={pct(k.variacaoMedia)}
          sub={`${k.altas} em alta · ${k.baixas} em baixa · ${k.estaveis} estáveis`} />
        <KpiCard label="Concentração top 5" value={k.concentracaoTop5 == null ? "—" : `${k.concentracaoTop5.toFixed(0)}%`}
          sub="da liquidez nos 5 mais negociados" />
      </section>

      <Insights fundos={filtrados} />

      <section className="grid-2">
        <LiquidezPorTipo fundos={filtrados} />
        <RankingLiquidez fundos={filtrados} />
      </section>

      <section className="grid-2 grid-2-even">
        <RankingDY fundos={filtrados} />
        <DispersaoDYPVP fundos={filtrados} cdiLiquido={cdiLiquido} />
      </section>

      <section><DispersaoLiquidez fundos={filtrados} /></section>

      <section>
        <h2>Todos os fundos</h2>
        <p className="note">Clique nos cabeçalhos para ordenar e numa linha para abrir o detalhe do fundo.
          A classificação de liquidez é relativa ao grupo inteiro (tercis) e não muda com os filtros. A coluna
          Checklist mostra o sinal e a nota de 0 a 100 da triagem (veja a página do fundo e a Metodologia).</p>
        <TabelaFundos fundos={filtrados} />
      </section>
    </>
  );
}
