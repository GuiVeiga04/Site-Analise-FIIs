"""Carrega fiis_config.json + os CSVs de cotações, dividendos e fundamentos no SQLite.

Rode sempre depois do atualizador_fiis.py:
    python -m app.ingest          (a partir de site/backend)

A carga é idempotente (upsert): pode rodar quantas vezes quiser.
"""
from __future__ import annotations

import logging
from datetime import datetime

import pandas as pd

from . import config  # noqa: F401  (garante a raiz no sys.path)
from .db import conectar, criar_schema

from fiis_common import (  # noqa: E402
    carregar_config,
    carregar_cvm,
    carregar_dividendos,
    carregar_fundamentus,
    carregar_historico_limpo,
    carregar_indicadores,
)

# Tabelas da fase 2: pequenas, então são recriadas inteiras a cada carga.
TABELAS_FASE2 = {
    "cvm_mensal": (carregar_cvm, ["Data_Referencia"]),
    "fundamentus": (carregar_fundamentus, ["Data_Coleta"]),
    "indicadores": (carregar_indicadores, ["Data"]),
}

log = logging.getLogger("fiis.ingest")


def carregar_banco() -> dict:
    fundos = carregar_config()
    df = carregar_historico_limpo()
    df = df[df["Data_Pregao"].notna() & df["Preco_Fechamento_R$"].notna()]

    with conectar() as con:
        criar_schema(con)
        con.executemany(
            """INSERT INTO fundos (ticker, nome, gestora, tipo_gestao, segmento)
               VALUES (:ticker, :nome, :gestora, :tipo_gestao, :segmento)
               ON CONFLICT(ticker) DO UPDATE SET
                 nome=excluded.nome, gestora=excluded.gestora,
                 tipo_gestao=excluded.tipo_gestao, segmento=excluded.segmento""",
            fundos,
        )
        tickers_validos = {f["ticker"] for f in fundos}
        linhas = [
            (
                r.Ticker,
                r.Data_Pregao.date().isoformat(),
                r.Data_Coleta.date().isoformat() if r.Data_Coleta == r.Data_Coleta else None,
                float(r._5),
                int(r.Volume_Ultimo_Dia) if r.Volume_Ultimo_Dia == r.Volume_Ultimo_Dia else None,
            )
            for r in df.itertuples()
            if r.Ticker in tickers_validos
        ]
        # Recarga completa: apaga antes de inserir. Com só "upsert", uma linha que
        # saiu do CSV/limpeza (ex: cotação anômala filtrada) ficava presa no banco.
        con.execute("DELETE FROM cotacoes")
        con.executemany(
            """INSERT INTO cotacoes (ticker, data_pregao, data_coleta, preco, volume_cotas)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(ticker, data_pregao) DO UPDATE SET
                 data_coleta=excluded.data_coleta, preco=excluded.preco,
                 volume_cotas=excluded.volume_cotas""",
            linhas,
        )
        div = carregar_dividendos()
        linhas_div = [
            (
                r["Ticker"],
                r["Data_Ex"].date().isoformat(),
                float(r["Valor_R$"]),
                r["Fonte"] if isinstance(r["Fonte"], str) else None,
                r["Data_Coleta"].date().isoformat() if pd.notna(r["Data_Coleta"]) else None,
            )
            for r in div.to_dict(orient="records")
            if r["Ticker"] in tickers_validos
        ]
        con.execute("DELETE FROM dividendos")
        con.executemany(
            """INSERT INTO dividendos (ticker, data_ex, valor, fonte, data_coleta)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(ticker, data_ex) DO UPDATE SET
                 valor=excluded.valor, fonte=excluded.fonte, data_coleta=excluded.data_coleta""",
            linhas_div,
        )
        contagem_fase2 = {}
        for tabela, (carregar, datas) in TABELAS_FASE2.items():
            df_t = carregar()
            con.execute(f"DROP TABLE IF EXISTS {tabela}")
            if df_t.empty:
                contagem_fase2[tabela] = 0
                continue
            for c in datas:
                df_t[c] = df_t[c].dt.strftime("%Y-%m-%d")
            df_t.to_sql(tabela, con, index=False)
            contagem_fase2[tabela] = len(df_t)
        con.execute(
            "INSERT OR REPLACE INTO meta (chave, valor) VALUES ('carregado_em', ?)",
            (datetime.now().isoformat(timespec="seconds"),),
        )

    resumo = {"fundos": len(fundos), "cotacoes": len(linhas), "dividendos": len(linhas_div), **contagem_fase2}
    log.info("Banco carregado: %s", resumo)
    return resumo


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    carregar_banco()
