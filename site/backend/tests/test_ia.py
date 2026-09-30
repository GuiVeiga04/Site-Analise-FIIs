"""Diagnóstico de IA: testado com um cliente falso (sem chamar a API de verdade)."""
import json
import os
import tempfile
from contextlib import contextmanager

os.environ.setdefault("FIIS_DB_PATH", os.path.join(tempfile.mkdtemp(), "teste_ia.db"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import ia, metrics  # noqa: E402
from app.ingest import carregar_banco  # noqa: E402
from app.main import app  # noqa: E402

carregar_banco()
client = TestClient(app)


class ClienteFalso:
    """Imita anthropic.Anthropic().messages.stream(...) e guarda o que recebeu."""

    def __init__(self, pedacos=("## Resumo\n", "Fundo ", "ok.")):
        self.pedacos = pedacos
        self.chamadas = []
        self.messages = self

    @contextmanager
    def stream(self, **kwargs):
        self.chamadas.append(kwargs)

        class S:
            text_stream = iter(self.pedacos)

        yield S()


def test_status_sem_chave(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = client.get("/api/ia/status").json()
    assert r == {"disponivel": False, "modelo": "claude-haiku-4-5-20251001"}
    assert client.post("/api/ia/diagnostico", json={"tickers": ["HGLG11"]}).status_code == 503


def test_validacoes(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "teste")
    assert client.post("/api/ia/diagnostico", json={"tickers": []}).status_code == 400
    assert client.post("/api/ia/diagnostico", json={"tickers": ["A", "B", "C"]}).status_code == 400
    assert client.post("/api/ia/diagnostico", json={"tickers": ["HGLG11", "hglg11"]}).status_code == 400
    assert client.post("/api/ia/diagnostico", json={"tickers": ["XXXX11"]}).status_code == 404
    assert client.post("/api/ia/diagnostico", json={"tickers": ["HGLG11"], "modelo": "gpt-4"}).status_code == 400


def test_stream_diagnostico_e_comparacao(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "teste")
    falso = ClienteFalso()
    monkeypatch.setattr(ia, "_cliente", lambda: falso)
    r = client.post("/api/ia/diagnostico", json={"tickers": ["hglg11"]})
    assert r.status_code == 200 and r.text == "## Resumo\nFundo ok."
    assert r.headers["x-modelo"] == "claude-haiku-4-5-20251001"
    kw = falso.chamadas[-1]
    assert kw["model"] == "claude-haiku-4-5-20251001" and kw["system"] == ia.SISTEMA
    assert '"ticker": "HGLG11"' in kw["messages"][0]["content"]
    assert "## Pontos fortes" in kw["messages"][0]["content"]

    r = client.post("/api/ia/diagnostico", json={"tickers": ["HGLG11", "MXRF11"], "modelo": "claude-sonnet-5"})
    assert r.status_code == 200
    msg = falso.chamadas[-1]["messages"][0]["content"]
    assert falso.chamadas[-1]["model"] == "claude-sonnet-5"
    assert "MXRF11" in msg and "Para qual perfil" in msg


def test_mensagem_so_com_dados_do_painel():
    msg = metrics.mensagem_ia(["HGLG11"])
    dados = json.loads(msg.split("```json\n")[1].split("\n```")[0])
    f = dados["fundos"][0]
    assert f["ticker"] == "HGLG11"
    assert "checklist" in f and "pares" in f and "rendimentos_recentes" in f
    assert all(p["ticker"] != "HGLG11" for p in f["pares"])
    assert metrics.mensagem_ia(["XXXX11"]) is None


def test_gerar_diarios_usa_cache(monkeypatch, tmp_path):
    from scripts import gerar_diagnosticos_ia as g

    monkeypatch.setattr(g, "PASTA_IA", tmp_path)
    falso = ClienteFalso(("texto",))
    r1 = g.gerar_todos(["HGLG11", "MXRF11"], cliente=falso)
    assert r1 == {"gerados": 2, "em_cache": 0, "falhas": 0}
    salvo = json.loads((tmp_path / "HGLG11.json").read_text(encoding="utf-8"))
    assert salvo["texto"] == "texto" and salvo["modelo"] == "claude-haiku-4-5-20251001" and salvo["hash"]
    r2 = g.gerar_todos(["HGLG11", "MXRF11"], cliente=falso)
    assert r2 == {"gerados": 0, "em_cache": 2, "falhas": 0}
    assert len(falso.chamadas) == 2  # a segunda rodada não chamou a API
    r3 = g.gerar_todos(["HGLG11"], forcar=True, cliente=falso)
    assert r3["gerados"] == 1


def test_modelo_invalido_no_ambiente(monkeypatch):
    monkeypatch.setenv("FIIS_MODELO_IA", "outro")
    with pytest.raises(ValueError):
        ia.modelo_configurado()
