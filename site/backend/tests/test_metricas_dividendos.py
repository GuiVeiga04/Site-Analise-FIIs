"""Testes das métricas de renda com dados controlados (não dependem dos CSVs)."""
import pandas as pd
import pytest

from app import config  # noqa: F401  (raiz no sys.path)
from gerar_dados_site import anexar_metricas_dividendos, serie_dividendos  # noqa: E402

REF = pd.Timestamp("2026-09-18")


def _historico(ticker, preco_hoje=100.0, preco_12m=90.0):
    datas = pd.bdate_range(REF - pd.DateOffset(months=13), REF)
    precos = [preco_12m if d <= REF - pd.DateOffset(months=12) else preco_hoje for d in datas]
    return pd.DataFrame({"Ticker": ticker, "Data_Pregao": datas, "Preco_Fechamento_R$": precos})


def _snapshot(linhas):
    return pd.DataFrame([
        {"Ticker": t, "Data_Pregao": REF, "Preco_Fechamento_R$": p, "Segmento": seg, "Tipo_Gestao": tipo}
        for t, p, seg, tipo in linhas
    ])


def _divs(ticker, valores, fim=REF):
    datas = pd.date_range(end=fim.replace(day=1), periods=len(valores), freq="MS")
    return pd.DataFrame({"Ticker": ticker, "Data_Ex": datas, "Valor_R$": valores})


def test_dy_12m_ultimo_e_retorno_total():
    snap = _snapshot([("AAAA11", 100.0, "Logística", "Tijolo")])
    div = _divs("AAAA11", [0.8] * 14)
    r = anexar_metricas_dividendos(snap, _historico("AAAA11"), div).iloc[0]
    assert r["Pagamentos_12m"] == 12
    assert r["DY_12m_%"] == pytest.approx(9.6)
    assert r["DY_Ultimo_%"] == pytest.approx(0.8)
    assert r["Ultimo_Dividendo_R$"] == pytest.approx(0.8)
    assert r["Estabilidade_CV_%"] == 0
    assert r["Quedas_Dividendo_12m"] == 0
    assert r["Tendencia_Dividendo_%"] == 0
    # (100 + 9.6) / 90 - 1
    assert r["Retorno_Total_12m_%"] == pytest.approx(21.78, abs=0.01)
    assert r["Variacao_Preco_12m_%"] == pytest.approx(11.11, abs=0.01)


def test_corte_persistente_conta_uma_queda_e_tendencia_negativa():
    snap = _snapshot([("BBBB11", 10.0, "CRI", "Papel")])
    div = _divs("BBBB11", [0.10] * 10 + [0.07] * 4)
    r = anexar_metricas_dividendos(snap, _historico("BBBB11", 10, 10), div).iloc[0]
    assert r["Quedas_Dividendo_12m"] == 1
    assert r["Tendencia_Dividendo_%"] < -20


def test_extra_semestral_nao_vira_queda():
    snap = _snapshot([("CCCC11", 100.0, "Lajes", "Tijolo")])
    valores = [0.8] * 14
    valores[5] = 1.6  # rendimento extraordinário
    r = anexar_metricas_dividendos(snap, _historico("CCCC11"), _divs("CCCC11", valores)).iloc[0]
    assert r["Quedas_Dividendo_12m"] == 0


def test_fundo_sem_dividendos_e_pares():
    snap = _snapshot([
        ("AAAA11", 100.0, "Logística", "Tijolo"),
        ("BBBB11", 100.0, "Logística", "Tijolo"),
        ("CCCC11", 100.0, "Logística", "Tijolo"),
        ("DDDD11", 100.0, "Shopping", "Tijolo"),
    ])
    hist = pd.concat([_historico(t) for t in snap["Ticker"]])
    div = pd.concat([_divs("AAAA11", [0.7] * 12), _divs("BBBB11", [0.8] * 12), _divs("CCCC11", [0.9] * 12)])
    r = anexar_metricas_dividendos(snap, hist, div).set_index("Ticker")
    assert r.loc["AAAA11", "Grupo_Pares"] == "Logística"
    assert r.loc["DDDD11", "Grupo_Pares"] == "Tijolo"  # segmento com < 3 fundos
    assert r.loc["BBBB11", "DY_12m_vs_Pares_pp"] == 0
    assert r.loc["CCCC11", "DY_12m_vs_Pares_pp"] == pytest.approx(1.2)
    assert pd.isna(r.loc["DDDD11", "DY_12m_%"])
    assert r.loc["DDDD11", "Pagamentos_12m"] == 0


def test_sem_arquivo_de_dividendos():
    snap = _snapshot([("AAAA11", 100.0, "Logística", "Tijolo")])
    vazio = pd.DataFrame(columns=["Ticker", "Data_Ex", "Valor_R$"])
    r = anexar_metricas_dividendos(snap, _historico("AAAA11"), vazio).iloc[0]
    assert pd.isna(r["DY_12m_%"])
    assert r["Variacao_Preco_12m_%"] == pytest.approx(11.11, abs=0.01)


def test_historico_curto_nao_inventa_retorno_12m():
    snap = _snapshot([("AAAA11", 100.0, "Logística", "Tijolo")])
    hist = _historico("AAAA11").tail(20)
    r = anexar_metricas_dividendos(snap, hist, _divs("AAAA11", [0.8] * 12)).iloc[0]
    assert pd.isna(r["Retorno_Total_12m_%"])
    assert r["DY_12m_%"] == pytest.approx(9.6)


def test_serie_dividendos_usa_preco_da_vespera():
    hist = pd.DataFrame({
        "Ticker": "AAAA11",
        "Data_Pregao": pd.to_datetime(["2026-08-28", "2026-08-31", "2026-09-01"]),
        "Preco_Fechamento_R$": [99.0, 100.0, 97.0],
    })
    div = pd.DataFrame({"Ticker": ["AAAA11"], "Data_Ex": pd.to_datetime(["2026-09-01"]), "Valor_R$": [1.0]})
    s = serie_dividendos(div, hist, "AAAA11").iloc[0]
    assert s["Preco_Data_Com"] == 100.0
    assert s["DY_Pagamento_pct"] == 1.0
