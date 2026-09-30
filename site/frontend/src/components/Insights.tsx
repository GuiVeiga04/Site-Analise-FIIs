import type { FundoSnapshot } from "../api/types";
import { compacto, pct } from "../lib/format";

/**
 * "Leituras automáticas" — resumo em texto do que os números da seleção
 * atual mostram (equivalente ao cartão de mesmo nome do painel original).
 * Recalcula a cada mudança de filtro, então descreve sempre o que está
 * na tela, não o grupo inteiro.
 */
export function Insights({ fundos }: { fundos: FundoSnapshot[] }) {
  if (fundos.length < 2) return null;

  const porLiquidez = [...fundos].sort(
    (a, b) => (b.volume_financeiro_medio ?? 0) - (a.volume_financeiro_medio ?? 0),
  );
  const lider = porLiquidez[0];
  const menosLiquido = porLiquidez[porLiquidez.length - 1];

  const porTipo = new Map<string, number>();
  fundos.forEach((f) => {
    const t = f.tipo_gestao ?? "—";
    porTipo.set(t, (porTipo.get(t) ?? 0) + 1);
  });
  const tipoTop = [...porTipo.entries()].sort((a, b) => b[1] - a[1])[0];

  const comVariacao = fundos
    .filter((f): f is FundoSnapshot & { variacao_periodo_pct: number } => f.variacao_periodo_pct != null)
    .sort((a, b) => b.variacao_periodo_pct - a.variacao_periodo_pct);
  const maiorAlta = comVariacao[0];
  const maiorQueda = comVariacao[comVariacao.length - 1];

  const sinais = { verde: 0, amarelo: 0, vermelho: 0, cinza: 0 };
  fundos.forEach((f) => {
    sinais[f.checklist_sinal] = (sinais[f.checklist_sinal] ?? 0) + 1;
  });
  const totalSinal = sinais.verde + sinais.amarelo + sinais.vermelho + sinais.cinza;

  const itens: JSX.Element[] = [];

  if (lider && menosLiquido && lider.ticker !== menosLiquido.ticker && menosLiquido.volume_financeiro_medio) {
    const mult = (lider.volume_financeiro_medio ?? 0) / menosLiquido.volume_financeiro_medio;
    itens.push(
      <li key="liq">
        <b>{lider.ticker}</b> ({lider.nome}) lidera a liquidez da seleção, com {compacto(lider.volume_financeiro_medio)}{" "}
        negociados em média por pregão — {mult.toFixed(0)}x mais que o fundo menos líquido dela.
      </li>,
    );
  }

  if (tipoTop) {
    itens.push(
      <li key="tipo">
        <b>{tipoTop[0]}</b> é o perfil predominante: {tipoTop[1]} dos {fundos.length} fundos.
      </li>,
    );
  }

  if (maiorAlta && maiorQueda && maiorAlta.ticker !== maiorQueda.ticker) {
    itens.push(
      <li key="var">
        Maior alta do período: <b>{maiorAlta.ticker}</b> ({pct(maiorAlta.variacao_periodo_pct)}). Maior queda:{" "}
        <b>{maiorQueda.ticker}</b> ({pct(maiorQueda.variacao_periodo_pct)}).
      </li>,
    );
  }

  if (totalSinal > 0) {
    itens.push(
      <li key="check">
        Checklist de triagem: <b>{sinais.verde} verdes</b>, {sinais.amarelo} amarelos e {sinais.vermelho} vermelhos
        {sinais.cinza ? ` (${sinais.cinza} com poucos dados)` : ""}.
      </li>,
    );
  }

  if (!itens.length) return null;

  return (
    <section className="insights" aria-label="Leituras automáticas">
      <h2>Leituras automáticas desta seleção</h2>
      <ul>{itens}</ul>
    </section>
  );
}
