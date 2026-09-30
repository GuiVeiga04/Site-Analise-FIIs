# Blueprint do Power BI — Painel de FIIs

Guia prático para montar no Power BI Desktop o mesmo painel do protótipo (`mockup_powerbi.html`), usando a mesma lógica já validada em Python (`fiis_common.py` / `gerar_dados_site.py`). Depois de montado uma vez, seu fluxo de trabalho semanal vira: rodar `atualizador_fiis.py` → abrir o `.pbix` → **Atualizar** → publicar.

## 1. Fontes de dados

Duas opções, dá pra usar as duas juntas:

- **`base_fiis_historico.csv`** — direto, via Power Query. Mais simples, mas exige repetir no M a limpeza de preço que já fizemos em Python (passos abaixo).
- **Pasta `data/*.json`** (gerada por `gerar_dados_site.py`) — já vem limpa, com variação, volume financeiro e classificação de liquidez prontos. Menos trabalho no Power Query, mas você perde a granularidade de linha-a-linha do histórico bruto (fica com um snapshot por fundo, não uma linha por pregão). Recomendo importar **as duas**: o CSV como tabela fato para os gráficos de série temporal, e o `config.json`/`fiis_config.json` como tabela de dimensão (classificação).

## 2. Power Query — corrigir a coluna de preço na importação

No editor avançado (Power Query → Editar Consultas → Editor Avançado), a query da tabela `FIIsHistorico` deve ter uma etapa assim:

```m
let
    Origem = Csv.Document(
        File.Contents("C:\Users\LeãoLog -\Documents\Base FIIs\base_fiis_historico.csv"),
        [Delimiter=";", Columns=6, Encoding=65001, QuoteStyle=QuoteStyle.None]
    ),
    CabecalhosPromovidos = Table.PromoteHeaders(Origem, [PromoteAllScalars=true]),

    // Função local: entende tanto "R$ 89,26" (formato antigo, com bug)
    // quanto "89.26" já limpo (formato novo, a partir do atualizador_fiis.py corrigido)
    LimparPreco = (valor as any) as nullable number =>
        let
            texto = Text.Trim(Text.Replace(Text.From(valor), "R$", "")),
            normalizado = if Text.Contains(texto, ",")
                then Text.Replace(Text.Replace(texto, ".", ""), ",", ".")
                else texto,
            // "en-US" trava o ponto como separador decimal, independente
            // da configuração regional do Windows/Power BI — sem isso, em
            // máquina configurada como pt-BR, Number.FromText("89.26")
            // trata o "." como separador de milhar e descarta ele,
            // devolvendo 8926 em vez de 89.26 (todos os preços x100)
            resultado = try Number.FromText(normalizado, "en-US") otherwise null
        in
            resultado,

    PrecoLimpo = Table.TransformColumns(CabecalhosPromovidos,
        {{"Preco_Fechamento_R$", each LimparPreco(_), type nullable number}}),

    // "en-US" aqui evita o mesmo tipo de bug de locale do preço, só que
    // na data: o atualizador_fiis.py reescreve o CSV inteiro a cada
    // execução e grava as datas em formato ISO ("2026-09-16"). Sem
    // cultura explícita, a conversão de texto->data usa o idioma do
    // Power BI/Windows (pt-BR), que espera dd/mm/aaaa e não reconhece
    // "2026-09-16" como data válida — isso quebra a coluna inteira
    // (todo mundo vira erro/nulo), fazendo MIN e MAX de Data_Pregao
    // devolverem o mesmo valor para qualquer fundo e a variação
    // aparecer sempre como 0,00%, independente do ticker selecionado.
    TiposCorrigidos = Table.TransformColumnTypes(PrecoLimpo, {
        {"Data_Coleta", type date}, {"Data_Pregao", type date},
        {"Ticker", type text}, {"Nome_Fundo", type text},
        {"Volume_Ultimo_Dia", Int64.Type}
    }, "en-US"),

    // Deduplica por (Ticker, Data_Pregao), mantendo a coleta mais recente —
    // mesmo problema de pregão repetido que corrigimos no Python.
    // Nota: Table.Last(_) devolveria um Record (a linha), não uma Table —
    // por isso ordenamos decrescente e pegamos as primeiras N=1 linhas,
    // que o Table.Group já entrega como Table de 1 linha.
    Ordenado = Table.Sort(TiposCorrigidos, {{"Data_Coleta", Order.Ascending}}),
    Agrupado = Table.Group(Ordenado, {"Ticker", "Data_Pregao"},
        {{"Ultima", each Table.FirstN(Table.Sort(_, {{"Data_Coleta", Order.Descending}}), 1), type table}}),
    SemDuplicatas = Table.ExpandTableColumn(Agrupado, "Ultima",
        {"Data_Coleta", "Nome_Fundo", "Preco_Fechamento_R$", "Volume_Ultimo_Dia"})
in
    SemDuplicatas
```

Ajuste o caminho do `File.Contents` se necessário — se o arquivo já estiver conectado no Power BI, cole apenas a parte de `LimparPreco` em diante como novas etapas.

Para a tabela de classificação, importe `fiis_config.json` (**Obter Dados → JSON**), expanda a lista `fundos` — vira uma tabela com `ticker`, `nome`, `gestora`, `tipo_gestao`, `segmento`.

## 3. Modelo de dados

```
FIIsConfig[ticker]  1 ──── * FIIsHistorico[Ticker]
```

Relacionamento simples (1 fundo → várias linhas de histórico), direção única, `ticker` como chave. Marque `FIIsHistorico` como tabela de fatos (Data_Pregao como coluna de datas, se for criar uma tabela calendário depois).

## 4. Medidas DAX

Todas as medidas ficam em um arquivo separado: **`medidas_dax.dax`** — são 30 medidas, comentadas, com o formato de exibição sugerido em cada uma, organizadas em 8 blocos:

| Bloco | Medidas |
|---|---|
| 1. Base e contagens | Último Pregão, Primeiro Pregão, Qtde Pregões, Fundos Monitorados |
| 2. Preço | Preço Atual, Preço no Primeiro Pregão, Preço Mínimo/Máximo Período, Amplitude Período % |
| 3. Variação | Variação Período %, Variação Dia % |
| 4. Liquidez | Volume Financeiro, Volume Financeiro Médio por Pregão, Volume Cotas Médio por Pregão, Liquidez Total do Grupo |
| 5. Classificação e ranking | P33/P66 Liquidez, Classificação de Liquidez, Ranking de Liquidez |
| 6. Cartões (nível grupo) | Concentração Top 5 %, Variação Média do Período, Fundos em Alta/Baixa/Estáveis, Fundo Mais Líquido, Maior Alta/Queda do Período |
| 7. Risco | Volatilidade Retorno Diário % |
| 8. Formatação condicional | Cor Variação, Cor Liquidez |

Elas reproduzem a mesma lógica de `gerar_dados_site.py`, então os números do Power BI batem com os do painel HTML e dos JSONs.

Sugestão: crie uma tabela vazia chamada `_Medidas` (Página Inicial → Inserir Dados) para guardá-las e manter o painel de campos organizado.

## 5. Layout das páginas (detalhado)

Referência visual: `mockup_powerbi.html`. Os nomes de visual abaixo são os que aparecem no painel **Visualizações** do Power BI Desktop (ícones no topo do painel, ao lado do painel de Campos). "Poço de campo" = as caixas onde você arrasta os campos dentro de cada visual (Eixo X, Legenda, Valores etc.).

> ⚠️ **Antes de montar os slicers:** `Classificação de Liquidez` é uma **medida**, e o Power BI não permite usar medida como campo de Segmentação de Dados — só aceita colunas. Duas saídas:
> - **Mais simples (recomendado pra começar):** monte só os slicers de `Tipo_Gestao` e `Segmento` (que são colunas de `FIIsConfig`, funcionam direto). Deixe a liquidez só como cor/tag na tabela — sem filtro dedicado por enquanto.
> - **Se quiser mesmo assim o slicer de liquidez:** precisa criar uma **coluna calculada** (não medida) em `FIIsConfig` com a mesma lógica de tercil, fixa (sem reagir a outros slicers). Se quiser, eu monto essa coluna depois — é mais coisa de DAX e prefiro não empilhar em cima do que você já está ajustando.

### Página 1 — Visão Geral

Canvas padrão 16:9. De cima para baixo:

**1. Faixa de slicers** (topo, ~50px de altura)
- **Segmentação de Dados** nº1 → campo `FIIsConfig[tipo_gestao]`. Em Formatar visual → Configurações de segmentação → Estilo, escolha "Bloco" (fica em botões lado a lado, como no protótipo) e Orientação "Horizontal".
- **Segmentação de Dados** nº2 → campo `FIIsConfig[segmento]`. Estilo "Lista suspensa" (são ~15 valores, botão ocuparia muito espaço).

**2. Linha de 4 cartões** (visual **Cartão**, um pra cada)
| Cartão | Campo no poço "Dados" |
|---|---|
| Fundos monitorados | medida `[Fundos Monitorados]` |
| Liquidez total do grupo | medida `[Liquidez Total do Grupo]` |
| Variação média do período | medida `[Variação Média do Período]` |
| Concentração Top 5 | medida `[Concentração Top 5 %]` |

Dica: em Formatar visual → Rótulo de categoria, digite o texto de baixo do número (ex: "Fundos monitorados") já que por padrão ele usa o nome técnico da medida.

**3. Duas colunas lado a lado**

*Esquerda — visual **Gráfico de Colunas Agrupadas***
- Eixo X → `FIIsConfig[tipo_gestao]`
- Valores → medida `[Liquidez Total do Grupo]`
- Em Formatar visual → Rótulos de dados → Ativar (mostra o valor em cima de cada coluna, como no protótipo)
- Cor das colunas: Formatar visual → Colunas → Formatação condicional por `tipo_gestao` (ou deixe uma cor só — funciona, só não fica idêntico ao mockup)

*Direita — visual **Gráfico de Barras Agrupadas*** (horizontal)
- Eixo Y → `FIIsConfig[ticker]`
- Valores → medida `[Volume Financeiro Médio por Pregão]`
- Painel Filtros → arraste `[Ranking de Liquidez]` → tipo "Top N" → Top **15**, por essa mesma medida (ou: clique nos "..." do visual → Ordenar por → Volume Financeiro Médio por Pregão, decrescente, e use um filtro Top N direto no campo)
- Formatar visual → Eixo Y → Ordenar → do maior pro menor

**4. Dispersão liquidez × variação** (linha cheia, visual **Gráfico de Dispersão**)
- Detalhes → `FIIsConfig[ticker]`
- Valores de X → medida `[Volume Financeiro Médio por Pregão]`
- Valores de Y → medida `[Variação Período %]`
- Legenda → `FIIsConfig[tipo_gestao]`
- Escala log no eixo X: Formatar visual → Eixo X → procure a opção de escala/tipo. Nem toda versão do Power BI Desktop expõe escala logarítmica nativa pro gráfico de dispersão — se não aparecer essa opção na sua versão, crie uma coluna calculada `Log10 Liquidez = LOG10 ( [Volume Financeiro Médio por Pregão] )` em `FIIsConfig` (ou uma medida equivalente) e use ela no eixo X em vez da medida original; sem log, os pontos ficam todos espremidos à esquerda porque a liquidez varia em ordens de grandeza entre os fundos.

**5. Tabela completa** (linha cheia, visual **Tabela** ou **Matriz** — Tabela é mais simples aqui)
- Colunas, nesta ordem: `FIIsConfig[ticker]`, `FIIsConfig[nome]`, `FIIsConfig[tipo_gestao]`, `FIIsConfig[segmento]`, medida `[Preço Atual]`, medida `[Variação Período %]`, medida `[Volume Financeiro Médio por Pregão]`, medida `[Classificação de Liquidez]`
- Formatação condicional na coluna de variação: selecione a coluna → botão direito não funciona aqui, é pelo painel Formatar visual → Formatação condicional → Cor da fonte → Formatar por "Regras" ou "Valores de campo" apontando pra medida `[Cor Variação]` (a que já devolve o hexadecimal verde/vermelho)
- Mesma coisa na coluna de classificação, apontando pra `[Cor Liquidez]`
- Ordenar por padrão: clique no cabeçalho de "Volume Financeiro Médio por Pregão" uma vez (decrescente)

### Página 2 — Detalhe por Fundo

**1. Slicer de Ticker** (topo) — Segmentação de Dados, campo `FIIsConfig[ticker]`, estilo Lista suspensa, "Seleção única" ativada (Formatar visual → Seleção → Seleção única) pra sempre ter só 1 fundo selecionado.

**2. 3 cartões**: `[Preço Atual]`, `[Variação Período %]`, `[Classificação de Liquidez]` — mesmos passos da página 1.

**3. Gráfico de linha** (visual **Gráfico de Linhas**)
- Eixo X → `FIIsHistorico[Data_Pregao]`
- Valores → `FIIsHistorico[Preco_Fechamento_R$]` (soma — como só há 1 fundo selecionado pelo slicer, a soma equivale ao valor da linha)
- Com só 2 pregões coletados a linha vai ficar curta; ela cresce sozinha a cada `atualizador_fiis.py` rodado, não precisa mexer em nada depois.

### Página 3 — Metodologia (opcional, mas recomendado)

- Insira uma ou mais **Caixas de Texto** (Inserir → Caixa de Texto) reaproveitando os textos do painel HTML: o que é volume financeiro vs. quantidade de cotas, como a classificação de liquidez é calculada (tercis), o que Papel/Tijolo/Híbrido/FoF significam, e o aviso de que a variação é só de preço (não inclui dividendos). Copiar do glossário do `dashboard.html` já publicado é o caminho mais rápido — o texto já está pronto lá.

## 6. Publicar

Depois de montado: **Arquivo → Publicar → Power BI Service** (workspace da sua conta). Para manter atualizado sem abrir o Desktop toda semana, dá para configurar um **gateway de dados** apontando para a pasta local, com atualização agendada — mas isso só funciona se o computador ficar ligado no horário agendado, ou se os arquivos estiverem num local que o serviço alcance (OneDrive/SharePoint sincronizado costuma ser o caminho mais simples nesse caso).
