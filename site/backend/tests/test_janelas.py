"""Com histórico longo (carga de 5 anos), liquidez e volatilidade usam só os
últimos 90 dias e a variação do período só os últimos 12 meses."""
import numpy as np
import pandas as pd

from app import config  # noqa: F401  (raiz no sys.path)
from gerar_dados_site import JANELA_LIQUIDEZ_DIAS, enriquecer, montar_snapshot  # noqa: E402


def _historico():
    datas = pd.bdate_range("2021-11-01", "2026-11-06")
    n = len(datas)
    preco = np.where(datas < pd.Timestamp("2025-11-06"), 50.0, 100.0)   # dobrou há ~12 meses
    preco[-1] = 110.0
    volume = np.where(datas > datas[-1] - pd.Timedelta(days=JANELA_LIQUIDEZ_DIAS), 10, 1000)  # liquidez caiu no fim
    return pd.DataFrame({
        "Data_Coleta": datas, "Data_Pregao": datas, "Ticker": "AAAA11", "Nome_Fundo": "A",
        "Preco_Fechamento_R$": preco, "Volume_Ultimo_Dia": volume,
    }), n


def test_janelas_do_snapshot():
    df, n = _historico()
    snap = montar_snapshot(enriquecer(df, {"AAAA11": {"gestora": "", "tipo_gestao": "Tijolo", "segmento": "X"}}))
    s = snap.iloc[0]
    assert s["Qtde_Pregoes_Coletados"] == n                          # histórico todo
    assert s["Variacao_Periodo_%"] == 10.0                           # 100 -> 110 nos últimos 12 meses (não 50 -> 110)
    assert s["Preco_Min_Periodo"] == 100.0 and s["Preco_Max_Periodo"] == 110.0
    # volume financeiro recente: 10 cotas × ~100 (e não a média de 5 anos com 1000 cotas × 50)
    assert 1000 <= s["Volume_Financeiro_Medio"] <= 1100
