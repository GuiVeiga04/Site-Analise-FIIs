"""Exporta as respostas da API como arquivos JSON estáticos.

Usado no deploy do GitHub Pages (que não roda Python): o front-end lê
`data/meta.json`, `data/snapshot.json`, `data/historico/{TICKER}.json`
e `data/dividendos/{TICKER}.json`
com o mesmo formato que a API devolveria.

Uso (a partir de site/backend):
    python -m scripts.exportar_estatico ../frontend/public/data
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from app import metrics
from app.config import RAIZ_PROJETO
from app.ingest import carregar_banco
from app.schemas import FundoSnapshot, Meta, PontoDividendo, PontoHistorico


def _gravar(caminho: Path, conteudo) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(conteudo, ensure_ascii=False, indent=1), encoding="utf-8")


def exportar(destino: Path) -> None:
    carregar_banco()
    meta = Meta(**metrics.calcular_meta()).model_dump()
    snapshot = [FundoSnapshot(**d).model_dump() for d in metrics.calcular_snapshot()]
    _gravar(destino / "meta.json", meta)
    _gravar(destino / "snapshot.json", snapshot)
    for f in meta["fundos"]:
        serie = [PontoHistorico(**p).model_dump() for p in metrics.calcular_historico(f["ticker"])]
        _gravar(destino / "historico" / f"{f['ticker']}.json", serie)
        divs = [PontoDividendo(**p).model_dump() for p in metrics.calcular_dividendos(f["ticker"]) or []]
        _gravar(destino / "dividendos" / f"{f['ticker']}.json", divs)
    # Diagnósticos de IA gerados pelo Actions (scripts/gerar_diagnosticos_ia.py)
    pasta_ia = RAIZ_PROJETO / "data" / "ia"
    n_ia = 0
    if pasta_ia.exists():
        (destino / "ia").mkdir(parents=True, exist_ok=True)
        for arq in pasta_ia.glob("*.json"):
            shutil.copy(arq, destino / "ia" / arq.name)
            n_ia += 1
    print(f"Exportados {len(snapshot)} fundos para {destino} ({n_ia} diagnósticos de IA)")


if __name__ == "__main__":
    exportar(Path(sys.argv[1] if len(sys.argv) > 1 else "../frontend/public/data").resolve())
