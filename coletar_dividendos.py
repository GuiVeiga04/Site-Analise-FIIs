"""
coletar_dividendos.py
----------------------
Baixa o histórico de rendimentos (dividendos) de cada FII pelo Yahoo Finance
e mantém base_fiis_dividendos.csv atualizado.

Diferente das cotações, aqui não faz sentido "anexar só o último": o Yahoo
devolve a lista inteira de rendimentos do fundo, então cada execução baixa
tudo, junta com o que já existe e deduplica por (Ticker, Data_Ex). Rodar
várias vezes é seguro, e a primeira execução já traz anos de histórico.

Colunas do CSV (separador ';', mesmo padrão do histórico de cotações):
    Ticker       ex: HGLG11
    Data_Ex      data em que a cota passa a ser negociada sem o rendimento
                 (na B3, o pregão seguinte à data-com)
    Valor_R$     rendimento por cota, em reais
    Fonte        "yahoo"
    Data_Coleta  quando a linha foi coletada

Uso:
    python coletar_dividendos.py              # todos os fundos do config
    python coletar_dividendos.py HGLG11 MXRF11
"""

from __future__ import annotations

import sys
import time
from datetime import date

import pandas as pd
import yfinance as yf

from fiis_common import (
    ARQUIVO_DIVIDENDOS,
    COLUNAS_DIVIDENDOS,
    carregar_config,
    carregar_dividendos,
    configurar_logging,
    remover_duplicatas_dividendo,
)

log = configurar_logging()


def baixar_dividendos_ticker(ticker: str, tentativas: int = 3) -> pd.DataFrame:
    """Rendimentos de um ticker (sem o .SA). Devolve DataFrame vazio se o
    Yahoo não tiver nada, sem derrubar a coleta dos demais fundos."""
    for tentativa in range(1, tentativas + 1):
        try:
            serie = yf.Ticker(f"{ticker}.SA").dividends
            break
        except Exception as e:  # rede/instabilidade do Yahoo
            if tentativa == tentativas:
                log.error("%s: falhou após %d tentativas (%s)", ticker, tentativas, e)
                return pd.DataFrame(columns=COLUNAS_DIVIDENDOS)
            time.sleep(3)

    if serie is None or serie.empty:
        log.warning("%s: Yahoo não devolveu rendimentos", ticker)
        return pd.DataFrame(columns=COLUNAS_DIVIDENDOS)

    # O índice vem com fuso (America/Sao_Paulo); guardamos só a data.
    datas = pd.to_datetime(serie.index)
    if getattr(datas, "tz", None) is not None:
        datas = datas.tz_localize(None)

    return pd.DataFrame(
        {
            "Ticker": ticker,
            "Data_Ex": datas.normalize(),
            "Valor_R$": serie.values.astype(float),
            "Fonte": "yahoo",
            "Data_Coleta": pd.Timestamp(date.today()),
        }
    )


def main(tickers: list[str] | None = None) -> None:
    fundos = carregar_config()
    tickers = tickers or [f["ticker"] for f in fundos]

    log.info("Coletando rendimentos de %d FIIs...", len(tickers))
    novos = [baixar_dividendos_ticker(t) for t in tickers]
    novos = [d for d in novos if not d.empty]
    df_novo = pd.concat(novos, ignore_index=True) if novos else pd.DataFrame(columns=COLUNAS_DIVIDENDOS)

    existente = carregar_dividendos()
    antes = len(existente)
    base = pd.concat([existente, df_novo], ignore_index=True) if len(existente) else df_novo
    if base.empty:
        log.warning("Nenhum rendimento coletado — CSV não foi alterado.")
        return
    base = remover_duplicatas_dividendo(base)

    sem_dados = sorted(set(tickers) - set(df_novo["Ticker"]))
    if sem_dados:
        log.warning("Sem rendimentos nesta coleta: %s", ", ".join(sem_dados))

    saida = base[COLUNAS_DIVIDENDOS].copy()
    saida["Data_Ex"] = saida["Data_Ex"].dt.strftime("%Y-%m-%d")
    saida["Data_Coleta"] = saida["Data_Coleta"].dt.strftime("%Y-%m-%d")
    saida["Valor_R$"] = saida["Valor_R$"].round(6)
    saida.to_csv(ARQUIVO_DIVIDENDOS, index=False, encoding="utf-8-sig", sep=";")

    log.info(
        "'%s' atualizado: %d rendimentos (%+d novos), %d fundos com dados.",
        ARQUIVO_DIVIDENDOS.name, len(saida), len(saida) - antes, saida["Ticker"].nunique(),
    )


if __name__ == "__main__":
    main([t.upper() for t in sys.argv[1:]] or None)
