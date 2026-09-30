"""Caminhos e configurações do backend.

O backend fica em `site/backend/`, mas a lógica de dados (limpeza de preço,
deduplicação, métricas) continua morando nos scripts da raiz da pasta
`Base FIIs` (fiis_common.py / gerar_dados_site.py). Para não duplicar essa
lógica, colocamos a raiz no sys.path e importamos de lá.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
RAIZ_PROJETO = BACKEND_DIR.parents[1]  # .../Base FIIs

if str(RAIZ_PROJETO) not in sys.path:
    sys.path.insert(0, str(RAIZ_PROJETO))

# Banco SQLite (pode ser sobrescrito por variável de ambiente, ex: nos testes)
DB_PATH = Path(os.environ.get("FIIS_DB_PATH", BACKEND_DIR / "fiis.db"))

# Origens liberadas no CORS (front em dev roda no Vite, porta 5173)
CORS_ORIGINS = os.environ.get(
    "FIIS_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")
