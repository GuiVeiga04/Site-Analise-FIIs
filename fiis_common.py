"""
fiis_common.py
----------------
Funções e configuração compartilhadas entre o coletor (atualizador_fiis.py)
e o gerador de dados para o site (gerar_dados_site.py).

Manter isso em um único lugar evita que a lógica de limpeza de preço, por
exemplo, fique duplicada (e divirja) entre os dois scripts.
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------------------
# Caminhos e configuração
# ---------------------------------------------------------------------------

PASTA_BASE = Path(__file__).resolve().parent
ARQUIVO_CONFIG = PASTA_BASE / "fiis_config.json"
ARQUIVO_HISTORICO = PASTA_BASE / "base_fiis_historico.csv"
ARQUIVO_DIVIDENDOS = PASTA_BASE / "base_fiis_dividendos.csv"

COLUNAS_DIVIDENDOS = ["Ticker", "Data_Ex", "Valor_R$", "Fonte", "Data_Coleta"]

# Fase 2 (coletar_fundamentos.py)
ARQUIVO_CVM = PASTA_BASE / "base_fiis_cvm.csv"                 # informe mensal (VP, PL, cotistas)
ARQUIVO_FUNDAMENTUS = PASTA_BASE / "base_fiis_fundamentus.csv"  # vacância, cap rate (opcional)
ARQUIVO_INDICADORES = PASTA_BASE / "base_indicadores.csv"       # CDI e IPCA (Banco Central)

# Fase 3
ARQUIVO_CRITERIOS = PASTA_BASE / "criterios_checklist.json"


def carregar_criterios() -> dict:
    """Critérios do checklist (editáveis pelo usuário). Sem o arquivo, o
    checklist simplesmente não é calculado."""
    if not ARQUIVO_CRITERIOS.exists():
        return {"criterios": [], "regras_sinal": {}}
    with open(ARQUIVO_CRITERIOS, encoding="utf-8") as f:
        return json.load(f)


def _ler_csv_opcional(caminho: Path, colunas_data: list[str]) -> pd.DataFrame:
    """Lê um CSV da fase 2; devolve DataFrame vazio se o arquivo não existe
    (o site continua funcionando só com cotações e dividendos)."""
    if not caminho.exists():
        return pd.DataFrame()
    df = pd.read_csv(caminho, sep=";", encoding="utf-8-sig")
    for c in colunas_data:
        if c in df.columns:
            df[c] = _converter_datas(df[c])
    return df


def carregar_cvm() -> pd.DataFrame:
    return _ler_csv_opcional(ARQUIVO_CVM, ["Data_Referencia"])


def carregar_fundamentus() -> pd.DataFrame:
    return _ler_csv_opcional(ARQUIVO_FUNDAMENTUS, ["Data_Coleta"])


def carregar_indicadores() -> pd.DataFrame:
    return _ler_csv_opcional(ARQUIVO_INDICADORES, ["Data"])


def carregar_config() -> list[dict]:
    """Lê fiis_config.json e devolve a lista de fundos monitorados.

    Ter isso em JSON (em vez de um dict fixo dentro do .py) facilita:
    - adicionar/remover fundos sem tocar em código;
    - reaproveitar a mesma lista no futuro site (é só publicar o json).
    """
    with open(ARQUIVO_CONFIG, encoding="utf-8") as f:
        config = json.load(f)
    fundos = config["fundos"]
    for f in fundos:
        # Fundos incluídos pelo descobrir_fiis.py podem vir sem gestora
        f.setdefault("gestora", "")
        f.setdefault("segmento_padrao", padronizar_segmento(f.get("segmento"), f.get("tipo_gestao"), f.get("nome")))
    return fundos


def montar_dicionario_tickers(fundos: list[dict]) -> dict[str, str]:
    """Ticker -> Nome_Fundo, no formato que o restante do código espera."""
    return {f["ticker"]: f["nome"] for f in fundos}


def montar_dicionario_classificacao(fundos: list[dict]) -> dict[str, dict]:
    """Ticker -> {gestora, tipo_gestao, segmento, segmento_padrao}."""
    return {
        f["ticker"]: {
            "gestora": f.get("gestora", ""),
            "tipo_gestao": f["tipo_gestao"],
            "segmento": f["segmento"],
            "segmento_padrao": f.get("segmento_padrao")
            or padronizar_segmento(f.get("segmento"), f.get("tipo_gestao"), f.get("nome")),
        }
        for f in fundos
    }


# ---------------------------------------------------------------------------
# Segmento padronizado
# ---------------------------------------------------------------------------
#
# O "segmento" do config é texto livre (ex: "CRI High Grade", "Logística /
# Galpões Industriais"). Para comparar um fundo com os pares e para o filtro
# do site, todo fundo também ganha um segmento PADRONIZADO, de uma lista
# curta. Ele sai do segmento do config (fundos escolhidos à mão) ou do
# segmento do Fundamentus (fundos incluídos pelo descobrir_fiis.py).

SEG_PAPEL = "Recebíveis (CRI)"
SEG_FOF = "Fundo de Fundos"
SEG_HIBRIDO = "Híbrido"
SEG_OUTROS = "Outros"

# (pedaços de texto procurados, segmento padronizado, tipo de gestão). A ordem importa.
REGRAS_SEGMENTO = [
    (("FUNDO DE FUNDOS", "FOF"), SEG_FOF, "FoF"),
    (("TITULOS", "VAL MOB", "VALORES MOBILIARIOS", "CRI", "RECEBIVEIS", "CREDITO"), SEG_PAPEL, "Papel"),
    (("HIBRIDO", "MULTICATEGORIA", "MULTIESTRATEGIA"), SEG_HIBRIDO, "Híbrido"),
    (("RENDA URBANA", "VAREJO"), "Renda urbana / varejo", "Tijolo"),
    (("LOGISTIC", "GALPO", "INDUSTRIA"), "Logística", "Tijolo"),
    (("SHOPPING",), "Shoppings", "Tijolo"),
    (("LAJE", "ESCRITORIO", "CORPORATIV"), "Lajes corporativas", "Tijolo"),
    (("HOSPITAL", "SAUDE"), "Hospitais", "Tijolo"),
    (("HOTE",), "Hotéis", "Tijolo"),
    (("RESIDENC",), "Residencial", "Tijolo"),
    (("AGENCIA", "BANCO"), "Agências bancárias", "Tijolo"),
    (("EDUCAC",), "Educacional", "Tijolo"),
    (("AGRO",), "Agro", "Tijolo"),
    (("DESENVOLV", "INCORPORA", "LOTEAMENTO"), "Desenvolvimento", "Tijolo"),
]

_PADRAO_FOF_NOME = re.compile(r"\b(FOF|FOFII|FUNDO DE FUNDOS|FII DE FII|FIIS? DE FIIS)\b")


def _sem_acento(texto) -> str:
    import unicodedata
    t = unicodedata.normalize("NFKD", str(texto or "")).encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9 ]", " ", t)


def classificar_segmento(segmento: str | None, nome: str | None = None) -> tuple[str, str]:
    """Texto de segmento (do config ou do Fundamentus) -> (segmento padronizado, tipo de gestão).
    Nome com "FOF"/"Fundo de Fundos" vira FoF mesmo que o segmento diga outra coisa."""
    if _PADRAO_FOF_NOME.search(_sem_acento(nome)):
        return SEG_FOF, "FoF"
    texto = " " + _sem_acento(segmento) + " "
    for chaves, padrao, tipo in REGRAS_SEGMENTO:
        # "CRI"/"FOF" só como palavra inteira (senão "CRI" casaria com "esCRItório")
        if any((f" {c} " in texto) if len(c) <= 3 else (c in texto) for c in chaves):
            return padrao, tipo
    return SEG_OUTROS, SEG_HIBRIDO


# Pelo NOME do fundo. Usado quando o segmento da fonte é genérico: o
# Fundamentus (e a CVM) põem a maioria dos fundos em "Multicategoria" ou
# "Outros", inclusive fundos de CRI. A ordem importa: "Habitat Recebíveis"
# é papel antes de ser residencial.
REGRAS_NOME = [
    (r"\bFOF\b|\bFOFII\b|FUNDO DE FUNDOS|\bFIC\b|MULTIGEST|\bFII DE FII", SEG_FOF, "FoF"),
    (r"\bCRI\b|RECEBIVE|CREDIT|HIGH YIELD|HIGH GRADE|\bJUROS\b|\bINDICES\b|TITULOS|ATIVOS FINANCEIROS"
     r"|SECURITIES|PAPEIS|\bIPCA\b|\bCDI\b|RENDIMENTOS IMOB|\bPAPEL\b|\bYIELD\b|INFLACAO|\bRECEB",
     SEG_PAPEL, "Papel"),
    (r"RENDA URBANA|VAREJO|\bURB\b|\bURBANA\b", "Renda urbana / varejo", "Tijolo"),
    (r"LOGIST|\bLOG\b|GALP|INDUSTRIA", "Logística", "Tijolo"),
    (r"SHOPPING|\bMALLS?\b", "Shoppings", "Tijolo"),
    (r"CORPORATE|CORPORATIV|OFFICE|ESCRITORIO|\bLAJES?\b|\bTOP OFF\b", "Lajes corporativas", "Tijolo"),
    (r"HOSPITA|SAUDE", "Hospitais", "Tijolo"),
    (r"HOTE", "Hotéis", "Tijolo"),
    (r"RESIDENC|\bRENDA RESID", "Residencial", "Tijolo"),
    (r"\bAGRO|TERRAS?\b|TERRAX", "Agro", "Tijolo"),
    (r"DESENVOLV|INCORPORA|LOTEAMENTO", "Desenvolvimento", "Tijolo"),
    (r"MULTIESTRAT|MULTI ESTRAT|HEDGE|TOTAL RETURN|OPORTUNIDADE|\bMULTI\b", SEG_HIBRIDO, "Híbrido"),
]


def classificar_por_nome(nome: str | None) -> tuple[str, str] | None:
    """(segmento padronizado, tipo) deduzido do nome, ou None se o nome não diz."""
    t = " " + _sem_acento(nome) + " "
    for padrao, seg, tipo in REGRAS_NOME:
        if re.search(padrao, t):
            return seg, tipo
    return None


# Composição da carteira (informe mensal da CVM): fração do que está investido
COMPOSICAO_DOMINANTE = 0.6


def classificar_fundo(segmento: str | None, nome: str | None = None,
                      composicao: dict | None = None) -> tuple[str, str]:
    """Classificação de um fundo incluído automaticamente.

    1. Composição da carteira na CVM, quando existe: >= 60% em CRI/LCI/LH/LIG
       é Papel; >= 60% em cotas de FII é FoF; >= 60% em imóveis é Tijolo;
       senão Híbrido. É o critério mais confiável: não depende de rótulo.
    2. Segmento da fonte (Fundamentus/CVM), quando é específico (Logística...).
    3. Nome do fundo, quando o segmento é genérico ("Multicategoria", "Outros").
    O segmento de um fundo de tijolo vem de 2 ou 3 (a CVM não diz se é galpão ou shopping).
    """
    seg_fonte, tipo_fonte = classificar_segmento(segmento, nome)
    generico = seg_fonte in (SEG_OUTROS, SEG_HIBRIDO)
    pelo_nome = classificar_por_nome(nome)
    if generico and pelo_nome:
        seg_fonte, tipo_fonte = pelo_nome

    if composicao:
        papel, fii, imoveis = (composicao.get(k) or 0 for k in ("papel", "fii", "imoveis"))
        if papel >= COMPOSICAO_DOMINANTE:
            return SEG_PAPEL, "Papel"
        if fii >= COMPOSICAO_DOMINANTE:
            return SEG_FOF, "FoF"
        if imoveis >= COMPOSICAO_DOMINANTE:
            return (seg_fonte, "Tijolo") if tipo_fonte == "Tijolo" else (SEG_OUTROS, "Tijolo")
        if papel + fii + imoveis > 0:
            return SEG_HIBRIDO, "Híbrido"
    return seg_fonte, tipo_fonte


def padronizar_segmento(segmento: str | None, tipo_gestao: str | None = None, nome: str | None = None) -> str:
    """Segmento padronizado de um fundo do config. O tipo de gestão escolhido à
    mão manda nos fundos de papel e FoF (o texto do segmento às vezes cita
    outras coisas, ex: "Multiestratégia (papel + tijolo + FoF)")."""
    if tipo_gestao == "FoF":
        return SEG_FOF
    if tipo_gestao == "Papel":
        return SEG_PAPEL
    if tipo_gestao == "Híbrido":
        return SEG_HIBRIDO
    return classificar_segmento(segmento, nome)[0]


# ---------------------------------------------------------------------------
# Limpeza de preço
# ---------------------------------------------------------------------------
#
# IMPORTANTE: em algum momento este CSV foi aberto/salvo pelo Excel com a
# coluna de preço formatada como moeda (ex: "R$ 89,26" em vez de 89.26).
# Isso transforma a coluna em TEXTO e quebra qualquer conta feita em cima
# dela (é a causa dos remendos manuais "/100" e "*10" encontrados no
# base_fiis_dash.xlsx). A função abaixo entende os dois formatos, então o
# restante do pipeline nunca mais precisa se preocupar com isso — e os dados
# antigos já "sujos" continuam sendo lidos corretamente.

_PADRAO_MOEDA_BR = re.compile(r"[Rr]\$?\s*")


def limpar_preco(valor) -> float | None:
    """Converte 'R$ 89,26', '89,26', '89.26' ou 89.26 (float) em 89.26 (float).

    Devolve None se o valor for vazio/():"" / NaN.
    """
    if valor is None:
        return None
    if isinstance(valor, (int, float)):
        return None if pd.isna(valor) else float(valor)

    texto = _PADRAO_MOEDA_BR.sub("", str(valor)).strip()
    if texto == "" or texto.lower() == "nan":
        return None

    # Formato brasileiro: milhar com ponto, decimal com vírgula (ex: 1.234,56)
    if "," in texto:
        texto = texto.replace(".", "").replace(",", ".")

    try:
        return round(float(texto), 2)
    except ValueError:
        return None


def _converter_datas(serie: pd.Series) -> pd.Series:
    """Converte datas aceitando ISO (2026-09-16, formato gravado pelo
    atualizador_fiis.py) e também dd/mm/aaaa (formato que aparece quando o
    CSV é aberto e salvo pelo Excel). Sem esse fallback, datas ISO lidas com
    format="%d/%m/%Y" viravam NaT e o histórico inteiro perdia as datas.
    """
    iso = pd.to_datetime(serie, format="%Y-%m-%d", errors="coerce")
    br = pd.to_datetime(serie, format="%d/%m/%Y", errors="coerce")
    return iso.fillna(br)


def carregar_historico_limpo(remover_anomalias: bool = True, volume_zero_como_vazio: bool = True) -> pd.DataFrame:
    """Lê base_fiis_historico.csv e devolve um DataFrame com tipos corretos:
    datas como datetime, preço como float, volume como int.

    Funciona tanto com dados novos (já limpos) quanto com o histórico antigo
    que tinha o preço formatado como 'R$ xx,xx'.

    remover_anomalias=True (padrão) descarta cotações claramente erradas do
    Yahoo (ver remover_cotacoes_anomalas).
    volume_zero_como_vazio=True (padrão) trata volume 0 como "sem dado": é o
    que o Yahoo devolve quando o volume do dia ainda não fechou, e um 0 falso
    puxaria a liquidez média para baixo.
    O atualizador_fiis.py usa False nos dois ao regravar o CSV, para que o
    arquivo continue guardando o dado bruto: os filtros valem na LEITURA.
    """
    if not ARQUIVO_HISTORICO.exists():
        return pd.DataFrame(
            columns=[
                "Data_Coleta",
                "Data_Pregao",
                "Ticker",
                "Nome_Fundo",
                "Preco_Fechamento_R$",
                "Volume_Ultimo_Dia",
            ]
        )

    df = pd.read_csv(ARQUIVO_HISTORICO, sep=";", encoding="utf-8-sig")

    df["Preco_Fechamento_R$"] = df["Preco_Fechamento_R$"].apply(limpar_preco)
    df["Volume_Ultimo_Dia"] = pd.to_numeric(df["Volume_Ultimo_Dia"], errors="coerce")
    df["Data_Coleta"] = _converter_datas(df["Data_Coleta"])
    df["Data_Pregao"] = _converter_datas(df["Data_Pregao"])

    df = remover_duplicatas_pregao(df)
    if volume_zero_como_vazio:
        df["Volume_Ultimo_Dia"] = df["Volume_Ultimo_Dia"].where(df["Volume_Ultimo_Dia"] > 0)
    if remover_anomalias:
        df = remover_cotacoes_anomalas(df)
    return df


# ---------------------------------------------------------------------------
# Cotações anômalas
# ---------------------------------------------------------------------------
#
# O Yahoo às vezes devolve, por alguns pregões, um preço completamente fora da
# realidade e depois volta ao normal. Casos reais encontrados na base:
#   XPML11 em 14-16/01/2026: R$ 1,07 (normal ~R$ 110)
#   RECR11 em 03-06/11/2025: R$ 55   (normal ~R$ 77, ou seja -28%)
# Esses pontos distorcem mínima, volatilidade, gráficos e qualquer simulação.
#
# Regra: um preço é anômalo quando
#   1) difere mais de LIMITE_DESVIO (20%) da mediana dos JANELA pregões ANTERIORES, e
#   2) difere mais de 20% da mediana dos JANELA pregões SEGUINTES, e
#   3) essas duas medianas concordam entre si (diferença < LIMITE_RETORNO, 10%):
#      o preço "foi e voltou". Uma queda (ou alta) de verdade que se mantém
#      muda o patamar e NÃO satisfaz a condição 3, então não é removida.
# FII não cai (ou sobe) 20% e volta ao mesmo patamar em poucos dias; se isso
# aparecer, é erro de dado. A janela de 7 pregões de cada lado aguenta até 4
# pregões errados seguidos
# sem que eles contaminem a mediana. Pontos nas pontas da série (menos de 3
# vizinhos de algum lado) não são avaliados: não há como confirmar a volta.

JANELA_ANOMALIA = 7
MIN_VIZINHOS_ANOMALIA = 3
LIMITE_DESVIO = 0.20
LIMITE_RETORNO = 0.10


def marcar_cotacoes_anomalas(precos: pd.Series) -> pd.Series:
    """Recebe os preços de UM fundo em ordem cronológica; devolve uma série
    booleana (True = cotação anômala)."""
    p = precos.astype(float).reset_index(drop=True)
    anomalo = [False] * len(p)
    for i in range(len(p)):
        antes = p.iloc[max(0, i - JANELA_ANOMALIA):i].dropna()
        depois = p.iloc[i + 1:i + 1 + JANELA_ANOMALIA].dropna()
        atual = p.iloc[i]
        if pd.isna(atual) or len(antes) < MIN_VIZINHOS_ANOMALIA or len(depois) < MIN_VIZINHOS_ANOMALIA:
            continue
        m_antes, m_depois = antes.median(), depois.median()
        if m_antes <= 0 or m_depois <= 0:
            continue
        foi = abs(atual / m_antes - 1) > LIMITE_DESVIO and abs(atual / m_depois - 1) > LIMITE_DESVIO
        voltou = abs(m_antes / m_depois - 1) < LIMITE_RETORNO
        anomalo[i] = foi and voltou
    return pd.Series(anomalo, index=precos.index)


def remover_cotacoes_anomalas(df: pd.DataFrame) -> pd.DataFrame:
    """Remove do histórico (só em memória) as cotações anômalas de cada fundo
    e registra no log quais foram."""
    if df.empty:
        return df
    df = df.sort_values(["Ticker", "Data_Pregao"])
    marcas = df.groupby("Ticker", group_keys=False)["Preco_Fechamento_R$"].apply(marcar_cotacoes_anomalas)
    removidas = df[marcas]
    if len(removidas):
        log = logging.getLogger("fiis")
        for t, g in removidas.groupby("Ticker"):
            datas = ", ".join(d.strftime("%d/%m/%Y") for d in g["Data_Pregao"])
            log.warning("Cotações anômalas ignoradas em %s: %s (preços %s)", t, datas,
                        ", ".join(f"{v:.2f}" for v in g["Preco_Fechamento_R$"]))
    return df[~marcas].reset_index(drop=True)


def remover_duplicatas_pregao(df: pd.DataFrame) -> pd.DataFrame:
    """Remove coletas repetidas do MESMO pregão para o MESMO ticker.

    Isso acontece sempre que o script roda em um dia sem pregão novo (ex:
    segunda-feira cedo, antes do fechamento, ou depois de um feriado): o
    Yahoo Finance ainda devolve o último fechamento disponível (ex: sexta-
    feira), e o script grava uma nova linha para uma data de pregão que já
    tinha sido salva antes — só que com Data_Coleta diferente e, às vezes,
    valores levemente diferentes de preço/volume (o Yahoo ocasionalmente
    revisa o volume final do dia).

    Mantemos a coleta mais recente (presumivelmente a mais "definitiva")
    para cada par (Ticker, Data_Pregao) e descartamos a mais antiga, para
    que cada dia de pregão apareça uma única vez na série histórica.
    """
    se_tem_pregao = df["Data_Pregao"].notna()
    com_pregao = df[se_tem_pregao].sort_values("Data_Coleta")
    sem_pregao = df[~se_tem_pregao]

    # Se a coleta mais recente de um pregão veio sem volume (0 ou vazio) e uma
    # coleta anterior do MESMO pregão tinha volume, aproveita o volume anterior:
    # regravar um pregão nunca deve piorar o dado.
    vol = pd.to_numeric(com_pregao["Volume_Ultimo_Dia"], errors="coerce")
    ultimo_bom = vol.where(vol > 0).groupby([com_pregao["Ticker"], com_pregao["Data_Pregao"]]).transform("last")
    com_pregao = com_pregao.assign(Volume_Ultimo_Dia=vol.where(vol > 0, ultimo_bom).fillna(vol))

    com_pregao = com_pregao.drop_duplicates(subset=["Ticker", "Data_Pregao"], keep="last")

    return pd.concat([com_pregao, sem_pregao], ignore_index=True)


# ---------------------------------------------------------------------------
# Dividendos (rendimentos)
# ---------------------------------------------------------------------------


def carregar_dividendos() -> pd.DataFrame:
    """Lê base_fiis_dividendos.csv com tipos corretos.

    Uma linha por (Ticker, Data_Ex). Data_Ex é a data em que a cota passa a
    ser negociada SEM direito ao rendimento (o Yahoo registra essa data).
    Na B3 ela é o pregão seguinte à data-com: quem tinha a cota no
    fechamento da data-com recebe o rendimento.
    """
    if not ARQUIVO_DIVIDENDOS.exists():
        return pd.DataFrame(columns=COLUNAS_DIVIDENDOS)

    df = pd.read_csv(ARQUIVO_DIVIDENDOS, sep=";", encoding="utf-8-sig")
    df["Valor_R$"] = df["Valor_R$"].apply(limpar_valor_dividendo)
    df["Data_Ex"] = _converter_datas(df["Data_Ex"])
    df["Data_Coleta"] = _converter_datas(df["Data_Coleta"])
    df = df[df["Data_Ex"].notna() & df["Valor_R$"].notna() & (df["Valor_R$"] > 0)]
    return remover_duplicatas_dividendo(df)


def limpar_valor_dividendo(valor) -> float | None:
    """Igual a limpar_preco, mas sem arredondar para 2 casas: rendimento de
    FII costuma ter 4+ casas (ex: R$ 0,1045 por cota)."""
    if valor is None:
        return None
    if isinstance(valor, (int, float)):
        return None if pd.isna(valor) else float(valor)
    texto = _PADRAO_MOEDA_BR.sub("", str(valor)).strip()
    if texto == "" or texto.lower() == "nan":
        return None
    if "," in texto:
        texto = texto.replace(".", "").replace(",", ".")
    try:
        return float(texto)
    except ValueError:
        return None


def remover_duplicatas_dividendo(df: pd.DataFrame) -> pd.DataFrame:
    """Um rendimento por (Ticker, Data_Ex), mantendo a coleta mais recente
    (o Yahoo às vezes corrige o valor alguns dias depois do anúncio)."""
    return (
        df.sort_values(["Data_Coleta", "Data_Ex"])
        .drop_duplicates(subset=["Ticker", "Data_Ex"], keep="last")
        .sort_values(["Ticker", "Data_Ex"])
        .reset_index(drop=True)
    )


def configurar_logging() -> logging.Logger:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    return logging.getLogger("fiis")
