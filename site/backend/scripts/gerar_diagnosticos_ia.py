"""Gera o diagnóstico de IA de cada fundo e grava em Base FIIs/data/ia/{TICKER}.json.

Feito para rodar no GitHub Actions uma vez por dia (o site no Pages não pode
chamar a API: a chave ficaria pública). Só chama o Claude quando os dados do
fundo mudaram desde a última geração (hash das entradas), então dias sem pregão
novo não custam nada.

Uso (a partir de site/backend, com ANTHROPIC_API_KEY definida):
    python -m scripts.gerar_diagnosticos_ia                 # os fundos escolhidos à mão (sem "origem": "auto")
    python -m scripts.gerar_diagnosticos_ia HGLG11 MXRF11   # só alguns
    python -m scripts.gerar_diagnosticos_ia --forcar        # ignora o cache
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

from app import ia, metrics
from app.config import RAIZ_PROJETO
from app.ingest import carregar_banco

PASTA_IA = RAIZ_PROJETO / "data" / "ia"
log = logging.getLogger("fiis.ia")


def tickers_padrao() -> list[str]:
    """Fundos que ganham diagnóstico diário. Por padrão, só os escolhidos à mão
    no fiis_config.json: os incluídos pelo descobrir_fiis.py ("origem": "auto")
    são centenas, e gerar todos todo dia multiplicaria o custo da API.
    FIIS_IA_TODOS=1 gera para todos."""
    from fiis_common import carregar_config

    no_banco = {f["ticker"] for f in metrics.calcular_meta()["fundos"]}
    todos = os.environ.get("FIIS_IA_TODOS", "").strip() in ("1", "true", "sim")
    return [f["ticker"] for f in carregar_config()
            if f["ticker"] in no_banco and (todos or f.get("origem") != "auto")]


def gerar_todos(tickers: list[str] | None = None, forcar: bool = False, cliente=None) -> dict:
    if not ia.disponivel() and cliente is None:
        log.warning("ANTHROPIC_API_KEY não definida: diagnósticos de IA não foram gerados.")
        return {"gerados": 0, "em_cache": 0, "falhas": 0}
    modelo = ia.modelo_configurado()
    PASTA_IA.mkdir(parents=True, exist_ok=True)
    tickers = tickers or tickers_padrao()
    resumo = {"gerados": 0, "em_cache": 0, "falhas": 0}
    for t in tickers:
        mensagem = metrics.mensagem_ia([t])
        if mensagem is None:
            log.warning("%s: fundo não encontrado", t)
            continue
        hash_ = ia.chave_cache(mensagem, modelo)
        arquivo = PASTA_IA / f"{t}.json"
        if not forcar and arquivo.exists():
            try:
                if json.loads(arquivo.read_text(encoding="utf-8")).get("hash") == hash_:
                    resumo["em_cache"] += 1
                    continue
            except json.JSONDecodeError:
                pass
        try:
            texto = ia.gerar(mensagem, modelo, cliente)
        except Exception as e:
            log.error("%s: falha na IA (%s)", t, e)
            resumo["falhas"] += 1
            continue
        arquivo.write_text(json.dumps({
            "ticker": t, "modelo": modelo, "gerado_em": datetime.now().isoformat(timespec="seconds"),
            "dados_ate": metrics.calcular_meta()["ultimo_pregao"], "hash": hash_, "texto": texto,
        }, ensure_ascii=False, indent=1), encoding="utf-8")
        resumo["gerados"] += 1
        log.info("%s: diagnóstico gerado (%d caracteres)", t, len(texto))
    log.info("IA: %s", resumo)
    return resumo


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    p = argparse.ArgumentParser()
    p.add_argument("tickers", nargs="*")
    p.add_argument("--forcar", action="store_true")
    a = p.parse_args()
    carregar_banco()
    r = gerar_todos([t.upper() for t in a.tickers] or None, a.forcar)
    sys.exit(1 if r["falhas"] and not r["gerados"] and not r["em_cache"] else 0)
