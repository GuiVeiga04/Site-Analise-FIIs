"""Fase 2: leitura das fontes (sem rede, com arquivos simulados no formato
real) e métricas de fundamentos."""
import io
import zipfile

import pandas as pd
import pytest

from app import config  # noqa: F401  (raiz no sys.path)
import coletar_fundamentos as cf  # noqa: E402
from gerar_dados_site import anexar_fundamentos, indicadores_recentes  # noqa: E402

FUNDOS = [
    {"ticker": "HGLG11", "nome": "CSHG Logística"},
    {"ticker": "MXRF11", "nome": "Maxi Renda"},
    {"ticker": "KNCR11", "nome": "Kinea Rendimentos", "cnpj": "16.706.958/0001-32"},
    {"ticker": "PCIP11", "nome": "Patria Crédito Imobiliário (ex-CVBI11)"},
]

GERAL = """Tipo_Fundo_Classe;CNPJ_Fundo_Classe;Data_Referencia;Versao;Data_Entrega;Nome_Fundo_Classe;Codigo_ISIN;Quantidade_Cotas_Emitidas;Mandato;Segmento_Atuacao
FII;11.728.688/0001-47;2025-07-01;1;2025-08-20;CSHG LOGISTICA;BRHGLGCTF004;33000000;Renda;Logística
FII;11.728.688/0001-47;2026-07-01;1;2026-08-20;CSHG LOGISTICA;BRHGLGCTF004;33800000;Renda;Logística
FII;11.728.688/0001-47;2026-07-01;2;2026-08-25;CSHG LOGISTICA;BRHGLGCTF004;33800000;Renda;Logística
FII;97.521.225/0001-25;2026-07-01;1;2026-08-20;MAXI RENDA;BRMXRFCTF002;400000000;Títulos e Val. Mob.;Títulos e Val. Mob.
FII;16.706.958/0001-32;2026-07-01;1;2026-08-20;KINEA RENDIMENTOS;;100000000;Títulos e Val. Mob.;Títulos e Val. Mob.
FII;99.999.999/0001-99;2026-07-01;1;2026-08-20;OUTRO FUNDO;BRXXXXCTF000;1000;Renda;Lajes
FII;63.134.454/0001-75;2026-07-01;1;2026-08-20;OUTRO FUNDO COM ISIN PARECIDO;BRHGLGCTF999;1000;Renda;Outros
FII;22.222.222/0001-22;2026-07-01;1;2026-08-20;PATRIA CREDITO IMOBILIARIO INDICE DE PRECOS FII;BRCVBICTF001;1000000;Títulos e Val. Mob.;Títulos e Val. Mob.
"""
COMPL = """CNPJ_Fundo_Classe;Data_Referencia;Versao;Data_Informacao_Numero_Cotistas;Total_Numero_Cotistas;Valor_Ativo;Patrimonio_Liquido;Cotas_Emitidas;Valor_Patrimonial_Cotas
11.728.688/0001-47;2025-07-01;1;2025-07-31;400000;5500000000;5280000000;33000000;160.00
11.728.688/0001-47;2026-07-01;1;2026-07-31;450000;5600000000;5400000000;33800000;150.00
11.728.688/0001-47;2026-07-01;2;2026-07-31;450000;5600000000;5408000000;33800000;160.00
97.521.225/0001-25;2026-07-01;1;2026-07-31;1200000;4000000000;3700000000;400000000;
16.706.958/0001-32;2026-07-01;1;2026-07-31;300000;10000000000;9800000000;100000000;98.00
63.134.454/0001-75;2026-07-01;1;2026-07-31;1;1000;750;1000;0.75
22.222.222/0001-22;2026-07-01;1;2026-07-31;90000;1000000000;900000000;1000000;90.00
"""

HTML_FUNDAMENTUS = """<table><thead><tr><th>Papel</th><th>Segmento</th><th>Cotação</th><th>FFO Yield</th>
<th>Dividend Yield</th><th>P/VP</th><th>Valor de Mercado</th><th>Liquidez</th><th>Qtd de imóveis</th>
<th>Preço do m2</th><th>Aluguel por m2</th><th>Cap Rate</th><th>Vacância Média</th></tr></thead><tbody>
<tr><td>HGLG11</td><td>Logística</td><td>147,60</td><td>7,55%</td><td>8,97%</td><td>0,89</td><td>6.728.020.000</td><td>22.213.500</td><td>37</td><td>3.035,73</td><td>278,00</td><td>9,16%</td><td>2,41%</td></tr>
<tr><td>KNCR11</td><td>Títulos</td><td>106,16</td><td>10,67%</td><td>13,16%</td><td>1,03</td><td>11.368.600.000</td><td>21.781.400</td><td>0</td><td>0,00</td><td>0,00</td><td>0,00%</td><td>0,00%</td></tr>
<tr><td>ABCD11</td><td>Outro</td><td>10,00</td><td>1,00%</td><td>1,00%</td><td>1,00</td><td>1</td><td>1</td><td>1</td><td>1</td><td>1</td><td>1,00%</td><td>1,00%</td></tr>
</tbody></table>"""


def _zip_cvm() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("inf_mensal_fii_geral_2026.csv", GERAL.encode("latin-1"))
        z.writestr("inf_mensal_fii_complemento_2026.csv", COMPL.encode("latin-1"))
        z.writestr("inf_mensal_fii_ativo_passivo_2026.csv", "CNPJ_Fundo_Classe;Data_Referencia\n")
    return buf.getvalue()


def test_cvm_isin_versao_e_vp_calculado():
    geral, compl = cf.ler_zip_cvm(_zip_cvm())
    df = cf.processar_cvm(geral, compl, FUNDOS)
    assert set(df["Ticker"]) == {"HGLG11", "MXRF11", "KNCR11", "PCIP11"}  # KNCR11 via cnpj do config
    cnpj = df.groupby("Ticker")["CNPJ"].first()
    # Dois CNPJs com ISIN "HGLG": vence o de mais cotistas (caso real do TRXF11)
    assert cnpj["HGLG11"] == "11.728.688/0001-47"
    # PCIP11 mantém ISIN do ticker antigo (CVBI): achado pelo nome
    assert cnpj["PCIP11"] == "22.222.222/0001-22"
    hglg = df[df["Ticker"] == "HGLG11"].set_index("Data_Referencia")
    assert len(hglg) == 2
    # Versão 2 do informe de jul/26 substitui a 1
    assert hglg.loc["2026-07-01", "VP_Cota"] == 160.0
    assert hglg.loc["2026-07-01", "Patrimonio_Liquido"] == 5_408_000_000
    # MXRF11 veio sem VP informado: PL ÷ cotas
    mxrf = df[df["Ticker"] == "MXRF11"].iloc[0]
    assert mxrf["VP_Cota"] == pytest.approx(9.25)


def test_fundamentus_numeros_e_papel_sem_vacancia():
    df = cf.processar_fundamentus(HTML_FUNDAMENTUS, {"HGLG11", "KNCR11"}).set_index("Ticker")
    assert list(df.index) == ["HGLG11", "KNCR11"]
    assert df.loc["HGLG11", "Vacancia_%"] == pytest.approx(2.41)
    assert df.loc["HGLG11", "Cap_Rate_%"] == pytest.approx(9.16)
    assert df.loc["HGLG11", "P_VP_Fundamentus"] == pytest.approx(0.89)
    assert df.loc["HGLG11", "Valor_Mercado"] == 6_728_020_000
    assert pd.isna(df.loc["KNCR11", "Vacancia_%"])  # papel: 0,00% vira vazio


def test_bcb():
    df = cf.processar_bcb("CDI_aa", [{"data": "22/09/2026", "valor": "13.60"}, {"data": "23/09/2026", "valor": "13.65"}])
    ind = indicadores_recentes(df)
    assert ind["CDI_aa"]["valor"] == 13.65


def _snapshot():
    return pd.DataFrame([
        {"Ticker": "HGLG11", "Preco_Fechamento_R$": 144.0, "DY_12m_%": 9.0, "Segmento": "Logística", "Tipo_Gestao": "Tijolo", "Grupo_Pares": "Tijolo"},
        {"Ticker": "MXRF11", "Preco_Fechamento_R$": 9.0, "DY_12m_%": 13.0, "Segmento": "CRI", "Tipo_Gestao": "Papel", "Grupo_Pares": "Papel"},
        {"Ticker": "KNCR11", "Preco_Fechamento_R$": 106.0, "DY_12m_%": 13.2, "Segmento": "CRI", "Tipo_Gestao": "Papel", "Grupo_Pares": "Papel"},
        {"Ticker": "BCIA11", "Preco_Fechamento_R$": 87.0, "DY_12m_%": None, "Segmento": "FoF", "Tipo_Gestao": "FoF", "Grupo_Pares": "FoF"},
    ])


def test_anexar_fundamentos_completo():
    geral, compl = cf.ler_zip_cvm(_zip_cvm())
    cvm = cf.processar_cvm(geral, compl, FUNDOS)
    fund = cf.processar_fundamentus(HTML_FUNDAMENTUS, {"HGLG11", "KNCR11"})
    fund["Data_Coleta"] = pd.to_datetime(fund["Data_Coleta"])
    ind = pd.concat([
        cf.processar_bcb("CDI_aa", [{"data": "23/09/2026", "valor": "14.00"}]),
        cf.processar_bcb("IPCA_12m", [{"data": "01/08/2026", "valor": "4.00"}]),
    ])
    r = anexar_fundamentos(_snapshot(), cvm, fund, ind).set_index("Ticker")

    assert r.loc["HGLG11", "P_VP"] == 0.9            # 144 / 160 (nosso preço, VP da CVM)
    assert r.loc["HGLG11", "Fonte_P_VP"] == "CVM"
    assert r.loc["HGLG11", "VP_Var_12m_%"] == 0.0    # 160 -> 160
    assert r.loc["HGLG11", "Cotistas"] == 450000
    assert r.loc["HGLG11", "Cotistas_Var_12m_%"] == 12.5
    assert r.loc["HGLG11", "Vacancia_%"] == pytest.approx(2.41)
    assert r.loc["MXRF11", "P_VP"] == pytest.approx(0.97)  # 9 / 9.25
    assert pd.isna(r.loc["MXRF11", "VP_Var_12m_%"])  # só 1 mês de informe
    # Spread contra CDI líquido: 13 - 14 * 0.85 = 1.1
    assert r.loc["MXRF11", "Spread_CDI_Liquido_pp"] == pytest.approx(1.1)
    # DY real: 1.13 / 1.04 - 1 = 8.65%
    assert r.loc["MXRF11", "DY_Real_%"] == pytest.approx(8.65)
    # Pares Papel: mediana de 0.97 e 1.08 = 1.025
    assert r.loc["KNCR11", "P_VP_vs_Pares"] == pytest.approx(0.06, abs=0.01)
    assert pd.isna(r.loc["BCIA11", "P_VP"])


def test_fundamentus_e_reserva_do_p_vp():
    fund = cf.processar_fundamentus(HTML_FUNDAMENTUS, {"HGLG11"})
    fund["Data_Coleta"] = pd.to_datetime(fund["Data_Coleta"])
    r = anexar_fundamentos(_snapshot(), pd.DataFrame(), fund, pd.DataFrame()).set_index("Ticker")
    assert r.loc["HGLG11", "P_VP"] == 0.89
    assert r.loc["HGLG11", "Fonte_P_VP"] == "Fundamentus"
    assert pd.isna(r.loc["HGLG11", "Spread_CDI_Liquido_pp"])


def test_sem_nenhuma_fonte():
    r = anexar_fundamentos(_snapshot(), pd.DataFrame(), pd.DataFrame(), pd.DataFrame())
    assert r["P_VP"].isna().all()
    assert len(r) == 4


def test_cap_rate_zero_vira_vazio():
    html = HTML_FUNDAMENTUS.replace("<td>KNCR11</td>", "<td>MXRF11</td>").replace(
        "<td>0</td><td>0,00</td><td>0,00</td><td>0,00%</td>", "<td>2</td><td>0,00</td><td>0,00</td><td>0,00%</td>")
    df = cf.processar_fundamentus(html, {"MXRF11"}).set_index("Ticker")
    assert pd.isna(df.loc["MXRF11", "Cap_Rate_%"])


def test_p_vp_implausivel_cai_para_fundamentus():
    cvm = pd.DataFrame({"Ticker": ["HGLG11"], "Data_Referencia": pd.to_datetime(["2026-07-01"]),
                        "VP_Cota": [0.75], "Patrimonio_Liquido": [1.0], "Cotistas": [1]})
    fund = cf.processar_fundamentus(HTML_FUNDAMENTUS, {"HGLG11"})
    fund["Data_Coleta"] = pd.to_datetime(fund["Data_Coleta"])
    r = anexar_fundamentos(_snapshot(), cvm, fund, pd.DataFrame()).set_index("Ticker")
    assert r.loc["HGLG11", "P_VP"] == 0.89
    assert r.loc["HGLG11", "Fonte_P_VP"] == "Fundamentus"
    assert pd.isna(r.loc["HGLG11", "Cotistas"])


def test_indicador_com_data_futura_ignorado():
    df = pd.DataFrame({"Data": pd.to_datetime(["2020-01-01", "2099-01-01"]), "Indicador": "Selic_meta_aa", "Valor": [10.0, 99.0]})
    assert indicadores_recentes(df)["Selic_meta_aa"]["valor"] == 10.0
