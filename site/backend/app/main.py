"""API do site de FIIs.

Rodar em dev (a partir de site/backend):
    uvicorn app.main:app --reload

Endpoints (cada um tem um JSON estático equivalente, gerado por
scripts/exportar_estatico.py, para o deploy no GitHub Pages):
    GET /api/meta                         -> data/meta.json
    GET /api/snapshot                     -> data/snapshot.json
    GET /api/fundos/{ticker}/historico    -> data/historico/{ticker}.json
    GET /api/fundos/{ticker}/dividendos   -> data/dividendos/{ticker}.json
    GET /api/ia/status                    -> (só local) IA disponível? qual modelo?
    POST /api/ia/diagnostico              -> (só local) texto do Claude em streaming
                                             no Pages: data/ia/{ticker}.json, gerado 1x/dia
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import ia, metrics
from .config import CORS_ORIGINS
from .schemas import FundoSnapshot, Meta, PontoDividendo, PontoHistorico

app = FastAPI(title="FIIs API", version="0.3.0")
app.add_middleware(
    CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["GET", "POST"], allow_headers=["*"]
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/meta", response_model=Meta)
def meta():
    return metrics.calcular_meta()


@app.get("/api/snapshot", response_model=list[FundoSnapshot])
def snapshot(tipo_gestao: str | None = None, segmento: str | None = None):
    """Filtros opcionais aplicados DEPOIS do cálculo — a classificação de
    liquidez continua relativa ao grupo inteiro (igual ao Power BI)."""
    dados = metrics.calcular_snapshot()
    if tipo_gestao:
        dados = [d for d in dados if d["tipo_gestao"] == tipo_gestao]
    if segmento:
        dados = [d for d in dados if d["segmento"] == segmento]
    return dados


@app.get("/api/fundos/{ticker}/historico", response_model=list[PontoHistorico])
def historico(ticker: str):
    serie = metrics.calcular_historico(ticker.upper())
    if not serie:
        raise HTTPException(404, f"Ticker {ticker} não encontrado")
    return serie


@app.get("/api/fundos/{ticker}/dividendos", response_model=list[PontoDividendo])
def dividendos(ticker: str):
    serie = metrics.calcular_dividendos(ticker.upper())
    if serie is None:
        raise HTTPException(404, f"Ticker {ticker} não encontrado")
    return serie


class PedidoIA(BaseModel):
    tickers: list[str]           # 1 fundo = diagnóstico; 2 fundos = comparação
    modelo: str | None = None    # opcional; padrão = FIIS_MODELO_IA ou Haiku 4.5


@app.get("/api/ia/status")
def ia_status() -> dict:
    try:
        modelo = ia.modelo_configurado()
    except ValueError:
        modelo = None
    return {"disponivel": ia.disponivel() and modelo is not None, "modelo": modelo}


@app.post("/api/ia/diagnostico")
def ia_diagnostico(pedido: PedidoIA):
    tickers = [t.upper() for t in pedido.tickers]
    if not 1 <= len(tickers) <= 2 or len(set(tickers)) != len(tickers):
        raise HTTPException(400, "Informe 1 fundo (diagnóstico) ou 2 fundos diferentes (comparação)")
    if not ia.disponivel():
        raise HTTPException(503, "ANTHROPIC_API_KEY não configurada no servidor")
    try:
        modelo = ia.modelo_configurado(pedido.modelo)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    mensagem = metrics.mensagem_ia(tickers)
    if mensagem is None:
        raise HTTPException(404, "Fundo não encontrado")

    def corpo():
        try:
            yield from ia.gerar_stream(mensagem, modelo)
        except Exception as e:  # erro no meio do stream: avisa no próprio texto
            yield f"\n\n[Erro ao gerar o diagnóstico: {type(e).__name__}: {e}]"

    return StreamingResponse(corpo(), media_type="text/plain; charset=utf-8",
                             headers={"X-Modelo": modelo, "Cache-Control": "no-cache"})
