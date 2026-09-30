import os
import tempfile

os.environ["FIIS_DB_PATH"] = os.path.join(tempfile.mkdtemp(), "teste.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.ingest import carregar_banco  # noqa: E402
from app.main import app  # noqa: E402

carregar_banco()
client = TestClient(app)


def test_meta():
    r = client.get("/api/meta").json()
    assert r["total_fundos"] == 29
    assert r["ultimo_pregao"] >= "2026-09-10"
    assert set(r["tipos_gestao"]) >= {"Papel", "Tijolo"}


def test_snapshot_ordenado_e_classificado():
    dados = client.get("/api/snapshot").json()
    assert len(dados) == 29
    vols = [d["volume_financeiro_medio"] for d in dados]
    assert vols == sorted(vols, reverse=True)
    assert {d["liquidez"] for d in dados} <= {"Alta", "Média", "Baixa"}
    assert [d["rank_liquidez"] for d in dados] == list(range(1, 30))


def test_filtro_nao_muda_classificacao():
    todos = {d["ticker"]: d["liquidez"] for d in client.get("/api/snapshot").json()}
    papel = client.get("/api/snapshot", params={"tipo_gestao": "Papel"}).json()
    assert papel and all(d["tipo_gestao"] == "Papel" for d in papel)
    assert all(todos[d["ticker"]] == d["liquidez"] for d in papel)


def test_historico():
    serie = client.get("/api/fundos/hglg11/historico").json()
    assert len(serie) >= 2
    assert serie[0]["variacao_dia_pct"] is None
    assert client.get("/api/fundos/XXXX11/historico").status_code == 404


def test_snapshot_tem_campos_de_renda():
    d = client.get("/api/snapshot").json()[0]
    for campo in ("dy_12m_pct", "dy_ultimo_pct", "ultimo_dividendo", "data_ultimo_dividendo",
                  "retorno_total_12m_pct", "dy_12m_vs_pares_pp", "pagamentos_12m"):
        assert campo in d


def test_dividendos():
    serie = client.get("/api/fundos/hglg11/dividendos").json()
    assert isinstance(serie, list)
    assert serie == sorted(serie, key=lambda p: p["data_ex"])
    assert client.get("/api/fundos/XXXX11/dividendos").status_code == 404


def test_snapshot_tem_campos_de_fundamentos_e_meta_indicadores():
    d = client.get("/api/snapshot").json()[0]
    for campo in ("p_vp", "vp_cota", "cotistas", "vacancia_pct", "spread_cdi_liquido_pp", "dy_real_pct"):
        assert campo in d
    assert isinstance(client.get("/api/meta").json()["indicadores"], dict)


def test_snapshot_tem_checklist():
    d = client.get("/api/snapshot").json()
    assert all(x["checklist_sinal"] in {"verde", "amarelo", "vermelho", "cinza"} for x in d)
    assert all(isinstance(x["checklist"], list) for x in d)
