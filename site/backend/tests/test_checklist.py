"""Fase 3: checklist de triagem."""
import pandas as pd

from app import config  # noqa: F401  (raiz no sys.path)
from fiis_common import carregar_criterios  # noqa: E402
from gerar_dados_site import anexar_checklist, avaliar_fundo, classificar_valor  # noqa: E402

CFG = {
    "regras_sinal": {"verde_nota_minima": 85, "vermelho_nota_abaixo_de": 60, "cobertura_minima": 0.6},
    "criterios": [
        {"id": "pvp", "nome": "P/VP", "campo": "P_VP", "verde": {"min": 0.7, "max": 1.0},
         "amarelo": {"min": 0.5, "max": 1.1}, "peso": 2},
        {"id": "dy", "nome": "DY", "campo": "DY_12m_vs_Pares_pp", "verde": {"min": 0, "max": 4},
         "amarelo": {"min": -1.5, "max": 7}, "peso": 2},
        {"id": "liq", "nome": "Liquidez", "campo": "Volume_Financeiro_Medio", "verde": {"min": 1e6, "max": None},
         "amarelo": {"min": 3e5, "max": None}, "peso": 1, "eliminatorio": True},
        {"id": "vac", "nome": "Vacância", "campo": "Vacancia_%", "verde": {"min": None, "max": 7},
         "amarelo": {"min": None, "max": 15}, "peso": 1, "aplica_a": ["Tijolo"]},
    ],
}


def test_faixas():
    c = CFG["criterios"][0]
    assert classificar_valor(0.9, c) == "verde"
    assert classificar_valor(1.0, c) == "verde"      # limites inclusivos
    assert classificar_valor(1.05, c) == "amarelo"
    assert classificar_valor(0.6, c) == "amarelo"
    assert classificar_valor(0.41, c) == "vermelho"  # desconto grande demais
    assert classificar_valor(None, c) == "sem_dado"
    assert classificar_valor(float("nan"), c) == "sem_dado"


def test_nota_e_sinal_verde():
    r = avaliar_fundo({"Tipo_Gestao": "Tijolo", "P_VP": 0.9, "DY_12m_vs_Pares_pp": 1,
                       "Volume_Financeiro_Medio": 5e6, "Vacancia_%": 3}, CFG)
    assert r["Checklist_Nota"] == 100 and r["Checklist_Sinal"] == "verde"
    assert len(r["Checklist"]) == 4


def test_criterio_so_para_tijolo():
    r = avaliar_fundo({"Tipo_Gestao": "Papel", "P_VP": 0.9, "DY_12m_vs_Pares_pp": 1,
                       "Volume_Financeiro_Medio": 5e6, "Vacancia_%": 50}, CFG)
    assert [i["id"] for i in r["Checklist"]] == ["pvp", "dy", "liq"]
    assert r["Checklist_Sinal"] == "verde"


def test_amarelo_vale_meio_ponto():
    # pvp amarelo (2 * 0,5) + dy verde (2) + liq verde (1) = 4 de 5 = 80
    r = avaliar_fundo({"Tipo_Gestao": "Papel", "P_VP": 1.05, "DY_12m_vs_Pares_pp": 1,
                       "Volume_Financeiro_Medio": 5e6}, CFG)
    assert r["Checklist_Nota"] == 80 and r["Checklist_Sinal"] == "amarelo"


def test_eliminatorio_derruba_sinal_mesmo_com_nota_alta():
    r = avaliar_fundo({"Tipo_Gestao": "Papel", "P_VP": 0.9, "DY_12m_vs_Pares_pp": 1,
                       "Volume_Financeiro_Medio": 1e5}, CFG)
    assert r["Checklist_Nota"] == 80
    assert r["Checklist_Sinal"] == "vermelho"


def test_dy_alto_demais_vs_pares_e_vermelho():
    r = avaliar_fundo({"Tipo_Gestao": "Papel", "P_VP": 0.41, "DY_12m_vs_Pares_pp": 8.9,
                       "Volume_Financeiro_Medio": 5e6}, CFG)
    assert {i["id"]: i["status"] for i in r["Checklist"]} == {"pvp": "vermelho", "dy": "vermelho", "liq": "verde"}
    assert r["Checklist_Sinal"] == "vermelho"


def test_poucos_dados_fica_cinza():
    r = avaliar_fundo({"Tipo_Gestao": "Papel", "Volume_Financeiro_Medio": 5e6}, CFG)
    assert r["Checklist_Cobertura_%"] == 20
    assert r["Checklist_Sinal"] == "cinza"


def test_anexar_e_sem_criterios():
    snap = pd.DataFrame([{"Ticker": "AAAA11", "Tipo_Gestao": "Papel", "P_VP": 0.9, "DY_12m_vs_Pares_pp": 0,
                          "Volume_Financeiro_Medio": 5e6}])
    assert anexar_checklist(snap, CFG).iloc[0]["Checklist_Sinal"] == "verde"
    assert anexar_checklist(snap, {"criterios": []}).iloc[0]["Checklist_Sinal"] == "cinza"


def test_arquivo_de_criterios_do_projeto_e_valido():
    cfg = carregar_criterios()
    assert len(cfg["criterios"]) >= 5
    ids = [c["id"] for c in cfg["criterios"]]
    assert len(ids) == len(set(ids))
    for c in cfg["criterios"]:
        assert {"id", "nome", "campo", "verde", "amarelo", "peso"} <= set(c)
