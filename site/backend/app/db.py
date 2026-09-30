"""Acesso ao SQLite (stdlib, sem ORM — o volume de dados é pequeno).

Tabelas:
  fundos    -> dimensão (vem do fiis_config.json)
  cotacoes  -> fato, uma linha por (ticker, data_pregao), já limpa
  dividendos -> fato, uma linha por (ticker, data_ex)
  cvm_mensal / fundamentus / indicadores -> fase 2; recriadas a cada carga
      pelo ingest a partir dos CSVs (to_sql), por isso não estão no SCHEMA
  meta      -> chave/valor (ex: quando o banco foi carregado)
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS fundos (
    ticker       TEXT PRIMARY KEY,
    nome         TEXT NOT NULL,
    gestora      TEXT,
    tipo_gestao  TEXT,
    segmento     TEXT
);

CREATE TABLE IF NOT EXISTS cotacoes (
    ticker        TEXT NOT NULL REFERENCES fundos(ticker),
    data_pregao   TEXT NOT NULL,   -- ISO YYYY-MM-DD
    data_coleta   TEXT,
    preco         REAL,
    volume_cotas  INTEGER,
    PRIMARY KEY (ticker, data_pregao)
);

CREATE INDEX IF NOT EXISTS ix_cotacoes_data ON cotacoes(data_pregao);

CREATE TABLE IF NOT EXISTS dividendos (
    ticker       TEXT NOT NULL REFERENCES fundos(ticker),
    data_ex      TEXT NOT NULL,    -- ISO YYYY-MM-DD
    valor        REAL NOT NULL,    -- R$ por cota
    fonte        TEXT,
    data_coleta  TEXT,
    PRIMARY KEY (ticker, data_ex)
);

CREATE TABLE IF NOT EXISTS meta (
    chave TEXT PRIMARY KEY,
    valor TEXT
);
"""


@contextmanager
def conectar(caminho: Path | None = None):
    con = sqlite3.connect(caminho or DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def criar_schema(con: sqlite3.Connection) -> None:
    con.executescript(SCHEMA)
