"""
coletar_fundamentos.py
-----------------------
Fase 2: dados que não vêm do Yahoo. Três fontes, cada uma com seu CSV:

  1. CVM (informe mensal de FII)  -> base_fiis_cvm.csv
     Patrimônio líquido, cotas emitidas, valor patrimonial por cota (VP) e nº
     de cotistas, um registro por fundo e mês. É a fonte OFICIAL do VP (base
     do P/VP). Tem 1 a 2 meses de defasagem, porque o fundo entrega o informe
     depois do fechamento do mês.

  2. Banco Central (API SGS)      -> base_indicadores.csv
     CDI (% ao ano), IPCA acumulado em 12 meses e Selic meta. É a régua para
     saber se o DY de um fundo compensa.

  3. Fundamentus (opcional)       -> base_fiis_fundamentus.csv
     Vacância média, cap rate, quantidade de imóveis e FFO yield. É scraping
     de uma página só: se o site mudar e a leitura falhar, o script avisa e
     segue, e o resto do pipeline funciona sem esses campos.

Cada fonte é independente: a falha de uma não impede as outras.

Uso:
    python coletar_fundamentos.py                  # as três fontes
    python coletar_fundamentos.py cvm bcb          # só algumas
"""

from __future__ import annotations

import io
import json
import re
import sys
import urllib.request
import zipfile
from datetime import date, timedelta

import pandas as pd

from fiis_common import (
    ARQUIVO_CVM,
    ARQUIVO_FUNDAMENTUS,
    ARQUIVO_INDICADORES,
    carregar_config,
    carregar_fundamentus,
    configurar_logging,
)

log = configurar_logging()

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}


def baixar(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _numero(serie: pd.Series) -> pd.Series:
    """Converte números que podem vir como '1.234,56', '1234.56' ou '9,16%'."""
    if serie.dtype.kind in "if":
        return serie.astype(float)
    texto = serie.astype(str).str.replace("%", "", regex=False).str.strip()
    tem_virgula = texto.str.contains(",", regex=False)
    texto = texto.where(~tem_virgula, texto.str.replace(".", "", regex=False).str.replace(",", ".", regex=False))
    return pd.to_numeric(texto, errors="coerce")


# ---------------------------------------------------------------------------
# 1. CVM — informe mensal
# ---------------------------------------------------------------------------

URL_CVM = "https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_{ano}.zip"

# Nome da coluna no CSV da CVM -> nome no nosso CSV. A CVM já mudou nomes
# antes (ex: CNPJ_Fundo -> CNPJ_Fundo_Classe), por isso aceitamos variações.
COLUNAS_GERAL = {
    "CNPJ": ["CNPJ_Fundo_Classe", "CNPJ_Fundo"],
    "Data_Referencia": ["Data_Referencia"],
    "Versao": ["Versao"],
    "Nome_CVM": ["Nome_Fundo_Classe", "Nome_Fundo"],
    "ISIN": ["Codigo_ISIN"],
    "Cotas_Emitidas": ["Quantidade_Cotas_Emitidas"],
    "Segmento_CVM": ["Segmento_Atuacao"],
    "Mandato_CVM": ["Mandato"],
}
COLUNAS_COMPLEMENTO = {
    "CNPJ": ["CNPJ_Fundo_Classe", "CNPJ_Fundo"],
    "Data_Referencia": ["Data_Referencia"],
    "Versao": ["Versao"],
    "Cotistas": ["Total_Numero_Cotistas"],
    "Valor_Ativo": ["Valor_Ativo"],
    "Patrimonio_Liquido": ["Patrimonio_Liquido"],
    "Cotas_Emitidas_Compl": ["Cotas_Emitidas"],
    "VP_Cota": ["Valor_Patrimonial_Cotas", "Valor_Patrimonial_Cota"],
}
NUMERICAS_CVM = ["Versao", "Cotas_Emitidas", "Cotistas", "Valor_Ativo", "Patrimonio_Liquido", "Cotas_Emitidas_Compl", "VP_Cota"]


def _selecionar(df: pd.DataFrame, mapa: dict[str, list[str]], nome_arquivo: str) -> pd.DataFrame:
    saida = {}
    for destino, candidatas in mapa.items():
        achou = next((c for c in candidatas if c in df.columns), None)
        if achou is None:
            log.warning("CVM %s: coluna %s não encontrada (colunas: %s)", nome_arquivo, candidatas, list(df.columns))
            continue
        saida[destino] = df[achou]
    return pd.DataFrame(saida)


def ler_zip_cvm(conteudo: bytes) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Devolve (geral, complemento) já com as colunas renomeadas."""
    z = zipfile.ZipFile(io.BytesIO(conteudo))
    partes = {}
    for nome in z.namelist():
        tipo = "geral" if "_geral_" in nome else "complemento" if "_complemento_" in nome else None
        if tipo is None:
            continue
        with z.open(nome) as f:
            bruto = pd.read_csv(f, sep=";", encoding="latin-1", dtype=str)
        partes[tipo] = _selecionar(bruto, COLUNAS_GERAL if tipo == "geral" else COLUNAS_COMPLEMENTO, nome)
    return partes["geral"], partes["complemento"]


def _normalizar(texto: str) -> str:
    import unicodedata
    t = unicodedata.normalize("NFKD", str(texto)).encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9 ]", " ", t)


_PALAVRAS_IGNORADAS = {"FII", "FUNDO", "DE", "DO", "DA", "DOS", "DAS", "E", "INVESTIMENTO", "IMOBILIARIO", "EX"}


def _palavras_nome(nome: str) -> set[str]:
    """Palavras significativas do nome do config, sem o que está entre parênteses."""
    sem_parenteses = re.sub(r"\(.*?\)", " ", nome)
    return {p for p in _normalizar(sem_parenteses).split() if len(p) >= 3 and p not in _PALAVRAS_IGNORADAS}


def _escolher_maior(cand: pd.DataFrame) -> str:
    """Entre vários CNPJs candidatos, fica com o de mais cotistas no informe
    mais recente. Fundo listado em bolsa tem milhares de cotistas; classes
    exclusivas ou fundos novos com o mesmo prefixo de ISIN têm 1 ou poucos."""
    ult = cand.sort_values("Data_Referencia").groupby("CNPJ").last()
    ordem = ult.assign(_c=ult["Cotistas"].fillna(0), _pl=ult["Patrimonio_Liquido"].fillna(0)).sort_values(["_c", "_pl"])
    return ordem.index[-1]


def mapear_tickers(base: pd.DataFrame, fundos: list[dict]) -> dict[str, str]:
    """Ticker -> CNPJ, nesta ordem:
    1. campo "cnpj" do fiis_config.json, quando existe;
    2. ISIN, que para FII segue o padrão BR + 4 letras do ticker + CTF...
       (ex: HGLG11 -> BRHGLGCTF004);
    3. nome do fundo (todas as palavras do "nome" do config aparecem no nome
       registrado na CVM). Cobre fundos que trocaram de ticker e mantiveram o
       ISIN antigo (ex: PCIP11, ex-CVBI11).
    Havendo mais de um candidato, vence o de mais cotistas (ver _escolher_maior).
    """
    mapa, sem_match = {}, []
    isin_raiz = base["ISIN"].fillna("").str.upper().str.slice(2, 6)
    nomes = base["Nome_CVM"].fillna("").map(_normalizar)
    for f in fundos:
        t = f["ticker"]
        if f.get("cnpj"):
            mapa[t] = f["cnpj"]
            continue
        cand = base[isin_raiz.eq(t[:4].upper())]
        via = "ISIN"
        if cand["CNPJ"].nunique() == 0:
            palavras = _palavras_nome(f.get("nome", ""))
            if palavras:
                cand = base[nomes.map(lambda n: palavras <= set(n.split()))]
                via = "nome"
        if cand["CNPJ"].nunique() == 0:
            sem_match.append(t)
            continue
        escolhido = _escolher_maior(cand)
        if cand["CNPJ"].nunique() > 1 or via == "nome":
            nome_cvm = cand.loc[cand["CNPJ"] == escolhido, "Nome_CVM"].dropna()
            log.info("CVM: %s -> %s (%s) via %s, entre %d candidato(s); confira e, se estiver errado, "
                     "informe o CNPJ certo no fiis_config.json", t, escolhido,
                     nome_cvm.iloc[-1] if len(nome_cvm) else "?", via, cand["CNPJ"].nunique())
        mapa[t] = escolhido
    if sem_match:
        log.warning("CVM: fundo não encontrado para %s — informe o CNPJ em fiis_config.json "
                    "(campo \"cnpj\", ex: \"cnpj\": \"11.728.688/0001-47\")", ", ".join(sem_match))
    return mapa


def processar_cvm(geral: pd.DataFrame, compl: pd.DataFrame, fundos: list[dict]) -> pd.DataFrame:
    for df in (geral, compl):
        for c in NUMERICAS_CVM:
            if c in df.columns:
                df[c] = _numero(df[c])
        df["Data_Referencia"] = pd.to_datetime(df["Data_Referencia"], errors="coerce")

    base = geral.merge(compl, on=["CNPJ", "Data_Referencia", "Versao"], how="outer")
    # Reentregas: a CVM guarda todas as versões; vale a maior.
    base = base.sort_values("Versao").drop_duplicates(["CNPJ", "Data_Referencia"], keep="last")
    for c in ("ISIN", "Nome_CVM", "Cotistas", "Patrimonio_Liquido"):
        if c not in base.columns:
            base[c] = pd.NA
    # O ISIN/nome só vem no arquivo "geral"; repete para os meses do mesmo CNPJ
    base[["ISIN", "Nome_CVM"]] = base.groupby("CNPJ")[["ISIN", "Nome_CVM"]].transform(lambda s: s.ffill().bfill())

    mapa = mapear_tickers(base, fundos)
    por_cnpj = {v: k for k, v in mapa.items()}
    base = base[base["CNPJ"].isin(por_cnpj)].copy()
    base["Ticker"] = base["CNPJ"].map(por_cnpj)

    if "Cotas_Emitidas_Compl" in base.columns:
        base["Cotas_Emitidas"] = base.get("Cotas_Emitidas", pd.Series(index=base.index, dtype=float)).fillna(base["Cotas_Emitidas_Compl"])
    # VP por cota: usa o informado; se faltar, calcula PL ÷ cotas
    if "VP_Cota" not in base.columns:
        base["VP_Cota"] = pd.NA
    calc = base["Patrimonio_Liquido"] / base["Cotas_Emitidas"].where(base["Cotas_Emitidas"] > 0)
    base["VP_Cota"] = pd.to_numeric(base["VP_Cota"], errors="coerce").fillna(calc)

    colunas = ["Ticker", "CNPJ", "Data_Referencia", "Patrimonio_Liquido", "Cotas_Emitidas", "VP_Cota",
               "Cotistas", "Valor_Ativo", "Segmento_CVM", "Mandato_CVM", "Nome_CVM"]
    for c in colunas:
        if c not in base.columns:
            base[c] = pd.NA
    return base[colunas].sort_values(["Ticker", "Data_Referencia"]).reset_index(drop=True)


def coletar_cvm(fundos: list[dict]) -> None:
    ano = date.today().year
    gerais, compls = [], []
    for a in (ano - 1, ano):  # ano anterior: dá a comparação de 12 meses
        try:
            g, c = ler_zip_cvm(baixar(URL_CVM.format(ano=a)))
            gerais.append(g)
            compls.append(c)
            log.info("CVM %d: %d informes", a, len(g))
        except Exception as e:
            log.warning("CVM %d indisponível: %s", a, e)
    if not gerais:
        raise RuntimeError("nenhum arquivo da CVM foi baixado")

    df = processar_cvm(pd.concat(gerais, ignore_index=True), pd.concat(compls, ignore_index=True), fundos)
    df["Data_Referencia"] = df["Data_Referencia"].dt.strftime("%Y-%m-%d")
    df.to_csv(ARQUIVO_CVM, sep=";", index=False, encoding="utf-8-sig")
    sem = sorted({f["ticker"] for f in fundos} - set(df["Ticker"]))
    log.info("'%s': %d linhas, %d fundos. Sem dados: %s", ARQUIVO_CVM.name, len(df), df["Ticker"].nunique(), sem or "nenhum")


# ---------------------------------------------------------------------------
# 2. Banco Central — SGS
# ---------------------------------------------------------------------------

SERIES_BCB = {
    "CDI_aa": 4389,        # CDI anualizado base 252, % a.a. (diária)
    "Selic_meta_aa": 432,  # Selic meta, % a.a.
    "IPCA_12m": 13522,     # IPCA acumulado em 12 meses, % (mensal)
}


def processar_bcb(nome: str, dados: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(dados)
    return pd.DataFrame({
        "Data": pd.to_datetime(df["data"], format="%d/%m/%Y"),
        "Indicador": nome,
        "Valor": _numero(df["valor"]),
    })


def coletar_bcb() -> None:
    inicio = (date.today() - timedelta(days=800)).strftime("%d/%m/%Y")
    partes = []
    for nome, cod in SERIES_BCB.items():
        url = f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{cod}/dados?formato=json&dataInicial={inicio}"
        partes.append(processar_bcb(nome, json.loads(baixar(url, timeout=60))))
    df = pd.concat(partes, ignore_index=True)
    df["Data"] = df["Data"].dt.strftime("%Y-%m-%d")
    df.to_csv(ARQUIVO_INDICADORES, sep=";", index=False, encoding="utf-8-sig")
    ultimos = {n: g.iloc[-1]["Valor"] for n, g in df.groupby("Indicador")}
    log.info("'%s': %d linhas. Últimos valores: %s", ARQUIVO_INDICADORES.name, len(df), ultimos)


# ---------------------------------------------------------------------------
# 3. Fundamentus (opcional)
# ---------------------------------------------------------------------------

URL_FUNDAMENTUS = "https://www.fundamentus.com.br/fii_resultado.php"
COLUNAS_FUNDAMENTUS = {
    "Papel": "Ticker",
    "P/VP": "P_VP_Fundamentus",
    "Dividend Yield": "DY_Fundamentus_%",
    "FFO Yield": "FFO_Yield_%",
    "Valor de Mercado": "Valor_Mercado",
    "Qtd de imóveis": "Qtd_Imoveis",
    "Cap Rate": "Cap_Rate_%",
    "Vacância Média": "Vacancia_%",
}


def processar_fundamentus(html: str, tickers: set[str]) -> pd.DataFrame:
    tabela = pd.read_html(io.StringIO(html), decimal=",", thousands=".")[0]
    faltando = [c for c in COLUNAS_FUNDAMENTUS if c not in tabela.columns]
    if faltando:
        raise RuntimeError(f"layout do Fundamentus mudou; colunas ausentes: {faltando}")
    df = tabela[list(COLUNAS_FUNDAMENTUS)].rename(columns=COLUNAS_FUNDAMENTUS)
    df = df[df["Ticker"].isin(tickers)].copy()
    for c in df.columns[1:]:
        df[c] = _numero(df[c])
    # O Fundamentus mostra 0,00% quando não tem o dado (ex: fundo de papel não
    # tem vacância nem imóveis). Guardamos como vazio para não confundir com
    # "vacância zero" de verdade.
    sem_imoveis = df["Qtd_Imoveis"].fillna(0) == 0
    for c in ("Cap_Rate_%", "Vacancia_%"):
        df.loc[sem_imoveis, c] = pd.NA
    # Cap rate 0 também é "sem dado" (ex: fundo de papel com 1 ou 2 imóveis residuais)
    df.loc[df["Cap_Rate_%"] == 0, "Cap_Rate_%"] = pd.NA
    df.insert(1, "Data_Coleta", date.today().isoformat())
    return df


def coletar_fundamentus(fundos: list[dict]) -> None:
    html = baixar(URL_FUNDAMENTUS, timeout=60).decode("latin-1")
    novo = processar_fundamentus(html, {f["ticker"] for f in fundos})
    antigo = carregar_fundamentus()
    if len(antigo):
        antigo["Data_Coleta"] = antigo["Data_Coleta"].dt.strftime("%Y-%m-%d")
        novo = pd.concat([antigo, novo], ignore_index=True)
    novo = novo.drop_duplicates(["Ticker", "Data_Coleta"], keep="last").sort_values(["Data_Coleta", "Ticker"])
    novo.to_csv(ARQUIVO_FUNDAMENTUS, sep=";", index=False, encoding="utf-8-sig")
    log.info("'%s': %d linhas (%d fundos na coleta de hoje).", ARQUIVO_FUNDAMENTUS.name, len(novo),
             (novo["Data_Coleta"] == date.today().isoformat()).sum())


# ---------------------------------------------------------------------------

def main(fontes: list[str] | None = None) -> int:
    fundos = carregar_config()
    etapas = {
        "cvm": lambda: coletar_cvm(fundos),
        "bcb": coletar_bcb,
        "fundamentus": lambda: coletar_fundamentus(fundos),
    }
    fontes = fontes or list(etapas)
    falhas = []
    for nome in fontes:
        try:
            etapas[nome]()
        except Exception as e:
            log.error("Fonte %s falhou: %s", nome, e)
            falhas.append(nome)
    if falhas:
        log.warning("Fontes com falha: %s (os CSVs anteriores foram mantidos)", falhas)
    # Fundamentus é opcional: só ele falhar não é erro
    return 1 if set(falhas) - {"fundamentus"} else 0


if __name__ == "__main__":
    sys.exit(main([a.lower() for a in sys.argv[1:]] or None))
