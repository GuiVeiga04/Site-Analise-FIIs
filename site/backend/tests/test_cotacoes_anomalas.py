"""Filtro de cotações anômalas do Yahoo (fiis_common.remover_cotacoes_anomalas)."""
import numpy as np
import pandas as pd

from app import config  # noqa: F401  (raiz no sys.path)
from fiis_common import marcar_cotacoes_anomalas, remover_cotacoes_anomalas  # noqa: E402


def _serie(valores):
    rng = np.random.default_rng(0)
    return pd.Series([v * (1 + rng.normal(0, 0.004)) for v in valores])


def test_caso_xpml11_preco_cem_vezes_menor_por_3_dias():
    precos = _serie([110] * 20 + [1.07] * 3 + [110] * 20)
    marcas = marcar_cotacoes_anomalas(precos)
    assert list(marcas[marcas].index) == [20, 21, 22]


def test_caso_recr11_queda_de_28pct_por_4_dias_que_volta():
    precos = _serie([77] * 20 + [55.3, 55.4, 55.6, 55.8] + [77] * 20)
    marcas = marcar_cotacoes_anomalas(precos)
    assert list(marcas[marcas].index) == [20, 21, 22, 23]


def test_queda_de_verdade_que_se_mantem_nao_e_removida():
    # caiu 30% e ficou no novo patamar (ex: fundo em crise): é dado real
    precos = _serie([100] * 20 + [70] * 20)
    assert not marcar_cotacoes_anomalas(precos).any()


def test_queda_gradual_e_oscilacao_normal_nao_sao_removidas():
    assert not marcar_cotacoes_anomalas(_serie(np.linspace(100, 50, 60))).any()
    assert not marcar_cotacoes_anomalas(_serie([100] * 60)).any()
    # movimento de 12% que volta: grande, mas plausível
    assert not marcar_cotacoes_anomalas(_serie([100] * 20 + [88] * 3 + [100] * 20)).any()


def test_pontas_da_serie_nao_sao_avaliadas():
    # último pregão absurdo: ainda não há dias seguintes para confirmar a volta
    precos = _serie([100] * 20 + [1.0])
    assert not marcar_cotacoes_anomalas(precos).any()


def test_remover_por_fundo_e_sem_misturar_tickers():
    datas = pd.bdate_range("2026-01-01", periods=30)
    a = pd.DataFrame({"Ticker": "AAAA11", "Data_Pregao": datas, "Preco_Fechamento_R$": [10.0] * 30})
    b = pd.DataFrame({"Ticker": "BBBB11", "Data_Pregao": datas, "Preco_Fechamento_R$": [100.0] * 30})
    b.loc[15, "Preco_Fechamento_R$"] = 1.0
    df = remover_cotacoes_anomalas(pd.concat([a, b]))
    assert len(df) == 59
    assert (df[df.Ticker == "BBBB11"]["Preco_Fechamento_R$"] == 100).all()
    assert len(df[df.Ticker == "AAAA11"]) == 30


def test_atualizador_regrava_o_csv_sem_filtrar():
    # o CSV guarda o dado bruto; o filtro só vale na leitura
    from app.config import RAIZ_PROJETO
    codigo = (RAIZ_PROJETO / "atualizador_fiis.py").read_text(encoding="utf-8")
    assert "carregar_historico_limpo(remover_anomalias=False, volume_zero_como_vazio=False)" in codigo


def test_ingest_remove_do_banco_linha_que_saiu_da_limpeza(tmp_path, monkeypatch):
    """Banco antigo com a cotação errada do XPML11: depois do ingest ela some.
    (Antes o ingest só fazia upsert e a linha ruim ficava no SQLite.)"""
    from app import config as cfg
    from app import db as dbmod
    from app.ingest import carregar_banco

    banco = tmp_path / "teste.db"
    monkeypatch.setattr(cfg, "DB_PATH", banco)
    monkeypatch.setattr(dbmod, "DB_PATH", banco)
    carregar_banco()
    with dbmod.conectar(banco) as con:
        con.execute("INSERT OR REPLACE INTO cotacoes (ticker, data_pregao, data_coleta, preco, volume_cotas) "
                    "VALUES ('XPML11', '2026-01-14', '2026-01-14', 1.07, 1)")
    carregar_banco()
    with dbmod.conectar(banco) as con:
        linha = con.execute("SELECT preco FROM cotacoes WHERE ticker='XPML11' AND data_pregao='2026-01-14'").fetchone()
        menor = con.execute("SELECT MIN(preco) FROM cotacoes WHERE ticker='XPML11'").fetchone()[0]
    assert linha is None
    assert menor > 50
