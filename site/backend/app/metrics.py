"""Métricas por fundo, calculadas a partir do SQLite.

Reaproveita `enriquecer` e `montar_snapshot` do gerar_dados_site.py, para que
o site, o Power BI (via data/*.json) e a API usem exatamente a mesma conta.
"""
from __future__ import annotations

import math

import pandas as pd

from . import config  # noqa: F401
from .db import conectar

from fiis_common import carregar_criterios  # noqa: E402

from gerar_dados_site import (  # noqa: E402
    anexar_checklist,
    anexar_fundamentos,
    anexar_metricas_dividendos,
    indicadores_recentes,
    enriquecer,
    montar_snapshot,
    serie_dividendos,
)

# Nome das colunas do pandas -> nome do campo na API (snake_case)
CAMPOS_SNAPSHOT = {
    "Ticker": "ticker",
    "Nome_Fundo": "nome",
    "Gestora": "gestora",
    "Tipo_Gestao": "tipo_gestao",
    "Segmento": "segmento",
    "Data_Pregao": "data_pregao",
    "Preco_Fechamento_R$": "preco",
    "Variacao_Dia_%": "variacao_dia_pct",
    "Variacao_Periodo_%": "variacao_periodo_pct",
    "Preco_Min_Periodo": "preco_min",
    "Preco_Max_Periodo": "preco_max",
    "Volume_Ultimo_Dia": "volume_cotas",
    "Volume_Financeiro_R$": "volume_financeiro",
    "Volume_Financeiro_Medio": "volume_financeiro_medio",
    "Volatilidade_Retorno_Diario_pct": "volatilidade_pct",
    "Qtde_Pregoes_Coletados": "pregoes",
    "Classificacao_Liquidez": "liquidez",
    # renda
    "Ultimo_Dividendo_R$": "ultimo_dividendo",
    "Data_Ultimo_Dividendo": "data_ultimo_dividendo",
    "DY_Ultimo_%": "dy_ultimo_pct",
    "Dividendos_12m_R$": "dividendos_12m",
    "DY_12m_%": "dy_12m_pct",
    "Pagamentos_12m": "pagamentos_12m",
    "Media_Dividendo_12m_R$": "media_dividendo_12m",
    "Media_Dividendo_3_Ult_R$": "media_dividendo_3_ult",
    "Tendencia_Dividendo_%": "tendencia_dividendo_pct",
    "Estabilidade_CV_%": "estabilidade_cv_pct",
    "Quedas_Dividendo_12m": "quedas_dividendo_12m",
    "Historico_Dividendos_Meses": "historico_dividendos_meses",
    "Retorno_Total_12m_%": "retorno_total_12m_pct",
    "Variacao_Preco_12m_%": "variacao_preco_12m_pct",
    "Grupo_Pares": "grupo_pares",
    "DY_12m_Mediana_Pares_%": "dy_12m_mediana_pares_pct",
    "DY_12m_vs_Pares_pp": "dy_12m_vs_pares_pp",
    # fundamentos (fase 2)
    "VP_Cota": "vp_cota",
    "Data_Ref_VP": "data_ref_vp",
    "P_VP": "p_vp",
    "Fonte_P_VP": "fonte_p_vp",
    "P_VP_Mediana_Pares": "p_vp_mediana_pares",
    "P_VP_vs_Pares": "p_vp_vs_pares",
    "VP_Var_12m_%": "vp_var_12m_pct",
    "Patrimonio_Liquido": "patrimonio_liquido",
    "Cotistas": "cotistas",
    "Cotistas_Var_12m_%": "cotistas_var_12m_pct",
    "Vacancia_%": "vacancia_pct",
    "Cap_Rate_%": "cap_rate_pct",
    "Qtd_Imoveis": "qtd_imoveis",
    "FFO_Yield_%": "ffo_yield_pct",
    "Spread_CDI_Liquido_pp": "spread_cdi_liquido_pp",
    "DY_Real_%": "dy_real_pct",
    # checklist (fase 3)
    "Checklist_Nota": "checklist_nota",
    "Checklist_Sinal": "checklist_sinal",
    "Checklist_Cobertura_%": "checklist_cobertura_pct",
    "Checklist": "checklist",
}

CAMPOS_INTEIROS = {"pagamentos_12m", "quedas_dividendo_12m", "historico_dividendos_meses", "cotistas", "qtd_imoveis",
                   "checklist_nota", "checklist_cobertura_pct"}


def _tabela_opcional(nome: str, datas: list[str]) -> pd.DataFrame:
    """Tabelas da fase 2 podem não existir (CSV ainda não coletado)."""
    with conectar() as con:
        existe = con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (nome,)).fetchone()
        if not existe:
            return pd.DataFrame()
        df = pd.read_sql_query(f"SELECT * FROM {nome}", con)
    for c in datas:
        df[c] = pd.to_datetime(df[c])
    return df


def _limpo(v):
    if isinstance(v, list):
        return [{k: _limpo(x) for k, x in item.items()} if isinstance(item, dict) else _limpo(item) for item in v]
    if isinstance(v, dict):
        return v
    if v is pd.NaT or v is None:
        return None
    if isinstance(v, pd.Timestamp):
        return v.date().isoformat()
    if hasattr(v, "item"):  # numpy -> python
        v = v.item()
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


def _carregar_df() -> tuple[pd.DataFrame, dict]:
    with conectar() as con:
        fundos = [dict(r) for r in con.execute("SELECT * FROM fundos")]
        df = pd.read_sql_query(
            """SELECT c.ticker AS Ticker, f.nome AS Nome_Fundo,
                      c.data_coleta AS Data_Coleta, c.data_pregao AS Data_Pregao,
                      c.preco AS "Preco_Fechamento_R$", c.volume_cotas AS Volume_Ultimo_Dia
               FROM cotacoes c JOIN fundos f USING (ticker)""",
            con,
        )
    df["Data_Pregao"] = pd.to_datetime(df["Data_Pregao"])
    df["Data_Coleta"] = pd.to_datetime(df["Data_Coleta"])
    classificacao = {
        f["ticker"]: {k: f[k] for k in ("gestora", "tipo_gestao", "segmento")} for f in fundos
    }
    return df, classificacao


def _carregar_dividendos(ticker: str | None = None) -> pd.DataFrame:
    with conectar() as con:
        sql = 'SELECT ticker AS Ticker, data_ex AS Data_Ex, valor AS "Valor_R$" FROM dividendos'
        params: tuple = ()
        if ticker:
            sql += " WHERE ticker = ?"
            params = (ticker,)
        div = pd.read_sql_query(sql, con, params=params)
    div["Data_Ex"] = pd.to_datetime(div["Data_Ex"])
    return div


def calcular_snapshot() -> list[dict]:
    df, classificacao = _carregar_df()
    if df.empty:
        return []
    df = enriquecer(df, classificacao)
    snap = montar_snapshot(df).reset_index(drop=True)
    snap = anexar_metricas_dividendos(snap, df, _carregar_dividendos())
    snap = anexar_fundamentos(
        snap,
        _tabela_opcional("cvm_mensal", ["Data_Referencia"]),
        _tabela_opcional("fundamentus", ["Data_Coleta"]),
        _tabela_opcional("indicadores", ["Data"]),
    )
    snap = anexar_checklist(snap, carregar_criterios())
    registros = []
    for i, linha in enumerate(snap.to_dict(orient="records"), start=1):
        item = {api: _limpo(linha.get(col)) for col, api in CAMPOS_SNAPSHOT.items()}
        for campo in CAMPOS_INTEIROS:
            if item[campo] is not None:
                item[campo] = int(item[campo])
        item["rank_liquidez"] = i  # snapshot já vem ordenado por liquidez
        registros.append(item)
    return registros


def calcular_historico(ticker: str) -> list[dict]:
    df, classificacao = _carregar_df()
    df = df[df["Ticker"] == ticker]
    if df.empty:
        return []
    df = enriquecer(df, classificacao).sort_values("Data_Pregao")
    return [
        {
            "data_pregao": _limpo(r["Data_Pregao"]),
            "preco": _limpo(r["Preco_Fechamento_R$"]),
            "volume_cotas": _limpo(r["Volume_Ultimo_Dia"]),
            "volume_financeiro": _limpo(round(r["Volume_Financeiro_R$"], 2)),
            "variacao_dia_pct": _limpo(r["Variacao_Dia_%"]),
        }
        for r in df.to_dict(orient="records")
    ]


def calcular_dividendos(ticker: str) -> list[dict] | None:
    """Rendimentos do fundo (None se o ticker não existe; [] se não há rendimentos)."""
    df, _ = _carregar_df()
    if ticker not in set(df["Ticker"]):
        return None
    serie = serie_dividendos(_carregar_dividendos(ticker), df, ticker)
    return [
        {
            "data_ex": _limpo(r["Data_Ex"]),
            "valor": _limpo(r["Valor_R$"]),
            "preco_data_com": _limpo(r["Preco_Data_Com"]),
            "dy_pct": _limpo(r["DY_Pagamento_pct"]),
        }
        for r in serie.to_dict(orient="records")
    ]


def calcular_meta() -> dict:
    with conectar() as con:
        pregoes = [r[0] for r in con.execute("SELECT DISTINCT data_pregao FROM cotacoes ORDER BY 1")]
        fundos = [dict(r) for r in con.execute("SELECT * FROM fundos ORDER BY ticker")]
        carregado = con.execute("SELECT valor FROM meta WHERE chave='carregado_em'").fetchone()
        ult_div = con.execute("SELECT MAX(data_ex) FROM dividendos").fetchone()
    return {
        "ultimo_pregao": pregoes[-1] if pregoes else None,
        "pregoes": pregoes,
        "total_fundos": len(fundos),
        "tipos_gestao": sorted({f["tipo_gestao"] for f in fundos if f["tipo_gestao"]}),
        "segmentos": sorted({f["segmento"] for f in fundos if f["segmento"]}),
        "atualizado_em": carregado[0] if carregado else None,
        "ultimo_dividendo_registrado": ult_div[0] if ult_div else None,
        "indicadores": {
            nome: {"valor": v["valor"], "data": _limpo(v["data"])}
            for nome, v in indicadores_recentes(_tabela_opcional("indicadores", ["Data"])).items()
        },
        "fundos": fundos,
    }


def mensagem_ia(tickers: list[str]) -> str | None:
    """Monta a mensagem para o Claude com os dados de 1 ou 2 fundos.
    Devolve None se algum ticker não existe."""
    from . import ia

    snap = calcular_snapshot()
    por_ticker = {f["ticker"]: f for f in snap}
    if not tickers or any(t not in por_ticker for t in tickers):
        return None
    meta = calcular_meta()
    contextos = [
        ia.contexto_fundo(por_ticker[t], snap, calcular_dividendos(t) or [], meta) for t in tickers
    ]
    return ia.montar_mensagem(contextos, ia.contexto_mercado(meta))
