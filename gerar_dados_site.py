"""
gerar_dados_site.py
--------------------
Lê base_fiis_historico.csv + fiis_config.json e exporta um conjunto de
arquivos JSON "prontos para consumo" por um site/dashboard:

  data/snapshot.json    -> uma linha por fundo, com a foto mais recente
                           (preço, variação, volume, liquidez, classificação)
  data/historico.json   -> série temporal por ticker (preço e volume por
                           data de pregão), para gráficos de linha
  data/ranking.json     -> os fundos ordenados por alguns critérios úteis
                           (liquidez, DY 12m, variação no período), já
                           agrupados por segmento
  data/dividendos.json  -> rendimentos por ticker (data-ex, valor, DY de
                           cada pagamento)

DY, último dividendo e demais métricas de renda vêm de
base_fiis_dividendos.csv (gerado por coletar_dividendos.py).

A ideia é que, quando você construir o site, ele só precise dar fetch()
nesses três arquivos (ou numa API que devolva o mesmo formato) — toda a
conta (variação %, liquidez, etc.) já vem pronta daqui, então o site não
precisa reimplementar nada disso em JavaScript.

Rode depois de cada atualizador_fiis.py:
    python atualizador_fiis.py
    python coletar_dividendos.py
    python gerar_dados_site.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from fiis_common import (
    PASTA_BASE,
    carregar_config,
    carregar_criterios,
    carregar_cvm,
    carregar_dividendos,
    carregar_fundamentus,
    carregar_indicadores,
    carregar_historico_limpo,
    configurar_logging,
    montar_dicionario_classificacao,
)

log = configurar_logging()

PASTA_SAIDA = PASTA_BASE / "data"


def enriquecer(df: pd.DataFrame, classificacao: dict[str, dict]) -> pd.DataFrame:
    """Adiciona colunas derivadas ao histórico limpo:
    - Volume_Financeiro_R$ = preço x quantidade de cotas negociadas
      (é a métrica de liquidez comparável entre fundos; quantidade de cotas
      sozinha não é comparável porque cada fundo tem uma cota de valor
      diferente — ver explicação no relatório)
    - Variacao_Dia_% = variação do preço em relação à coleta anterior do
      mesmo ticker
    - Gestora / Tipo_Gestao / Segmento = classificação vinda do config
    """
    df = df.sort_values(["Ticker", "Data_Pregao"]).copy()

    df["Volume_Financeiro_R$"] = df["Preco_Fechamento_R$"] * df["Volume_Ultimo_Dia"]
    df["Variacao_Dia_%"] = (
        df.groupby("Ticker")["Preco_Fechamento_R$"].pct_change() * 100
    ).round(2)

    for campo in ("gestora", "tipo_gestao", "segmento"):
        df[campo.capitalize() if campo != "tipo_gestao" else "Tipo_Gestao"] = df["Ticker"].map(
            lambda t: classificacao.get(t, {}).get(campo)
        )

    return df


def classificar_liquidez(serie_volume_financeiro_medio: pd.Series) -> pd.Series:
    """Classifica cada fundo em Alta/Média/Baixa liquidez com base nos
    quartis do volume financeiro médio do próprio grupo monitorado (ou
    seja, é uma liquidez relativa à sua carteira, não um valor absoluto de
    mercado)."""
    try:
        q1, q3 = serie_volume_financeiro_medio.quantile([0.33, 0.66])
    except Exception:
        return pd.Series(["Média"] * len(serie_volume_financeiro_medio), index=serie_volume_financeiro_medio.index)

    def rotulo(v):
        if pd.isna(v):
            return "Sem dados"
        if v >= q3:
            return "Alta"
        if v >= q1:
            return "Média"
        return "Baixa"

    return serie_volume_financeiro_medio.apply(rotulo)


def montar_snapshot(df: pd.DataFrame) -> pd.DataFrame:
    """Uma linha por ticker com a foto mais recente + métricas agregadas do
    período todo coletado (não só do último dia)."""
    ultima_data = df["Data_Pregao"].max()
    df_ultimo = df[df["Data_Pregao"] == df.groupby("Ticker")["Data_Pregao"].transform("max")]

    agregados = df.groupby("Ticker").agg(
        Preco_Min_Periodo=("Preco_Fechamento_R$", "min"),
        Preco_Max_Periodo=("Preco_Fechamento_R$", "max"),
        Volume_Financeiro_Medio=("Volume_Financeiro_R$", "mean"),
        Volatilidade_Retorno_Diario_pct=("Variacao_Dia_%", "std"),
        Qtde_Pregoes_Coletados=("Data_Pregao", "nunique"),
    )

    primeiro_preco = df.sort_values("Data_Pregao").groupby("Ticker")["Preco_Fechamento_R$"].first()
    ultimo_preco = df.sort_values("Data_Pregao").groupby("Ticker")["Preco_Fechamento_R$"].last()
    variacao_periodo = ((ultimo_preco / primeiro_preco - 1) * 100).round(2)
    agregados["Variacao_Periodo_%"] = variacao_periodo

    snapshot = df_ultimo.merge(agregados, on="Ticker")
    snapshot["Classificacao_Liquidez"] = classificar_liquidez(snapshot["Volume_Financeiro_Medio"])
    snapshot = snapshot.sort_values("Volume_Financeiro_Medio", ascending=False)

    log.info("Snapshot gerado com dados até %s (%d fundos).", ultima_data, len(snapshot))
    return snapshot


# ---------------------------------------------------------------------------
# Dividendos
# ---------------------------------------------------------------------------
#
# Todas as métricas usam como referência o ÚLTIMO PREGÃO de cada fundo (não a
# data de hoje), para que DY e preço sempre conversem entre si.

LIMIAR_QUEDA = 0.90       # pagamento < 90% da mediana dos 6 anteriores = queda
MIN_FUNDOS_SEGMENTO = 3   # abaixo disso, compara com o tipo de gestão


def _preco_em(historico_ticker: pd.DataFrame, quando: pd.Timestamp) -> float | None:
    """Último preço de fechamento em ou antes de `quando`."""
    antes = historico_ticker[historico_ticker["Data_Pregao"] <= quando]
    if antes.empty:
        return None
    return float(antes.iloc[-1]["Preco_Fechamento_R$"])


def _metricas_um_fundo(div: pd.DataFrame, hist: pd.DataFrame, ref: pd.Timestamp, preco: float | None) -> dict:
    vazio = {
        "Ultimo_Dividendo_R$": None, "Data_Ultimo_Dividendo": None, "DY_Ultimo_%": None,
        "Dividendos_12m_R$": None, "DY_12m_%": None, "Pagamentos_12m": 0,
        "Media_Dividendo_12m_R$": None, "Media_Dividendo_3_Ult_R$": None,
        "Tendencia_Dividendo_%": None, "Estabilidade_CV_%": None, "Quedas_Dividendo_12m": None,
        "Retorno_Total_12m_%": None, "Variacao_Preco_12m_%": None, "Historico_Dividendos_Meses": 0,
    }
    div = div[div["Data_Ex"] <= ref].sort_values("Data_Ex")
    hist = hist.sort_values("Data_Pregao")
    inicio_12m = ref - pd.DateOffset(months=12)

    # Retorno em 12 meses só existe se o histórico de preços chega lá.
    preco_12m = _preco_em(hist, inicio_12m) if not hist.empty and hist["Data_Pregao"].min() <= inicio_12m + pd.Timedelta(days=7) else None

    if div.empty:
        if preco and preco_12m:
            vazio["Variacao_Preco_12m_%"] = round((preco / preco_12m - 1) * 100, 2)
        return vazio

    ultimo = div.iloc[-1]
    janela = div[div["Data_Ex"] > inicio_12m]
    valores = janela["Valor_R$"]
    soma_12m = float(valores.sum()) if len(valores) else 0.0

    # Queda: pagamento abaixo de 90% da mediana dos 6 pagamentos anteriores.
    # Comparar com a mediana (e não só com o mês anterior) evita marcar como
    # "corte" o mês seguinte a um rendimento extraordinário semestral.
    mediana_ant = div["Valor_R$"].shift(1).rolling(6, min_periods=3).median()
    # Conta EPISÓDIOS: um corte que se mantém por 4 meses é uma queda, não 4.
    abaixo = div["Valor_R$"] < LIMIAR_QUEDA * mediana_ant
    queda = abaixo & ~abaixo.shift(1, fill_value=False)
    quedas_12m = int(queda[div["Data_Ex"] > inicio_12m].sum())

    meses_hist = (ref.year - div["Data_Ex"].min().year) * 12 + (ref.month - div["Data_Ex"].min().month)

    m = dict(vazio)
    m.update({
        "Ultimo_Dividendo_R$": round(float(ultimo["Valor_R$"]), 4),
        "Data_Ultimo_Dividendo": ultimo["Data_Ex"],
        "DY_Ultimo_%": round(ultimo["Valor_R$"] / preco * 100, 2) if preco else None,
        "Dividendos_12m_R$": round(soma_12m, 4),
        "DY_12m_%": round(soma_12m / preco * 100, 2) if preco else None,
        "Pagamentos_12m": int(len(valores)),
        "Media_Dividendo_12m_R$": round(float(valores.mean()), 4) if len(valores) else None,
        "Media_Dividendo_3_Ult_R$": round(float(div["Valor_R$"].tail(3).mean()), 4),
        "Estabilidade_CV_%": round(float(valores.std(ddof=0) / valores.mean() * 100), 1) if len(valores) >= 3 else None,
        "Quedas_Dividendo_12m": quedas_12m,
        "Historico_Dividendos_Meses": int(meses_hist),
    })
    if len(valores) >= 6 and m["Media_Dividendo_12m_R$"]:
        m["Tendencia_Dividendo_%"] = round((m["Media_Dividendo_3_Ult_R$"] / m["Media_Dividendo_12m_R$"] - 1) * 100, 1)
    if preco and preco_12m:
        m["Variacao_Preco_12m_%"] = round((preco / preco_12m - 1) * 100, 2)
        m["Retorno_Total_12m_%"] = round(((preco + soma_12m) / preco_12m - 1) * 100, 2)
    return m


def anexar_metricas_dividendos(snapshot: pd.DataFrame, historico: pd.DataFrame, dividendos: pd.DataFrame) -> pd.DataFrame:
    """Acrescenta ao snapshot as colunas de renda (DY, último dividendo,
    estabilidade...) e a comparação com os pares.

    - DY_12m_% = soma dos rendimentos com data-ex nos últimos 12 meses ÷ preço atual
    - DY_Ultimo_% = último rendimento ÷ preço atual (DY "do mês")
    - Tendencia_Dividendo_% = média dos 3 últimos ÷ média 12m − 1
    - Estabilidade_CV_% = desvio padrão ÷ média dos pagamentos 12m (menor = mais estável)
    - Retorno_Total_12m_% = (preço atual + rendimentos 12m) ÷ preço de 12 meses atrás − 1
    - DY_12m_vs_Pares_pp = DY 12m − mediana do grupo de pares (segmento, ou
      tipo de gestão quando o segmento tem menos de 3 fundos)
    """
    linhas = []
    for _, s in snapshot.iterrows():
        t = s["Ticker"]
        m = _metricas_um_fundo(
            dividendos[dividendos["Ticker"] == t] if len(dividendos) else dividendos,
            historico[historico["Ticker"] == t],
            s["Data_Pregao"],
            s["Preco_Fechamento_R$"] if pd.notna(s["Preco_Fechamento_R$"]) else None,
        )
        m["Ticker"] = t
        linhas.append(m)
    met = pd.DataFrame(linhas)
    out = snapshot.merge(met, on="Ticker", how="left")

    tamanho_seg = out.groupby("Segmento")["Ticker"].transform("count")
    out["Grupo_Pares"] = out["Segmento"].where(tamanho_seg >= MIN_FUNDOS_SEGMENTO, out["Tipo_Gestao"])
    mediana = out.groupby("Grupo_Pares")["DY_12m_%"].transform("median")
    out["DY_12m_Mediana_Pares_%"] = mediana.round(2)
    out["DY_12m_vs_Pares_pp"] = (out["DY_12m_%"] - mediana).round(2)
    return out


def serie_dividendos(dividendos: pd.DataFrame, historico: pd.DataFrame, ticker: str) -> pd.DataFrame:
    """Rendimentos de um fundo com o DY de cada pagamento sobre o preço da
    véspera da data-ex (o último pregão COM direito ao rendimento)."""
    d = dividendos[dividendos["Ticker"] == ticker].sort_values("Data_Ex").copy()
    h = historico[historico["Ticker"] == ticker].sort_values("Data_Pregao")
    if d.empty:
        return d.assign(Preco_Data_Com=pd.Series(dtype=float), DY_Pagamento_pct=pd.Series(dtype=float))
    precos = []
    for data_ex in d["Data_Ex"]:
        precos.append(_preco_em(h, data_ex - pd.Timedelta(days=1)) if not h.empty else None)
    d["Preco_Data_Com"] = precos
    d["DY_Pagamento_pct"] = (d["Valor_R$"] / d["Preco_Data_Com"] * 100).round(3)
    return d


# ---------------------------------------------------------------------------
# Fundamentos (fase 2): P/VP, patrimônio, cotistas, vacância e régua de juros
# ---------------------------------------------------------------------------

ALIQUOTA_IR_RENDA_FIXA = 0.15
P_VP_PLAUSIVEL = (0.2, 5.0)    # fora disso, o VP da CVM provavelmente é de outro fundo/classe  # IR de renda fixa acima de 2 anos; rendimento de FII é isento para PF


def indicadores_recentes(indicadores: pd.DataFrame) -> dict:
    """Último valor de cada indicador do Banco Central, com a data."""
    if indicadores.empty:
        return {}
    # A série da Selic meta (432) vem com datas futuras (vigência até a próxima
    # reunião do Copom); ficamos só com o que já aconteceu.
    ind = indicadores.dropna(subset=["Valor"])
    ind = ind[ind["Data"] <= pd.Timestamp.today().normalize()]
    ult = ind.sort_values("Data").groupby("Indicador").last()
    return {nome: {"valor": float(r["Valor"]), "data": r["Data"]} for nome, r in ult.iterrows()}


def _valor_12m_antes(serie: pd.DataFrame, coluna: str) -> float | None:
    """Valor do mês de referência ~12 meses antes do último (tolerância de 15 dias)."""
    serie = serie.dropna(subset=[coluna]).sort_values("Data_Referencia")
    if serie.empty:
        return None
    alvo = serie["Data_Referencia"].iloc[-1] - pd.DateOffset(months=12)
    antes = serie[serie["Data_Referencia"] <= alvo + pd.Timedelta(days=15)]
    return float(antes[coluna].iloc[-1]) if len(antes) else None


def anexar_fundamentos(snapshot: pd.DataFrame, cvm: pd.DataFrame, fundamentus: pd.DataFrame,
                       indicadores: pd.DataFrame) -> pd.DataFrame:
    """Acrescenta ao snapshot:

    - VP_Cota / Data_Ref_VP: valor patrimonial por cota do último informe da CVM
    - P_VP = preço atual ÷ VP por cota. Usa o nosso preço (último pregão) em vez
      do P/VP pronto do Fundamentus, que só entra como reserva (Fonte_P_VP).
    - VP_Var_12m_%: evolução do VP por cota em 12 meses (queda contínua pode
      indicar reavaliação negativa de imóveis ou perda em CRIs)
    - Cotistas, Cotistas_Var_12m_%, Patrimonio_Liquido
    - Vacancia_%, Cap_Rate_%, Qtd_Imoveis, FFO_Yield_% (Fundamentus, opcional)
    - Spread_CDI_Liquido_pp = DY 12m − CDI × (1 − 15%): o DY do FII é isento de
      IR para pessoa física, a renda fixa não; por isso a comparação é com o
      CDI líquido
    - DY_Real_% = DY 12m descontado o IPCA 12m
    - P_VP_Mediana_Pares / P_VP_vs_Pares
    """
    out = snapshot.copy()
    novas = ["VP_Cota", "Data_Ref_VP", "P_VP", "Fonte_P_VP", "VP_Var_12m_%", "Patrimonio_Liquido",
             "Cotistas", "Cotistas_Var_12m_%", "Vacancia_%", "Cap_Rate_%", "Qtd_Imoveis", "FFO_Yield_%",
             "Spread_CDI_Liquido_pp", "DY_Real_%", "P_VP_Mediana_Pares", "P_VP_vs_Pares"]
    for c in novas:
        out[c] = None

    for i, s in out.iterrows():
        t, preco = s["Ticker"], s["Preco_Fechamento_R$"]
        if len(cvm):
            c = cvm[(cvm["Ticker"] == t)].sort_values("Data_Referencia")
            c_vp = c.dropna(subset=["VP_Cota"])
            c_vp = c_vp[c_vp["VP_Cota"] > 0]
            if len(c_vp) and pd.notna(preco):
                pvp_teste = preco / float(c_vp.iloc[-1]["VP_Cota"])
                if not (P_VP_PLAUSIVEL[0] <= pvp_teste <= P_VP_PLAUSIVEL[1]):
                    log.warning("%s: P/VP %.2f com o VP da CVM (R$ %.2f) não é plausível — ignorando a CVM para "
                                "este fundo; confira o CNPJ no fiis_config.json", t, pvp_teste, c_vp.iloc[-1]["VP_Cota"])
                    c_vp = c_vp.iloc[0:0]
                    c = c.iloc[0:0]
            if len(c_vp):
                u = c_vp.iloc[-1]
                out.at[i, "VP_Cota"] = round(float(u["VP_Cota"]), 2)
                out.at[i, "Data_Ref_VP"] = u["Data_Referencia"]
                if pd.notna(preco):
                    out.at[i, "P_VP"] = round(preco / float(u["VP_Cota"]), 2)
                    out.at[i, "Fonte_P_VP"] = "CVM"
                vp_ant = _valor_12m_antes(c_vp, "VP_Cota")
                if vp_ant:
                    out.at[i, "VP_Var_12m_%"] = round((float(u["VP_Cota"]) / vp_ant - 1) * 100, 2)
            if len(c):
                u = c.iloc[-1]
                if pd.notna(u.get("Patrimonio_Liquido")):
                    out.at[i, "Patrimonio_Liquido"] = float(u["Patrimonio_Liquido"])
                c_ct = c.dropna(subset=["Cotistas"])
                if len(c_ct):
                    atual = float(c_ct["Cotistas"].iloc[-1])
                    out.at[i, "Cotistas"] = int(atual)
                    ant = _valor_12m_antes(c_ct, "Cotistas")
                    if ant:
                        out.at[i, "Cotistas_Var_12m_%"] = round((atual / ant - 1) * 100, 1)

        if len(fundamentus):
            f = fundamentus[fundamentus["Ticker"] == t].sort_values("Data_Coleta")
            if len(f):
                u = f.iloc[-1]
                for col in ("Vacancia_%", "Cap_Rate_%", "Qtd_Imoveis", "FFO_Yield_%"):
                    if col in u and pd.notna(u[col]):
                        out.at[i, col] = float(u[col]) if col != "Qtd_Imoveis" else int(u[col])
                if out.at[i, "P_VP"] is None and pd.notna(u.get("P_VP_Fundamentus")):
                    out.at[i, "P_VP"] = round(float(u["P_VP_Fundamentus"]), 2)
                    out.at[i, "Fonte_P_VP"] = "Fundamentus"

    ind = indicadores_recentes(indicadores)
    dy = pd.to_numeric(out.get("DY_12m_%"), errors="coerce") if "DY_12m_%" in out else pd.Series(float("nan"), index=out.index)
    if "CDI_aa" in ind:
        out["Spread_CDI_Liquido_pp"] = (dy - ind["CDI_aa"]["valor"] * (1 - ALIQUOTA_IR_RENDA_FIXA)).round(2)
    if "IPCA_12m" in ind:
        out["DY_Real_%"] = (((1 + dy / 100) / (1 + ind["IPCA_12m"]["valor"] / 100) - 1) * 100).round(2)

    if "Grupo_Pares" not in out:
        tam = out.groupby("Segmento")["Ticker"].transform("count")
        out["Grupo_Pares"] = out["Segmento"].where(tam >= MIN_FUNDOS_SEGMENTO, out["Tipo_Gestao"])
    pvp = pd.to_numeric(out["P_VP"], errors="coerce")
    med = pvp.groupby(out["Grupo_Pares"]).transform("median")
    out["P_VP_Mediana_Pares"] = med.round(2)
    out["P_VP_vs_Pares"] = (pvp - med).round(2)

    for c in ("VP_Cota", "P_VP", "VP_Var_12m_%", "Patrimonio_Liquido", "Cotistas_Var_12m_%",
              "Vacancia_%", "Cap_Rate_%", "FFO_Yield_%", "Spread_CDI_Liquido_pp", "DY_Real_%"):
        out[c] = pd.to_numeric(out[c], errors="coerce")
    return out


# ---------------------------------------------------------------------------
# Checklist de triagem (fase 3)
# ---------------------------------------------------------------------------
#
# Cada critério de criterios_checklist.json olha um campo do snapshot e vira
# verde / amarelo / vermelho / sem_dado. A nota (0-100) é a média ponderada
# (verde = 1, amarelo = 0,5, vermelho = 0) só dos critérios com dado. O sinal
# geral:
#   cinza    -> menos de `cobertura_minima` do peso tem dado (não dá para julgar)
#   vermelho -> algum critério eliminatório vermelho, ou nota < vermelho_nota_abaixo_de
#   verde    -> nota >= verde_nota_minima
#   amarelo  -> o resto
# É uma TRIAGEM: aponta onde olhar primeiro, não diz o que comprar.

PONTOS = {"verde": 1.0, "amarelo": 0.5, "vermelho": 0.0}


def _na_faixa(valor: float, faixa: dict | None) -> bool:
    if not faixa:
        return False
    lo, hi = faixa.get("min"), faixa.get("max")
    return (lo is None or valor >= lo) and (hi is None or valor <= hi)


def classificar_valor(valor, criterio: dict) -> str:
    if valor is None or (isinstance(valor, float) and np.isnan(valor)) or pd.isna(valor):
        return "sem_dado"
    v = float(valor)
    if _na_faixa(v, criterio.get("verde")):
        return "verde"
    if _na_faixa(v, criterio.get("amarelo")):
        return "amarelo"
    return "vermelho"


def avaliar_fundo(linha: dict | pd.Series, config: dict) -> dict:
    regras = {"verde_nota_minima": 75, "vermelho_nota_abaixo_de": 50, "cobertura_minima": 0.6}
    regras.update(config.get("regras_sinal", {}))
    itens, peso_total, peso_com_dado, pontos = [], 0.0, 0.0, 0.0
    eliminado = False
    for c in config.get("criterios", []):
        aplica = c.get("aplica_a")
        if aplica and linha.get("Tipo_Gestao") not in aplica:
            continue
        valor = linha.get(c["campo"])
        status = classificar_valor(valor, c)
        peso = float(c.get("peso", 1))
        peso_total += peso
        if status != "sem_dado":
            peso_com_dado += peso
            pontos += peso * PONTOS[status]
            if status == "vermelho" and c.get("eliminatorio"):
                eliminado = True
        itens.append({
            "id": c["id"], "nome": c["nome"], "descricao": c.get("descricao"),
            "valor": None if status == "sem_dado" else round(float(valor), 4),
            "unidade": c.get("unidade", ""), "status": status, "peso": peso,
            "eliminatorio": bool(c.get("eliminatorio")),
            "verde": c.get("verde"), "amarelo": c.get("amarelo"),
        })
    cobertura = peso_com_dado / peso_total if peso_total else 0.0
    nota = round(pontos / peso_com_dado * 100) if peso_com_dado else None
    if cobertura < regras["cobertura_minima"] or nota is None:
        sinal = "cinza"
    elif eliminado or nota < regras["vermelho_nota_abaixo_de"]:
        sinal = "vermelho"
    elif nota >= regras["verde_nota_minima"]:
        sinal = "verde"
    else:
        sinal = "amarelo"
    return {"Checklist": itens, "Checklist_Nota": nota, "Checklist_Sinal": sinal,
            "Checklist_Cobertura_%": round(cobertura * 100)}


def anexar_checklist(snapshot: pd.DataFrame, config: dict) -> pd.DataFrame:
    if not config.get("criterios"):
        return snapshot.assign(Checklist=[[] for _ in range(len(snapshot))], Checklist_Nota=None,
                               Checklist_Sinal="cinza", **{"Checklist_Cobertura_%": 0})
    avaliacoes = [avaliar_fundo(linha, config) for linha in snapshot.to_dict(orient="records")]
    extra = pd.DataFrame(avaliacoes, index=snapshot.index)
    return pd.concat([snapshot, extra], axis=1)


def para_json_seguro(obj):
    """Converte tipos numpy/pandas (int64, Timestamp, NaN) em algo que o
    json padrão do Python sabe serializar."""
    if isinstance(obj, dict):
        return {k: para_json_seguro(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [para_json_seguro(v) for v in obj]
    if isinstance(obj, (pd.Timestamp,)):
        return obj.date().isoformat() if not pd.isna(obj) else None
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return None if np.isnan(obj) else float(obj)
    if pd.isna(obj):
        return None
    return obj


def registros_json(df: pd.DataFrame) -> list[dict]:
    return [
        {k: para_json_seguro(v) for k, v in linha.items()}
        for linha in df.to_dict(orient="records")
    ]


def salvar_json(nome: str, conteudo) -> None:
    PASTA_SAIDA.mkdir(exist_ok=True)
    caminho = PASTA_SAIDA / nome
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(conteudo, f, ensure_ascii=False, indent=2)
    log.info("Gravado %s", caminho)


def main() -> None:
    fundos = carregar_config()
    classificacao = montar_dicionario_classificacao(fundos)

    df = carregar_historico_limpo()
    if df.empty:
        log.warning("Histórico vazio — rode atualizador_fiis.py primeiro.")
        return

    df = enriquecer(df, classificacao)

    snapshot = montar_snapshot(df)
    dividendos = carregar_dividendos()
    if dividendos.empty:
        log.warning("Sem base_fiis_dividendos.csv — rode coletar_dividendos.py para ter DY.")
    snapshot = anexar_metricas_dividendos(snapshot, df, dividendos)
    indicadores = carregar_indicadores()
    snapshot = anexar_fundamentos(snapshot, carregar_cvm(), carregar_fundamentus(), indicadores)
    snapshot = anexar_checklist(snapshot, carregar_criterios())
    salvar_json("snapshot.json", registros_json(snapshot))

    salvar_json("dividendos.json", {
        ticker: registros_json(serie_dividendos(dividendos, df, ticker)[["Data_Ex", "Valor_R$", "Preco_Data_Com", "DY_Pagamento_pct"]])
        for ticker in snapshot["Ticker"]
    })

    historico_por_ticker = {
        ticker: registros_json(
            grupo.sort_values("Data_Pregao")[
                ["Data_Pregao", "Preco_Fechamento_R$", "Volume_Ultimo_Dia", "Volume_Financeiro_R$", "Variacao_Dia_%"]
            ]
        )
        for ticker, grupo in df.groupby("Ticker")
    }
    salvar_json("historico.json", historico_por_ticker)

    ranking = {
        "por_liquidez": registros_json(
            snapshot[["Ticker", "Nome_Fundo", "Segmento", "Volume_Financeiro_Medio", "Classificacao_Liquidez"]]
            .sort_values("Volume_Financeiro_Medio", ascending=False)
        ),
        "por_dy_12m": registros_json(
            snapshot[["Ticker", "Nome_Fundo", "Segmento", "DY_12m_%", "DY_Ultimo_%", "DY_12m_vs_Pares_pp"]]
            .sort_values("DY_12m_%", ascending=False)
        ),
        "por_checklist": registros_json(
            snapshot[["Ticker", "Nome_Fundo", "Segmento", "Checklist_Sinal", "Checklist_Nota", "Checklist_Cobertura_%"]]
            .sort_values("Checklist_Nota", ascending=False)
        ),
        "por_p_vp": registros_json(
            snapshot[["Ticker", "Nome_Fundo", "Segmento", "P_VP", "P_VP_vs_Pares", "DY_12m_%"]]
            .sort_values("P_VP")
        ),
        "por_variacao_periodo": registros_json(
            snapshot[["Ticker", "Nome_Fundo", "Segmento", "Variacao_Periodo_%"]]
            .sort_values("Variacao_Periodo_%", ascending=False)
        ),
        "por_segmento": {
            segmento: registros_json(
                grupo[["Ticker", "Nome_Fundo", "Preco_Fechamento_R$", "Variacao_Periodo_%", "DY_12m_%", "Classificacao_Liquidez"]]
            )
            for segmento, grupo in snapshot.groupby("Segmento")
        },
    }
    salvar_json("ranking.json", ranking)

    salvar_json("config.json", {
        "fundos": fundos,
        "indicadores": {k: {"valor": v["valor"], "data": para_json_seguro(v["data"])} for k, v in indicadores_recentes(indicadores).items()},
        "gerado_em": pd.Timestamp.now().isoformat(),
    })


if __name__ == "__main__":
    main()
