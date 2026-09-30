# Site de FIIs

Réplica web do painel **Dash - FIIs.pbix** (páginas *Visão Geral* e *Detalhes por Fundos*),
com uma página extra de *Metodologia*.

```
Base FIIs/
├─ atualizador_fiis.py      coleta de cotações (Yahoo Finance) -> base_fiis_historico.csv
├─ coletar_dividendos.py    rendimentos por fundo (Yahoo Finance) -> base_fiis_dividendos.csv
├─ coletar_fundamentos.py   CVM (VP, PL, cotistas), Banco Central (CDI, IPCA), Fundamentus (vacância)
├─ testar_fontes.py         checa se Yahoo, CVM, Banco Central e Fundamentus respondem
├─ gerar_dados_site.py      métricas por fundo (fonte única da conta, usada também pela API)
├─ fiis_common.py           limpeza de preço/datas e deduplicação
├─ fiis_config.json         lista de fundos + tipo de gestão/segmento (+ cnpj opcional)
├─ criterios_checklist.json critérios do checklist de triagem (editável)
└─ site/
   ├─ deploy/               workflow do GitHub Actions (mover para .github/workflows/)
   ├─ backend/              FastAPI + SQLite
   │  ├─ app/ingest.py      CSV + config -> fiis.db
   │  ├─ app/metrics.py     lê o SQLite e reaproveita gerar_dados_site.py
   │  ├─ app/main.py        rotas /api/*
   │  ├─ scripts/exportar_estatico.py   /api/* -> JSON para o Pages
   │  └─ tests/
   └─ frontend/             Vite + React + TypeScript + Recharts
      └─ src/
         ├─ api/            contrato (types.ts) e cliente (modo api ou static)
         ├─ components/     cartões, filtros, gráficos, tabela
         └─ pages/          VisaoGeral, DetalheFundo, Metodologia
```

## Como os dados fluem

```
Yahoo Finance ─► atualizador_fiis.py   ─► base_fiis_historico.csv  ─┬─► Power BI (continua igual)
             └─► coletar_dividendos.py ─► base_fiis_dividendos.csv ─┴─► app/ingest.py ─► fiis.db ─► FastAPI /api/*
                                                                                                    │
                                                  GitHub Pages ◄─ JSON estático ◄─ exportar_estatico ┘
```

A API e os JSON estáticos têm **o mesmo formato**. O front escolhe a origem pela variável
`import.meta.env.DEV`: `api` no `npm run dev` e `static` no build de produção
(dá para forçar com a variável de ambiente `VITE_DATA_MODE=api|static`).

| API                              | JSON estático                  |
|----------------------------------|--------------------------------|
| `GET /api/meta`                  | `data/meta.json`               |
| `GET /api/snapshot`              | `data/snapshot.json`           |
| `GET /api/fundos/{ticker}/historico` | `data/historico/{TICKER}.json` |
| `GET /api/fundos/{ticker}/dividendos` | `data/dividendos/{TICKER}.json` |
| `GET /api/ia/status`, `POST /api/ia/diagnostico` | `data/ia/{TICKER}.json` (diário, só 1 fundo) |

## Rodando localmente (Windows / PowerShell)

Pré-requisitos: Python 3.11+ e Node 20+.

```powershell
# 1) Backend (a partir da pasta Base FIIs)
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r site\backend\requirements.txt

cd site\backend
python -m app.ingest                 # carrega o CSV no SQLite
python -m pytest -q                  # opcional
uvicorn app.main:app --reload        # http://127.0.0.1:8000/docs

# 2) Front-end (outro terminal)
cd site\frontend
npm install
npm run dev                          # http://localhost:5173
```

Depois de cada coleta (na pasta `Base FIIs`):

```powershell
python atualizador_fiis.py
python coletar_dividendos.py
python coletar_fundamentos.py
python gerar_dados_site.py
cd site\backend; python -m app.ingest
```

### Primeira vez com dividendos (uma vez só)

```powershell
python testar_fontes.py                    # confere as fontes e grava testar_fontes_resultado.txt
python atualizador_fiis.py --retroativo 1y # preenche 12 meses de cotações (retorno total 12m depende disso)
python coletar_dividendos.py               # baixa todo o histórico de rendimentos
python gerar_dados_site.py
```

A carga retroativa não sobrescreve os pregões que já tinham sido coletados.

### Métricas de renda

| Campo | Conta |
|---|---|
| `dy_12m_pct` | rendimentos com data-ex nos últimos 12 meses ÷ preço atual |
| `dy_ultimo_pct` | último rendimento ÷ preço atual |
| `ultimo_dividendo`, `data_ultimo_dividendo` | valor e data-ex do último rendimento |
| `tendencia_dividendo_pct` | média dos 3 últimos ÷ média 12m − 1 (mín. 6 pagamentos) |
| `estabilidade_cv_pct` | desvio padrão ÷ média dos pagamentos em 12m |
| `quedas_dividendo_12m` | episódios em que o pagamento ficou abaixo de 90% da mediana dos 6 anteriores |
| `retorno_total_12m_pct` | (preço atual + rendimentos 12m) ÷ preço de 12 meses atrás − 1 |
| `dy_12m_vs_pares_pp` | DY 12m − mediana do segmento (ou do tipo de gestão, se o segmento tiver < 3 fundos) |

### Fundamentos (fase 2)

`coletar_fundamentos.py` gera três CSVs, um por fonte. Se uma fonte falhar, o CSV anterior dela é mantido.

| CSV | Fonte | Conteúdo |
|---|---|---|
| `base_fiis_cvm.csv` | Informe mensal da CVM (ano atual + anterior) | PL, cotas, VP/cota, cotistas por mês |
| `base_indicadores.csv` | API SGS do Banco Central | CDI (4389), Selic meta (432), IPCA 12m (13522) |
| `base_fiis_fundamentus.csv` | Fundamentus (opcional) | vacância, cap rate, nº de imóveis, FFO yield |

O fundo é encontrado na CVM pelo ISIN (`BR` + 4 letras do ticker + `CTF`...). Se algum ticker aparecer no aviso
"sem ISIN correspondente", informe o CNPJ dele no `fiis_config.json`: `"cnpj": "11.728.688/0001-47"`.

| Campo | Conta |
|---|---|
| `p_vp` | preço do último pregão ÷ VP/cota do último informe da CVM (reserva: P/VP do Fundamentus) |
| `p_vp_vs_pares` | P/VP − mediana dos pares |
| `vp_var_12m_pct` | VP/cota do último informe vs. 12 meses antes |
| `cotistas_var_12m_pct` | idem, para o nº de cotistas |
| `spread_cdi_liquido_pp` | DY 12m − CDI × 0,85 (renda de FII é isenta de IR para PF) |
| `dy_real_pct` | (1 + DY 12m) ÷ (1 + IPCA 12m) − 1 |

### Checklist de triagem (fase 3)

`criterios_checklist.json` define os critérios. Cada um aponta para um campo do snapshot e tem faixas
`verde` e `amarelo` (`min`/`max`, `null` = sem limite); fora das duas é vermelho. Exemplo:

```json
{"id": "p_vp", "nome": "P/VP", "campo": "P_VP", "unidade": "x",
 "verde": {"min": 0.7, "max": 1.0}, "amarelo": {"min": 0.5, "max": 1.1},
 "peso": 2, "eliminatorio": false, "aplica_a": null}
```

- **Nota** (0–100): média ponderada (verde 1, amarelo 0,5, vermelho 0) dos critérios com dado.
- **Sinal**: verde se nota ≥ `verde_nota_minima` (85); vermelho se nota < `vermelho_nota_abaixo_de` (60)
  ou algum critério `eliminatorio` vermelho; amarelo no meio; cinza se a cobertura de dados for menor que
  `cobertura_minima` (60% do peso).
- `aplica_a: ["Tijolo", "Híbrido"]` restringe o critério a tipos de gestão.

Depois de editar o arquivo, rode `python gerar_dados_site.py` e `python -m app.ingest` (ou só reinicie o
`uvicorn`, que recalcula na hora). No snapshot entram `checklist_nota`, `checklist_sinal`,
`checklist_cobertura_pct` e a lista `checklist` com o status de cada critério.

### Comparação e diagnóstico por IA

- **Comparar** (`/#/comparar?a=HGLG11&b=BTLG11`): indicadores lado a lado, checklist, preço em base 100 e DY
  de cada pagamento. Na página de um fundo, o botão "Comparar com…" já abre com ele selecionado.
- **Diagnóstico por IA**: o Claude lê os números do painel (snapshot, checklist, pares, rendimentos, CDI/IPCA)
  e escreve um diagnóstico de triagem. Código em `site/backend/app/ia.py`.

| Onde | Como funciona |
|---|---|
| No seu PC (`uvicorn` + `npm run dev`) | Botão "Gerar diagnóstico" / "Comparar com IA": texto em tempo real (streaming) |
| GitHub Pages | Diagnóstico diário por fundo, gerado no Actions e publicado em `data/ia/{TICKER}.json` |

A chave da API **nunca** vai para o front-end (o site é público). Para usar no PC:

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."      # mesma janela em que roda o uvicorn
# opcional: $env:FIIS_MODELO_IA = "claude-sonnet-5"   (padrão: claude-haiku-4-5-20251001)
cd site\backend; uvicorn app.main:app --reload
```

No GitHub: **Settings → Secrets and variables → Actions → New repository secret** com o nome
`ANTHROPIC_API_KEY`. Para trocar o modelo do diário, crie a *variable* `FIIS_MODELO_IA`.
O script `python -m scripts.gerar_diagnosticos_ia` guarda um hash dos dados de cada fundo e só chama a
API quando algo mudou (custo com Haiku 4.5: menos de US$ 0,01 por diagnóstico).

No Power BI, `base_fiis_dividendos.csv` pode ser importado como uma tabela nova (`Ticker` 1—N com `FIIsConfig`).

Para testar o modo estático como ficará no Pages:

```powershell
cd site\backend;  python -m scripts.exportar_estatico ..\frontend\public\data
cd ..\frontend;   npm run build;  npm run preview
```

## Publicando no GitHub Pages

0. Mova `site/deploy/atualizar-e-publicar.yml` para `.github/workflows/atualizar-e-publicar.yml`
   (o GitHub só executa workflows nessa pasta).
1. Crie um repositório no GitHub e envie a pasta `Base FIIs` (o `.gitignore` já exclui `.pbix`, `.xlsx`, `.venv` e `node_modules`).
2. Em **Settings → Pages**, escolha *Source: GitHub Actions*.
3. Em **Settings → Actions → General**, marque *Read and write permissions*.
4. O workflow roda toda sexta às 18:30 (Brasília), coleta, salva o CSV no repositório e publica.
   Também dá para disparar manualmente na aba **Actions**.

O Power BI pode continuar lendo o CSV local; se quiser que ele leia o CSV atualizado pela nuvem,
basta fazer `git pull` antes de atualizar o relatório.

## Próximos passos sugeridos

- Benchmark contra o IFIX na página de detalhe.
- Carga retroativa de histórico (`yf.download(period="1y")`) para os gráficos ganharem corpo.
- Comparar fundos lado a lado (`/comparar?t=HGLG11&t=BTLG11`).
