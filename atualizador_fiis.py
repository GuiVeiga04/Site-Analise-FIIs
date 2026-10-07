"""
Atualização semanal de base histórica de FIIs.

Cada execução ADICIONA uma linha por fundo (com data da coleta e data do
pregão) ao arquivo histórico, em vez de sobrescrevê-lo. Isso permite montar
séries temporais (preço, volume) ao longo das semanas.

Principais mudanças em relação à versão anterior:
- Lista de fundos/segmentos veio para fiis_config.json (fica mais fácil de
  manter e é reaproveitada pelo gerar_dados_site.py).
- Preço é sempre salvo como número (float), nunca como texto "R$ x,xx" —
  isso evita o problema que existia no arquivo de dashboard, onde a coluna
  de preço virou texto e precisou de fórmulas manuais para corrigir a escala.
- Ao salvar, também calculamos Volume_Financeiro_R$ (preço x quantidade),
  que é a métrica de liquidez mais usada no mercado (ver README/relatório).
- Logging em vez de print, e código organizado em funções testáveis.
"""

from __future__ import annotations

import time
from datetime import date

import pandas as pd
import yfinance as yf

from fiis_common import (
    ARQUIVO_HISTORICO,
    carregar_config,
    carregar_historico_limpo,
    configurar_logging,
    limpar_preco,
    montar_dicionario_tickers,
    remover_duplicatas_pregao,
)

log = configurar_logging()


def baixar_com_retentativa(
    tickers: list[str], tentativas: int = 3, espera_segundos: int = 5, periodo: str = "5d"
) -> pd.DataFrame:
    """Tenta baixar os dados algumas vezes antes de desistir, já que o
    Yahoo Finance ocasionalmente retorna falhas temporárias (ex: algum
    ticker aparecendo como sem dados por instabilidade, sem realmente estar).
    """
    resultado = None
    for tentativa in range(1, tentativas + 1):
        resultado = yf.download(
            tickers,
            period=periodo,
            group_by="ticker",
            auto_adjust=False,
            progress=False,
            threads=True,
        )
        faltantes = [
            t for t in tickers
            if t not in resultado or resultado[t].dropna(how="all").empty
        ]
        if not faltantes:
            return resultado
        if tentativa < tentativas:
            log.warning(
                "Tentativa %d: %d ticker(s) sem dados ainda. Tentando de novo em %ds...",
                tentativa, len(faltantes), espera_segundos,
            )
            time.sleep(espera_segundos)
        else:
            log.warning(
                "Encerrando após %d tentativas. Ainda faltam: %s",
                tentativas, faltantes,
            )
    return resultado


def coletar_cotacoes(fiis: dict[str, str]) -> pd.DataFrame:
    """Baixa as cotações mais recentes e devolve um DataFrame já no formato
    de uma linha por fundo (preço/volume do último pregão disponível)."""
    tickers_yf = [f"{t}.SA" for t in fiis]
    log.info("Coletando cotações de %d FIIs...", len(tickers_yf))
    dados = baixar_com_retentativa(tickers_yf)

    hoje = date.today().isoformat()
    registros = []

    for ticker, nome in fiis.items():
        ticker_yf = f"{ticker}.SA"
        try:
            hist = dados[ticker_yf].dropna(how="all")

            if hist.empty:
                preco = volume = data_pregao = None
            else:
                ultimo = hist.iloc[-1]
                preco = round(float(ultimo["Close"]), 2)
                volume = int(ultimo["Volume"])
                data_pregao = hist.index[-1].date().isoformat()

            registros.append(
                {
                    "Data_Coleta": hoje,
                    "Data_Pregao": data_pregao,
                    "Ticker": ticker,
                    "Nome_Fundo": nome,
                    "Preco_Fechamento_R$": preco,
                    "Volume_Ultimo_Dia": volume,
                }
            )
        except Exception as e:
            log.error("Erro ao processar %s: %s", ticker, e)
            registros.append(
                {
                    "Data_Coleta": hoje,
                    "Data_Pregao": None,
                    "Ticker": ticker,
                    "Nome_Fundo": nome,
                    "Preco_Fechamento_R$": None,
                    "Volume_Ultimo_Dia": None,
                }
            )

    return pd.DataFrame(registros)


def coletar_historico_retroativo(fiis: dict[str, str], periodo: str) -> pd.DataFrame:
    """Carga retroativa (rodar uma vez): TODOS os pregões do período, não só
    o último. Data_Coleta recebe a própria Data_Pregao, de propósito: na
    deduplicação por pregão vence a coleta mais recente, então as linhas que
    já foram coletadas "de verdade" continuam valendo e a carga só preenche
    os buracos."""
    tickers_yf = [f"{t}.SA" for t in fiis]
    log.info("Carga retroativa (%s) de %d FIIs...", periodo, len(tickers_yf))
    dados = baixar_com_retentativa(tickers_yf, periodo=periodo)

    partes = []
    for ticker, nome in fiis.items():
        try:
            hist = dados[f"{ticker}.SA"].dropna(subset=["Close"])
        except KeyError:
            log.warning("%s: sem dados na carga retroativa", ticker)
            continue
        if hist.empty:
            continue
        datas = pd.to_datetime(hist.index).tz_localize(None) if hist.index.tz is not None else pd.to_datetime(hist.index)
        partes.append(
            pd.DataFrame(
                {
                    "Data_Coleta": datas.strftime("%Y-%m-%d"),
                    "Data_Pregao": datas.strftime("%Y-%m-%d"),
                    "Ticker": ticker,
                    "Nome_Fundo": nome,
                    "Preco_Fechamento_R$": hist["Close"].round(2).values,
                    "Volume_Ultimo_Dia": hist["Volume"].fillna(0).astype(int).values,
                }
            )
        )
    df = pd.concat(partes, ignore_index=True)
    log.info("Carga retroativa: %d linhas (%d fundos).", len(df), df["Ticker"].nunique())
    return df


def anexar_ao_historico(df_novo: pd.DataFrame) -> pd.DataFrame:
    """Junta a coleta de hoje ao histórico existente, evitando duplicar a
    mesma coleta caso o script rode mais de uma vez no mesmo dia. O
    histórico existente é relido com `carregar_historico_limpo` para que
    preços antigos guardados como texto ("R$ 89,26") sejam convertidos e o
    arquivo final fique 100% numérico a partir de agora.
    """
    # df_novo chega com datas em texto (YYYY-MM-DD); convertemos para
    # datetime para poder juntar com o histórico existente (que já vem
    # como datetime de carregar_historico_limpo) e aplicar a deduplicação
    # por pregão. Só voltamos para texto na hora de gravar o CSV.
    df_novo = df_novo.copy()
    df_novo["Data_Coleta"] = pd.to_datetime(df_novo["Data_Coleta"])
    df_novo["Data_Pregao"] = pd.to_datetime(df_novo["Data_Pregao"])

    if ARQUIVO_HISTORICO.exists():
        # False: regrava o CSV com o dado bruto; o filtro de anomalias só vale na leitura
        df_existente = carregar_historico_limpo(remover_anomalias=False)
        df_final = pd.concat([df_existente, df_novo], ignore_index=True)
    else:
        df_final = df_novo

    # Deduplica por (Ticker, Data_Pregao): se a nova coleta trouxer um
    # pregão que já constava (ex: rodou na segunda de manhã e o último
    # pregão ainda é sexta), mantemos a coleta mais recente em vez de
    # acumular duas linhas para o mesmo dia de negociação.
    df_final = remover_duplicatas_pregao(df_final)

    df_final["Data_Coleta"] = df_final["Data_Coleta"].dt.strftime("%Y-%m-%d")
    df_final["Data_Pregao"] = df_final["Data_Pregao"].dt.strftime("%Y-%m-%d")

    return df_final


def main(argv: list[str] | None = None) -> None:
    """Uso:
        python atualizador_fiis.py                   # coleta normal (último pregão)
        python atualizador_fiis.py --retroativo 1y   # uma vez: preenche o histórico
    """
    import argparse

    parser = argparse.ArgumentParser(description="Coleta de cotações de FIIs")
    parser.add_argument(
        "--retroativo", metavar="PERIODO",
        help="baixa todos os pregões do período (ex: 6mo, 1y, 2y) em vez de só o último",
    )
    args = parser.parse_args(argv)

    fundos = carregar_config()
    fiis = montar_dicionario_tickers(fundos)

    if args.retroativo:
        df_novo = coletar_historico_retroativo(fiis, args.retroativo)
    else:
        df_novo = coletar_cotacoes(fiis)
    df_final = anexar_ao_historico(df_novo)

    df_final = df_final.sort_values(["Data_Coleta", "Ticker"]).reset_index(drop=True)
    df_final.to_csv(ARQUIVO_HISTORICO, index=False, encoding="utf-8-sig", sep=";")

    log.info(
        "Base '%s' atualizada com %d registros da coleta de hoje. Total acumulado: %d linhas.",
        ARQUIVO_HISTORICO.name, len(df_novo), len(df_final),
    )


if __name__ == "__main__":
    main()
