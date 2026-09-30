export default function Metodologia() {
  return (
    <div className="prose">
      <div className="page-head"><div><h1>Como ler este painel</h1></div></div>
      <h2>Volume financeiro × quantidade de cotas</h2>
      <p>O coletor grava a quantidade de cotas negociadas em cada pregão. Como cada fundo tem um valor de cota
        diferente (MXRF11 ≈ R$ 9, KNRI11 ≈ R$ 157), comparar quantidade de cotas é enganoso. Por isso a
        liquidez aqui é o <b>volume financeiro</b>: preço × cotas negociadas.</p>
      <h2>Classificação de liquidez</h2>
      <p>Cada fundo é comparado com os demais fundos monitorados: o terço mais líquido é <b>Alta</b>, o do meio
        <b> Média</b> e o menos líquido <b>Baixa</b>. É uma régua relativa a esta carteira, não ao mercado todo.</p>
      <h2>Papel, Tijolo, Híbrido e FoF</h2>
      <p><b>Tijolo</b> é dono de imóveis e vive de aluguel. <b>Papel</b> investe em CRIs e é mais sensível a
        CDI/IPCA e a risco de crédito. <b>Híbrido</b> mistura as duas estratégias. <b>FoF</b> investe em cotas de
        outros FIIs.</p>
      <h2>Dividend yield (DY)</h2>
      <p><b>DY 12m</b> é a soma dos rendimentos com data-ex nos últimos 12 meses dividida pelo preço atual da cota.
        <b> DY do mês</b> é só o último rendimento dividido pelo preço atual. Os dois usam o último pregão como
        referência, então sobem quando o preço cai (sem o fundo pagar mais).</p>
      <p>A comparação com <b>os pares</b> usa a mediana do DY 12m do mesmo segmento. Quando o segmento tem menos de
        3 fundos na carteira, a régua passa a ser o tipo de gestão (Papel, Tijolo...).</p>
      <h2>Data-ex e data-com</h2>
      <p>O Yahoo Finance registra a <b>data-ex</b>, o primeiro pregão em que a cota já é negociada sem direito ao
        rendimento. A <b>data-com</b> é o pregão anterior: quem tinha a cota no fechamento desse dia recebe.</p>
      <h2>Estabilidade e tendência da renda</h2>
      <ul>
        <li><b>Tendência</b>: média dos 3 últimos pagamentos comparada com a média dos 12 meses. Negativa = renda
          caindo. Aparece só com pelo menos 6 pagamentos no período.</li>
        <li><b>Variação dos pagamentos (CV)</b>: desvio padrão ÷ média dos pagamentos em 12 meses. Quanto menor,
          mais previsível. Fundos que pagam extras semestrais têm CV alto sem que isso seja ruim.</li>
        <li><b>Quedas</b>: quantas vezes, em 12 meses, um pagamento ficou abaixo de 90% da mediana dos 6
          anteriores. Um corte que se mantém por vários meses conta como uma queda só.</li>
      </ul>
      <h2>Retorno total</h2>
      <p>As variações da Visão Geral consideram só o preço. O <b>retorno total 12m</b> soma os rendimentos
        recebidos: (preço atual + rendimentos dos 12 meses) ÷ preço de 12 meses atrás − 1. Não considera
        reinvestimento nem impostos, e só aparece quando há 12 meses de cotações.</p>
      <h2>P/VP e valor patrimonial</h2>
      <p><b>P/VP</b> é o preço da cota dividido pelo valor patrimonial por cota (VP). Abaixo de 1, o mercado paga
        menos do que o patrimônio contábil do fundo. Isso pode ser oportunidade ou sinal de desconfiança (imóveis
        reavaliados para cima, CRIs com risco), então vale olhar junto com a evolução do VP.</p>
      <p>O VP vem do <b>informe mensal entregue à CVM</b>, que tem um ou dois meses de defasagem. O preço é o do
        último pregão. Quando o fundo não aparece na CVM, o P/VP pronto do Fundamentus entra como reserva e a
        página do fundo indica a fonte. <b>VP por cota em 12 meses</b> negativo e persistente costuma indicar
        reavaliação negativa de imóveis ou perdas na carteira de crédito.</p>
      <h2>DY contra juros e inflação</h2>
      <p>O rendimento de FII é isento de IR para pessoa física. A renda fixa não é. Por isso a régua é o
        <b> CDI líquido</b>, CDI × (1 − 15%), a alíquota de aplicações acima de 2 anos. <b>DY real</b> é o DY 12m
        descontado o IPCA acumulado em 12 meses. CDI, Selic e IPCA vêm da API do Banco Central (SGS).</p>
      <h2>Vacância e cap rate</h2>
      <p>Só para fundos com imóveis, e só quando a coleta no Fundamentus funciona (é opcional). <b>Vacância</b> é a
        parte da área sem inquilino. <b>Cap rate</b> é a renda anual de aluguel sobre o valor dos imóveis.</p>
      <h2>Checklist de triagem</h2>
      <p>Cada fundo passa por uma lista de critérios (DY contra os pares e contra o CDI, P/VP, evolução do VP,
        quedas e tendência da renda, regularidade, liquidez e vacância). Cada critério fica <b>verde</b>,
        <b> amarelo</b> ou <b>vermelho</b> conforme faixas definidas em <code>criterios_checklist.json</code>,
        que você pode editar.</p>
      <ul>
        <li><b>Nota</b> (0 a 100): média ponderada pelos pesos, com verde valendo 1, amarelo 0,5 e vermelho 0.
          Critérios sem dado ficam de fora da conta.</li>
        <li><b>Sinal geral</b>: verde com nota a partir de 85, vermelho abaixo de 60 ou quando um critério
          <i> eliminatório</i> (hoje, a liquidez) fica vermelho, amarelo no meio. Com menos de 60% do peso
          coberto por dados, o sinal fica cinza (poucos dados).</li>
        <li>Alguns critérios punem os dois extremos: P/VP abaixo de 0,7 e DY muito acima dos pares costumam
          indicar que o mercado vê um problema, não uma pechincha.</li>
      </ul>
      <p>O checklist é uma <b>triagem</b>: ajuda a decidir quais fundos estudar primeiro. Não substitui ler os
        relatórios gerenciais e não é recomendação de investimento.</p>
      <h2>Comparação e diagnóstico por IA</h2>
      <p>A página <b>Comparar</b> coloca dois fundos lado a lado. O ▲ marca o melhor valor apenas em indicadores
        em que "maior" ou "menor" é claramente melhor (liquidez, quedas de rendimento, retorno total...). DY e
        P/VP não recebem destaque, porque valor alto de DY ou baixo de P/VP pode ser sinal de risco.</p>
      <p>O <b>diagnóstico por IA</b> usa o Claude (Haiku 4.5 por padrão) para ler os números do painel e explicar
        o que eles sugerem: pontos fortes, pontos de atenção e o que conferir no relatório gerencial. A IA recebe
        só os dados que aparecem aqui e é instruída a não inventar informações nem recomendar compra ou venda.
        Rodando o site localmente, o texto é gerado na hora. No site publicado, cada fundo tem um diagnóstico
        gerado uma vez por dia, porque a chave da API não pode ficar exposta num site público.</p>
      <h2>Fonte</h2>
      <p>Cotações e rendimentos do Yahoo Finance (yfinance). Valor patrimonial, patrimônio líquido e cotistas do
        informe mensal da CVM (dados abertos). CDI e IPCA do Banco Central. Vacância e cap rate do Fundamentus. Classificação de gestão e segmento: elaboração
        própria a partir de informações públicas dos fundos. Os indicadores servem para triagem e não são
        recomendação de investimento.</p>
    </div>
  );
}
