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
    return config["fundos"]


def montar_dicionario_tickers(fundos: list[dict]) -> dict[str, str]:
    """Ticker -> Nome_Fundo, no formato que o restante do código espera."""
    return {f["ticker"]: f["nome"] for f in fundos}


def montar_dicionario_classificacao(fundos: list[dict]) -> dict[str, dict]:
    """Ticker -> {gestora, tipo_gestao, segmento}."""
    return {
        f["ticker"]: {
            "gestora": f["gestora"],
            "tipo_gestao": f["tipo_gestao"],
            "segmento": f["segmento"],
        }
        for f in fundos
    }


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


def carregar_historico_limpo() -> pd.DataFrame:
    """Lê base_fiis_historico.csv e devolve um DataFrame com tipos corretos:
    datas como datetime, preço como float, volume como int.

    Funciona tanto com dados novos (já limpos) quanto com o histórico antigo
    que tinha o preço formatado como 'R$ xx,xx'.
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

    return remover_duplicatas_pregao(df)


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
