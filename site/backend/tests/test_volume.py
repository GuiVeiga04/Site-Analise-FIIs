"""Volume zerado pelo Yahoo na coleta noturna (atualizador_fiis + fiis_common)."""
import numpy as np
import pandas as pd

from app import config  # noqa: F401  (raiz no sys.path)
import atualizador_fiis as atu  # noqa: E402
from fiis_common import remover_duplicatas_pregao  # noqa: E402


def _yahoo_falso(tickers, volumes):
    idx = pd.to_datetime(["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"])
    cols = pd.MultiIndex.from_product([tickers, ["Close", "Volume"]])
    dados = np.column_stack([np.array([[10.0 + i, v] for i, v in enumerate(volumes)])] * len(tickers))
    return pd.DataFrame(dados, index=idx, columns=cols)


def test_coleta_regrava_os_ultimos_pregoes(monkeypatch):
    monkeypatch.setattr(atu, "baixar_com_retentativa",
                        lambda tickers, **k: _yahoo_falso(tickers, [100, 200, 300, 400, 0]))
    df = atu.coletar_cotacoes({"AAAA11": "Fundo A", "BBBB11": "Fundo B"})
    assert len(df) == 10                       # 5 pregões x 2 fundos, não só o último
    a = df[df.Ticker == "AAAA11"].set_index("Data_Pregao")
    assert a.loc["2026-10-06", "Volume_Ultimo_Dia"] == 400
    assert a.loc["2026-10-07", "Volume_Ultimo_Dia"] == 0
    assert (df["Data_Coleta"] == df["Data_Coleta"].iloc[0]).all()


def _linhas(*regs):
    df = pd.DataFrame(regs, columns=["Data_Coleta", "Data_Pregao", "Ticker", "Preco_Fechamento_R$", "Volume_Ultimo_Dia"])
    df["Data_Coleta"] = pd.to_datetime(df["Data_Coleta"])
    df["Data_Pregao"] = pd.to_datetime(df["Data_Pregao"])
    return df


def test_volume_zerado_e_corrigido_na_coleta_seguinte():
    # 06/10 coletado à noite com volume 0; no dia seguinte o Yahoo já tem o volume
    df = remover_duplicatas_pregao(_linhas(
        ("2026-10-06", "2026-10-06", "AAAA11", 10.0, 0),
        ("2026-10-07", "2026-10-06", "AAAA11", 10.0, 54321),
    ))
    assert len(df) == 1 and df.iloc[0]["Volume_Ultimo_Dia"] == 54321


def test_regravar_nao_troca_volume_bom_por_zero():
    df = remover_duplicatas_pregao(_linhas(
        ("2026-10-06", "2026-10-02", "AAAA11", 10.0, 110468),
        ("2026-10-07", "2026-10-02", "AAAA11", 10.1, 0),
    ))
    linha = df.iloc[0]
    assert linha["Volume_Ultimo_Dia"] == 110468   # volume anterior aproveitado
    assert linha["Preco_Fechamento_R$"] == 10.1   # o resto vem da coleta mais nova


def test_leitura_trata_volume_zero_como_sem_dado(tmp_path, monkeypatch):
    import fiis_common
    csv = tmp_path / "h.csv"
    csv.write_text("Data_Coleta;Data_Pregao;Ticker;Nome_Fundo;Preco_Fechamento_R$;Volume_Ultimo_Dia\n"
                   "2026-10-02;2026-10-02;AAAA11;A;10;500\n2026-10-05;2026-10-05;AAAA11;A;10;0\n", encoding="utf-8")
    monkeypatch.setattr(fiis_common, "ARQUIVO_HISTORICO", csv)
    lido = fiis_common.carregar_historico_limpo()
    assert lido["Volume_Ultimo_Dia"].isna().sum() == 1
    bruto = fiis_common.carregar_historico_limpo(remover_anomalias=False, volume_zero_como_vazio=False)
    assert (bruto["Volume_Ultimo_Dia"] == 0).sum() == 1
