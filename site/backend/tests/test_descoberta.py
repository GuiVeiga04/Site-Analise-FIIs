"""Inclusão de todos os FIIs disponíveis (descobrir_fiis.py) e o que precisou
mudar para o pipeline aguentar centenas de fundos. Tudo sem rede."""
import json
import sqlite3

import numpy as np
import pandas as pd

from app import config  # noqa: F401  (raiz no sys.path)
import atualizador_fiis as atu  # noqa: E402
import coletar_fundamentos as cf  # noqa: E402
import descobrir_fiis as d  # noqa: E402
import fiis_common  # noqa: E402
from fiis_common import classificar_segmento, padronizar_segmento  # noqa: E402
from gerar_dados_site import grupo_pares  # noqa: E402
from test_fundamentos import HTML_FUNDAMENTUS, _zip_cvm  # noqa: E402


# ---------------------------------------------------------------- classificação

def test_classificacao_pelo_segmento_do_fundamentus():
    assert classificar_segmento("Títulos e Val. Mob.") == ("Recebíveis (CRI)", "Papel")
    assert classificar_segmento("Logística") == ("Logística", "Tijolo")
    assert classificar_segmento("Shoppings") == ("Shoppings", "Tijolo")
    assert classificar_segmento("Lajes Corporativas") == ("Lajes corporativas", "Tijolo")
    assert classificar_segmento("Escritórios") == ("Lajes corporativas", "Tijolo")  # "CRI" não casa dentro de "escritórios"
    assert classificar_segmento("Híbrido") == ("Híbrido", "Híbrido")
    assert classificar_segmento("Hospital") == ("Hospitais", "Tijolo")
    assert classificar_segmento("Outros") == ("Outros", "Híbrido")
    assert classificar_segmento("") == ("Outros", "Híbrido")
    # FoF pelo nome, mesmo com segmento "Títulos"
    assert classificar_segmento("Títulos e Val. Mob.", "KINEA FOF FII") == ("Fundo de Fundos", "FoF")


def test_segmento_padrao_dos_fundos_escolhidos_a_mao():
    # o tipo escolhido à mão manda: "FoF" no texto de um híbrido não o torna FoF
    assert padronizar_segmento("Multiestratégia (papel + tijolo + FoF)", "Híbrido") == "Híbrido"
    assert padronizar_segmento("CRI High Grade", "Papel") == "Recebíveis (CRI)"
    assert padronizar_segmento("Logística / Galpões Industriais", "Tijolo") == "Logística"
    assert padronizar_segmento("Renda Urbana / Industrial (sale-leaseback)", "Tijolo") == "Renda urbana / varejo"
    cfg = {f["ticker"]: f for f in fiis_common.carregar_config()}
    assert all(f["segmento_padrao"] for f in cfg.values())
    assert cfg["HGLG11"]["segmento_padrao"] == "Logística" and cfg["BCIA11"]["segmento_padrao"] == "Fundo de Fundos"


def test_grupo_de_pares_usa_segmento_padronizado():
    df = pd.DataFrame({
        "Ticker": ["A11", "B11", "C11", "D11", "E11"],
        "Segmento": ["Logística", "Logística / Galpões", "Galpões", "Shopping", "Shopping"],
        "Segmento_Padrao": ["Logística"] * 3 + ["Shoppings"] * 2,
        "Tipo_Gestao": ["Tijolo"] * 5,
    })
    # os 3 de logística ficam juntos apesar do texto diferente; shoppings (2) cai no tipo
    assert grupo_pares(df).tolist() == ["Logística"] * 3 + ["Tijolo"] * 2
    # sem a coluna padronizada (dados antigos), usa o segmento do config
    assert grupo_pares(df.drop(columns="Segmento_Padrao")).tolist() == ["Tijolo"] * 5


# ---------------------------------------------------------------- fontes

def test_lista_do_fundamentus():
    df = d.ler_lista_fundamentus(HTML_FUNDAMENTUS + HTML_FUNDAMENTUS.replace("HGLG11", "XPTO11B"))
    assert df["Ticker"].tolist() == ["HGLG11", "KNCR11", "ABCD11"]  # XPTO11B fora do padrão; sem duplicatas
    hglg = df.set_index("Ticker").loc["HGLG11"]
    assert hglg["Segmento_Fundamentus"] == "Logística" and hglg["Liquidez_Fundamentus"] == 22213500


def test_cadastro_cvm_por_raiz_do_isin():
    geral, compl = cf.ler_zip_cvm(_zip_cvm())
    cad = d.ler_cadastro_cvm(geral, compl).set_index("Raiz")
    # dois CNPJs com raiz HGLG: fica o de mais cotistas
    assert cad.loc["HGLG", "CNPJ"] == "11.728.688/0001-47" and cad.loc["HGLG", "Cotistas"] == 450000
    assert "MXRF" in cad.index and "CVBI" in cad.index
    assert "KNCR" not in cad.index  # sem ISIN no informe


def test_nome_curto():
    assert d.nome_curto("KINEA RENDIMENTOS IMOBILIARIOS FII RESPONSABILIDADE LIMITADA") == "Kinea Rendimentos Imobiliarios"
    assert d.nome_curto("BRESCO LOGISTICA FUNDO DE INVESTIMENTO IMOBILIÁRIO") == "Bresco Logistica"
    assert d.nome_curto("HSI - MALLS FII RESP. LIMITADA") == "HSI Malls"
    assert d.nome_curto("XP MALLS FII") == "XP Malls"
    assert d.nome_curto("FII TG ATIVO REAL") == "TG Ativo Real"
    assert d.nome_curto(None) == "" and d.nome_curto("") == ""


def _yahoo(tickers, linhas):
    """yf.download falso: {ticker_yf: [(data, close, volume), ...]}"""
    idx = sorted({pd.Timestamp(x[0]) for v in linhas.values() for x in v})
    cols = pd.MultiIndex.from_product([[t for t in tickers if t in linhas], ["Close", "Volume"]])
    dados = pd.DataFrame(np.nan, index=idx, columns=cols)
    for t, v in linhas.items():
        if t in tickers:
            for data, close, vol in v:
                dados.loc[pd.Timestamp(data), (t, "Close")] = close
                dados.loc[pd.Timestamp(data), (t, "Volume")] = vol
    return dados


def test_checar_yahoo_em_lotes():
    linhas = {
        "AAAA11.SA": [("2026-10-01", 10.0, 1000), ("2026-10-08", 11.0, 3000)],
        "BBBB11.SA": [("2026-10-08", 50.0, 0)],
        "CCCC11.SA": [("2026-08-01", 9.0, 10)],
    }
    chamadas = []
    baixar = lambda ts: (chamadas.append(ts), _yahoo(ts, linhas))[1]  # noqa: E731
    y = d.checar_yahoo(["AAAA11", "BBBB11", "CCCC11", "DDDD11"], baixar=baixar, lote=2).set_index("Ticker")
    assert len(chamadas) == 2
    assert y.loc["AAAA11", "Yahoo_Ultimo_Pregao"] == "2026-10-08" and y.loc["AAAA11", "Yahoo_Preco"] == 11.0
    assert y.loc["AAAA11", "Dias_Com_Negocio"] == 2 and y.loc["AAAA11", "Volume_Fin_Medio_Yahoo"] == 21500.0
    assert y.loc["BBBB11", "Dias_Com_Negocio"] == 0
    assert pd.isna(y.loc["DDDD11", "Yahoo_Ultimo_Pregao"])


def test_checar_yahoo_lote_com_erro_nao_derruba():
    def baixar(ts):
        raise ConnectionError("caiu")
    y = d.checar_yahoo(["AAAA11"], baixar=baixar)
    assert y["Yahoo_Ultimo_Pregao"].isna().all()


# ---------------------------------------------------------------- relatório e config

def _relatorio(liquidez_minima=0):
    fund = d.ler_lista_fundamentus(HTML_FUNDAMENTUS)  # HGLG11, KNCR11, ABCD11
    geral, compl = cf.ler_zip_cvm(_zip_cvm())
    cvm = d.ler_cadastro_cvm(geral, compl)             # raízes HGLG, MXRF, CVBI (+ XXXX com 0 cotistas)
    yahoo = pd.DataFrame([
        {"Ticker": "HGLG11", "Yahoo_Ultimo_Pregao": "2026-10-08", "Yahoo_Preco": 155.5, "Dias_Com_Negocio": 20, "Volume_Fin_Medio_Yahoo": 2e7},
        {"Ticker": "KNCR11", "Yahoo_Ultimo_Pregao": "2026-10-08", "Yahoo_Preco": 106.0, "Dias_Com_Negocio": 20, "Volume_Fin_Medio_Yahoo": 3e7},
        {"Ticker": "MXRF11", "Yahoo_Ultimo_Pregao": "2026-10-07", "Yahoo_Preco": 9.5, "Dias_Com_Negocio": 15, "Volume_Fin_Medio_Yahoo": 8000.0},
        {"Ticker": "ABCD11", "Yahoo_Ultimo_Pregao": "2026-07-01", "Yahoo_Preco": 10.0, "Dias_Com_Negocio": 1, "Volume_Fin_Medio_Yahoo": 10.0},
        {"Ticker": "CVBI11", "Yahoo_Ultimo_Pregao": "2026-10-08", "Yahoo_Preco": 80.0, "Dias_Com_Negocio": 0, "Volume_Fin_Medio_Yahoo": 0.0},
    ])
    return d.montar_relatorio(d.ler_lista_fundamentus(HTML_FUNDAMENTUS), cvm, yahoo, {"HGLG11"}, liquidez_minima), fund


def test_relatorio_status():
    rel, _ = _relatorio()
    st = rel.set_index("Ticker")["Status"].to_dict()
    assert st == {
        "HGLG11": d.ST_MONITORADO,
        "KNCR11": d.ST_DISPONIVEL,
        "MXRF11": d.ST_DISPONIVEL,      # veio só da CVM (ISIN), com cotação no Yahoo
        "ABCD11": d.ST_SEM_YAHOO,       # última cotação em julho: deslistado/parado
        "CVBI11": d.ST_SEM_NEGOCIO,
    }
    r = rel.set_index("Ticker")
    assert r.loc["KNCR11", "Tipo_Gestao"] == "Papel" and r.loc["KNCR11", "Segmento_Padrao"] == "Recebíveis (CRI)"
    assert r.loc["MXRF11", "Nome"] == "Maxi Renda" and r.loc["MXRF11", "CNPJ"] == "97.521.225/0001-25"
    assert r.loc["MXRF11", "Segmento_Padrao"] == "Recebíveis (CRI)"  # sem Fundamentus: usa o segmento da CVM
    rel_min, _ = _relatorio(liquidez_minima=10000)
    assert rel_min.set_index("Ticker").loc["MXRF11", "Status"] == d.ST_ILIQUIDO


def test_aplicar_inclui_so_os_disponiveis_e_nao_mexe_nos_existentes(tmp_path, monkeypatch):
    caminho = tmp_path / "fiis_config.json"
    original = {"_comentario": "teste", "fundos": [
        {"ticker": "HGLG11", "nome": "CSHG Logística", "gestora": "CSHG", "tipo_gestao": "Tijolo", "segmento": "Logística"}]}
    caminho.write_text(json.dumps(original, ensure_ascii=False), encoding="utf-8")
    rel, _ = _relatorio()
    assert d.aplicar(rel, caminho) == ["KNCR11", "MXRF11"]
    assert d.aplicar(rel, caminho) == []  # rodar de novo não duplica
    cfg = json.loads(caminho.read_text(encoding="utf-8"))
    assert cfg["_comentario"] == "teste" and "_comentario_auto" in cfg
    assert cfg["fundos"][0] == original["fundos"][0]
    mx = cfg["fundos"][2]
    assert mx == {"ticker": "MXRF11", "nome": "Maxi Renda", "gestora": "", "tipo_gestao": "Papel",
                  "segmento": "Recebíveis (CRI)", "segmento_padrao": "Recebíveis (CRI)",
                  "cnpj": "97.521.225/0001-25", "origem": "auto"}
    # um fundo por linha, como o arquivo escrito à mão
    assert caminho.read_text(encoding="utf-8").count('{"ticker"') == 3
    # e o resto do pipeline lê o arquivo normalmente
    monkeypatch.setattr(fiis_common, "ARQUIVO_CONFIG", caminho)
    assert [f["ticker"] for f in fiis_common.carregar_config()] == ["HGLG11", "KNCR11", "MXRF11"]


# ---------------------------------------------------------------- coleta com centenas de fundos

def test_retentativa_so_dos_que_faltaram(monkeypatch):
    chamadas = []

    def falso(tickers, periodo):
        chamadas.append(list(tickers))
        # na 1ª vez BBBB11 falha; na 2ª vem
        linhas = {"AAAA11.SA": [("2026-10-08", 10.0, 1)]}
        if len(chamadas) > 1:
            linhas["BBBB11.SA"] = [("2026-10-08", 20.0, 1)]
        return _yahoo(tickers, linhas)

    monkeypatch.setattr(atu, "_yahoo_download", falso)
    monkeypatch.setattr(atu.time, "sleep", lambda s: None)
    r = atu.baixar_com_retentativa(["AAAA11.SA", "BBBB11.SA", "CCCC11.SA"])
    assert set(r) == {"AAAA11.SA", "BBBB11.SA"}
    assert chamadas[0] == ["AAAA11.SA", "BBBB11.SA", "CCCC11.SA"]
    assert chamadas[1] == ["BBBB11.SA", "CCCC11.SA"] and chamadas[2] == ["CCCC11.SA"]


def test_lotes(monkeypatch):
    tamanhos = []
    monkeypatch.setattr(atu, "TAMANHO_LOTE", 2)
    monkeypatch.setattr(atu, "_yahoo_download",
                        lambda ts, periodo: (tamanhos.append(len(ts)), _yahoo(ts, {t: [("2026-10-08", 1.0, 1)] for t in ts}))[1])
    r = atu.baixar_com_retentativa([f"A{i:03d}11.SA" for i in range(5)])
    assert len(r) == 5 and tamanhos == [2, 2, 1]


def test_fundo_novo_ganha_carga_de_um_ano(tmp_path, monkeypatch):
    hist = tmp_path / "base_fiis_historico.csv"
    hist.write_text(
        "Data_Coleta;Data_Pregao;Ticker;Nome_Fundo;Preco_Fechamento_R$;Volume_Ultimo_Dia\n"
        "2026-10-07;2026-10-06;HGLG11;CSHG;154.0;100\n"
        "2026-10-07;;ZZZZ11;Sem dado;;\n", encoding="utf-8-sig")
    monkeypatch.setattr(atu, "ARQUIVO_HISTORICO", hist)
    assert atu.tickers_sem_historico(["HGLG11", "ZZZZ11", "NOVO11"]) == ["ZZZZ11", "NOVO11"]
    monkeypatch.setattr(atu, "ARQUIVO_HISTORICO", tmp_path / "nao_existe.csv")
    assert atu.tickers_sem_historico(["HGLG11"]) == ["HGLG11"]


def test_main_faz_carga_dos_novos(tmp_path, monkeypatch):
    monkeypatch.setattr(atu, "carregar_config", lambda: [{"ticker": "HGLG11", "nome": "A"}, {"ticker": "NOVO11", "nome": "B"}])
    monkeypatch.setattr(atu, "tickers_sem_historico", lambda ts: ["NOVO11"])
    pedidos = []

    def retro(fiis, periodo):
        pedidos.append((sorted(fiis), periodo))
        return pd.DataFrame([{"Data_Coleta": "2025-11-03", "Data_Pregao": "2025-11-03", "Ticker": "NOVO11",
                              "Nome_Fundo": "B", "Preco_Fechamento_R$": 9.0, "Volume_Ultimo_Dia": 5}])

    monkeypatch.setattr(atu, "coletar_historico_retroativo", retro)
    monkeypatch.setattr(atu, "coletar_cotacoes", lambda fiis: pd.DataFrame([
        {"Data_Coleta": "2026-10-09", "Data_Pregao": "2026-10-08", "Ticker": t, "Nome_Fundo": n,
         "Preco_Fechamento_R$": 10.0, "Volume_Ultimo_Dia": 1} for t, n in fiis.items()]))
    monkeypatch.setattr(atu, "ARQUIVO_HISTORICO", tmp_path / "h.csv")
    monkeypatch.setattr(fiis_common, "ARQUIVO_HISTORICO", tmp_path / "h.csv")
    atu.main([])
    assert pedidos == [(["NOVO11"], "1y")]
    out = pd.read_csv(tmp_path / "h.csv", sep=";", encoding="utf-8-sig")
    assert sorted(out[out.Ticker == "NOVO11"]["Data_Pregao"]) == ["2025-11-03", "2026-10-08"]


def test_banco_antigo_ganha_coluna_segmento_padrao(tmp_path):
    from app.db import criar_schema

    con = sqlite3.connect(tmp_path / "antigo.db")
    con.execute("CREATE TABLE fundos (ticker TEXT PRIMARY KEY, nome TEXT NOT NULL, gestora TEXT, tipo_gestao TEXT, segmento TEXT)")
    criar_schema(con)
    criar_schema(con)  # idempotente
    assert "segmento_padrao" in {r[1] for r in con.execute("PRAGMA table_info(fundos)")}


def test_ia_diaria_so_para_fundos_escolhidos_a_mao(monkeypatch):
    from scripts import gerar_diagnosticos_ia as g

    monkeypatch.setattr(g.metrics, "calcular_meta", lambda: {"fundos": [{"ticker": "HGLG11"}, {"ticker": "AUTO11"}]})
    monkeypatch.setattr(fiis_common, "carregar_config", lambda: [
        {"ticker": "HGLG11"}, {"ticker": "AUTO11", "origem": "auto"}, {"ticker": "SEMDADO11"}])
    monkeypatch.delenv("FIIS_IA_TODOS", raising=False)
    assert g.tickers_padrao() == ["HGLG11"]
    monkeypatch.setenv("FIIS_IA_TODOS", "1")
    assert g.tickers_padrao() == ["HGLG11", "AUTO11"]


# ---------------------------------------------------------------- classificação pela carteira (CVM) e pelo nome

ATIVO_PASSIVO = """CNPJ_Fundo_Classe;Data_Referencia;Versao;Disponibilidades;Direitos_Bens_Imoveis;Terrenos;Imoveis_Renda_Acabados;FII;CRI;LCI;LH;LIG;Acoes_Sociedades_Atividades_FII
11.111.111/0001-11;2026-07-01;1;10;900;0;900;0;0;0;0;0;0
11.111.111/0001-11;2026-08-01;1;10;0;0;0;0;1000;0;0;0;0
11.111.111/0001-11;2026-08-01;2;10;800;0;800;0;100;0;0;0;0
22.222.222/0001-22;2026-08-01;1;5;0;0;0;0;700;100;0;0;0
33.333.333/0001-33;2026-08-01;1;0;0;0;0;900;50;0;0;0;0
44.444.444/0001-44;2026-08-01;1;0;0;0;0;300;400;0;0;0;300
55.555.555/0001-55;2026-08-01;1;1000;0;0;0;0;0;0;0;0;0
"""


def _zip_com_ativo_passivo(texto=ATIVO_PASSIVO) -> bytes:
    import io
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("inf_mensal_fii_ativo_passivo_2026.csv", texto.encode("latin-1"))
    return buf.getvalue()


def test_composicao_da_carteira():
    c = d.ler_composicao_cvm(_zip_com_ativo_passivo()).set_index("CNPJ")
    # informe mais recente, maior versão: 800 em imóveis + 100 em CRI
    assert c.loc["11.111.111/0001-11", "Pct_Imoveis"] == 0.889
    assert c.loc["22.222.222/0001-22", "Pct_Papel"] == 1.0          # CRI + LCI
    assert c.loc["33.333.333/0001-33", "Pct_FII"] == 0.947
    assert c.loc["44.444.444/0001-44", "Pct_Imoveis"] == 0.3        # SPE conta como imóvel
    assert "55.555.555/0001-55" not in c.index                      # só caixa: sem composição


def test_composicao_com_layout_desconhecido_nao_quebra():
    c = d.ler_composicao_cvm(_zip_com_ativo_passivo("CNPJ_Fundo_Classe;Data_Referencia;Outra\n1;2026-08-01;3\n"))
    assert c.empty


def test_classificar_fundo():
    from fiis_common import classificar_fundo, classificar_por_nome

    # carteira manda no tipo, mesmo com rótulo enganoso
    assert classificar_fundo("Logística", "MAXI RENDA", {"papel": 0.8, "fii": 0.1, "imoveis": 0.1}) == ("Recebíveis (CRI)", "Papel")
    assert classificar_fundo("Multicategoria", "QUALQUER", {"papel": 0.1, "fii": 0.85, "imoveis": 0.05}) == ("Fundo de Fundos", "FoF")
    assert classificar_fundo("Multicategoria", "BTGP LOGISTICA FII", {"papel": 0, "fii": 0, "imoveis": 1}) == ("Logística", "Tijolo")
    assert classificar_fundo("Multicategoria", "SEM PISTA", {"papel": 0, "fii": 0, "imoveis": 1}) == ("Outros", "Tijolo")
    assert classificar_fundo("Outros", "MISTO", {"papel": 0.5, "fii": 0.1, "imoveis": 0.4}) == ("Híbrido", "Híbrido")
    # sem carteira: segmento específico, senão o nome
    assert classificar_fundo("Shoppings", "XP MALLS") == ("Shoppings", "Tijolo")
    assert classificar_fundo("Multicategoria", "KINEA HIGH YIELD CRI FII") == ("Recebíveis (CRI)", "Papel")
    assert classificar_fundo("Outros", "HABITAT RECEBÍVEIS PULVERIZADOS") == ("Recebíveis (CRI)", "Papel")
    assert classificar_fundo("Multicategoria", "AD SHOPPING FII") == ("Shoppings", "Tijolo")
    assert classificar_fundo("Multicategoria", "BRPR CORPORATE FII") == ("Lajes corporativas", "Tijolo")
    assert classificar_fundo("Multicategoria", "SUNO FOF") == ("Fundo de Fundos", "FoF")
    assert classificar_fundo("Multicategoria", "GENESIS MULTIESTRATÉGIA FII") == ("Híbrido", "Híbrido")
    assert classificar_fundo("Outros", "NOME SEM PISTA") == ("Outros", "Híbrido")
    assert classificar_por_nome("CAPITÂNIA OFFICE FII") == ("Lajes corporativas", "Tijolo")
    assert classificar_por_nome("KINEA CREDITAS") == ("Recebíveis (CRI)", "Papel")


def test_reclassificar_so_os_automaticos(tmp_path):
    caminho = tmp_path / "fiis_config.json"
    cfg = {"fundos": [
        {"ticker": "HGLG11", "nome": "CSHG Logística", "gestora": "CSHG", "tipo_gestao": "Tijolo", "segmento": "Logística"},
        {"ticker": "KNCR11", "nome": "KNCR11", "gestora": "", "tipo_gestao": "Híbrido", "segmento": "Híbrido",
         "segmento_padrao": "Híbrido", "origem": "auto"},
    ]}
    caminho.write_text(json.dumps(cfg), encoding="utf-8")
    rel = pd.DataFrame([
        {"Ticker": "HGLG11", "Tipo_Gestao": "Papel", "Segmento_Padrao": "Recebíveis (CRI)", "CNPJ": "1", "Nome": "X"},
        {"Ticker": "KNCR11", "Tipo_Gestao": "Papel", "Segmento_Padrao": "Recebíveis (CRI)", "CNPJ": "16.706.958/0001-32",
         "Nome": "Kinea Rendimentos"},
    ])
    assert d.reclassificar(rel, caminho) == {"KNCR11": ("Híbrido", "Papel")}
    novo = json.loads(caminho.read_text(encoding="utf-8"))
    assert novo["fundos"][0] == cfg["fundos"][0]                     # escolhido à mão: intacto
    k = novo["fundos"][1]
    assert (k["tipo_gestao"], k["segmento_padrao"], k["cnpj"], k["nome"]) == ("Papel", "Recebíveis (CRI)", "16.706.958/0001-32", "Kinea Rendimentos")
    assert list(k)[-1] == "origem"
