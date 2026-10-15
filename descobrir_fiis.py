"""
descobrir_fiis.py
------------------
Procura TODOS os FIIs negociados na B3 nas fontes que o projeto já usa e diz
quais dá para acompanhar no site.

Fontes (as mesmas da coleta diária):
  1. Fundamentus (fii_resultado.php): lista de FIIs, com segmento e liquidez.
  2. CVM (informe mensal): CNPJ, nome registrado e número de cotistas. O ISIN
     da cota tem as 4 letras do ticker (HGLG11 -> BRHGLGCTF004), o que pega
     também fundos que o Fundamentus não lista.
  3. Yahoo Finance: confirma que há cotação recente. É de lá que vêm preço,
     volume e rendimentos; fundo sem cotação no Yahoo não tem como entrar.

Uso:
    python descobrir_fiis.py                          # só o relatório
    python descobrir_fiis.py --aplicar                # inclui os disponíveis no fiis_config.json
    python descobrir_fiis.py --aplicar --liquidez-minima 50000   # só quem negocia >= R$ 50 mil/dia
    python descobrir_fiis.py --reclassificar          # refaz tipo/segmento dos fundos "auto" (sem Yahoo)

Saída: descoberta_fiis.csv (um fundo por linha, com o status de cada um).

Fundos incluídos automaticamente ganham "origem": "auto" no config. O nome vem
do registro na CVM. O tipo de gestão vem da COMPOSIÇÃO da carteira no informe
mensal da CVM (>= 60% em CRI/LCI = Papel, em cotas de FII = FoF, em imóveis =
Tijolo, senão Híbrido); o segmento vem do Fundamentus ou, quando ele é genérico
("Multicategoria", "Outros"), do nome do fundo (fiis_common.classificar_fundo). Vale
revisar no config os fundos que você mais acompanha; os que já estavam lá não
são alterados.
"""

from __future__ import annotations

import argparse
import io
import json
import re
from datetime import date

import pandas as pd

import coletar_fundamentos as cf
from fiis_common import (
    ARQUIVO_CONFIG,
    PASTA_BASE,
    carregar_config,
    classificar_fundo,
    configurar_logging,
)

log = configurar_logging()

ARQUIVO_RELATORIO = PASTA_BASE / "descoberta_fiis.csv"
PADRAO_TICKER = re.compile(r"^[A-Z]{4}1[1-3]$")
MIN_COTISTAS_CVM = 50   # fundo listado em bolsa tem centenas/milhares; abaixo disso é classe exclusiva
DIAS_TOLERANCIA = 15    # última cotação no Yahoo até 15 dias antes da mais recente de todas

ST_MONITORADO = "já monitorado"
ST_DISPONIVEL = "disponível"
ST_SEM_YAHOO = "sem cotação recente no Yahoo"
ST_SEM_NEGOCIO = "sem negócios no último mês"
ST_ILIQUIDO = "abaixo da liquidez mínima"


# ---------------------------------------------------------------------------
# 1. Fundamentus
# ---------------------------------------------------------------------------

def ler_lista_fundamentus(html: str) -> pd.DataFrame:
    """Tabela fii_resultado.php -> Ticker, Segmento_Fundamentus, Liquidez_Fundamentus."""
    tabela = pd.read_html(io.StringIO(html), decimal=",", thousands=".")[0]
    if "Papel" not in tabela.columns:
        raise RuntimeError(f"layout do Fundamentus mudou; colunas: {list(tabela.columns)}")
    df = pd.DataFrame({"Ticker": tabela["Papel"].astype(str).str.strip().str.upper()})
    df["Segmento_Fundamentus"] = tabela["Segmento"].astype(str).str.strip() if "Segmento" in tabela else ""
    df["Segmento_Fundamentus"] = df["Segmento_Fundamentus"].replace({"nan": ""})
    df["Liquidez_Fundamentus"] = cf._numero(tabela["Liquidez"]) if "Liquidez" in tabela else pd.NA
    df = df[df["Ticker"].str.match(PADRAO_TICKER)]
    return df.drop_duplicates("Ticker").reset_index(drop=True)


# ---------------------------------------------------------------------------
# 2. CVM
# ---------------------------------------------------------------------------

def ler_cadastro_cvm(geral: pd.DataFrame, compl: pd.DataFrame) -> pd.DataFrame:
    """Informe mensal -> uma linha por raiz de ticker (4 letras do ISIN):
    Raiz, CNPJ, Nome_CVM, Segmento_CVM, Cotistas. Havendo mais de um CNPJ com a
    mesma raiz, fica o de mais cotistas (o fundo listado)."""
    g = geral.copy()
    g["Data_Referencia"] = pd.to_datetime(g["Data_Referencia"], errors="coerce")
    g = g.sort_values("Data_Referencia")
    isin = g["ISIN"].fillna("").str.upper().str.strip()
    g = g[isin.str.match(r"^BR[A-Z]{4}CTF")].copy()
    g["Raiz"] = g["ISIN"].str.upper().str.slice(2, 6)
    ultimo = g.groupby("CNPJ").last().reset_index()

    c = compl.copy()
    c["Data_Referencia"] = pd.to_datetime(c["Data_Referencia"], errors="coerce")
    c["Cotistas"] = cf._numero(c["Cotistas"]) if "Cotistas" in c else pd.NA
    cot = c.dropna(subset=["Cotistas"]).sort_values("Data_Referencia").groupby("CNPJ")["Cotistas"].last()
    ultimo["Cotistas"] = ultimo["CNPJ"].map(cot)

    ultimo = ultimo.sort_values("Cotistas", na_position="first").drop_duplicates("Raiz", keep="last")
    colunas = ["Raiz", "CNPJ", "Nome_CVM", "Segmento_CVM", "Cotistas"]
    for col in colunas:
        if col not in ultimo:
            ultimo[col] = pd.NA
    return ultimo[colunas].reset_index(drop=True)


# Colunas do arquivo inf_mensal_fii_ativo_passivo (nomes normalizados: sem "_", minúsculas)
_COLS_PAPEL = {"cri", "lci", "lh", "lig", "letrashipotecarias", "letrascreditoimobiliario",
               "letrasimobiliariasgarantidas", "certificadosrecebiveisimobiliarios"}
_COLS_FII = {"fii", "cotasfii", "cotasdefii", "cotasfundosinvestimentoimobiliario"}
_COLS_IMOVEIS = {"terrenos", "imoveisrendaacabados", "imoveisrendaconstrucao", "imoveisvendaacabados",
                 "imoveisvendaconstrucao", "outrosdireitosreais"}
_COLS_IMOVEIS_TOTAL = {"direitosbensimoveis"}
_COLS_SPE = {"acoessociedadesatividadesfii", "cotassociedadesatividadesfii"}  # SPEs donas de imóveis


def _norm_col(c: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(c).lower())


def ler_composicao_cvm(conteudo_zip: bytes) -> pd.DataFrame:
    """Composição da carteira no informe mais recente de cada fundo:
    CNPJ, Pct_Papel, Pct_FII, Pct_Imoveis (frações de papel + FII + imóveis;
    caixa e renda fixa ficam de fora). DataFrame vazio se o arquivo não vier."""
    import zipfile

    vazio = pd.DataFrame(columns=["CNPJ", "Pct_Papel", "Pct_FII", "Pct_Imoveis"])
    z = zipfile.ZipFile(io.BytesIO(conteudo_zip))
    nome = next((n for n in z.namelist() if "_ativo_passivo_" in n), None)
    if nome is None:
        log.warning("CVM: arquivo de ativo/passivo não está no zip; classificando só por segmento e nome")
        return vazio
    with z.open(nome) as f:
        bruto = pd.read_csv(f, sep=";", encoding="latin-1", dtype=str)
    cols = {_norm_col(c): c for c in bruto.columns}
    cnpj = next((cols[k] for k in ("cnpjfundoclasse", "cnpjfundo") if k in cols), None)
    achadas = {g: [cols[k] for k in nomes if k in cols]
               for g, nomes in (("papel", _COLS_PAPEL), ("fii", _COLS_FII), ("imoveis", _COLS_IMOVEIS),
                                ("total", _COLS_IMOVEIS_TOTAL), ("spe", _COLS_SPE))}
    if cnpj is None or not achadas["papel"] or not achadas["fii"] or not (achadas["imoveis"] or achadas["total"]):
        log.warning("CVM ativo/passivo: colunas esperadas não encontradas (achei %s); classificando só por "
                    "segmento e nome. Colunas do arquivo: %s", achadas, list(bruto.columns))
        return vazio

    def soma(lista):
        total = pd.Series(0.0, index=bruto.index)
        for c in lista:
            total = total + cf._numero(bruto[c]).fillna(0)
        return total

    df = pd.DataFrame({"CNPJ": bruto[cnpj]})
    df["Data_Referencia"] = pd.to_datetime(bruto[cols["datareferencia"]], errors="coerce") if "datareferencia" in cols else pd.NaT
    df["Versao"] = cf._numero(bruto[cols["versao"]]) if "versao" in cols else 0
    df["papel"] = soma(achadas["papel"])
    df["fii"] = soma(achadas["fii"])
    df["imoveis"] = pd.concat([soma(achadas["imoveis"]), soma(achadas["total"])], axis=1).max(axis=1) + soma(achadas["spe"])
    df = df.sort_values(["Data_Referencia", "Versao"]).drop_duplicates("CNPJ", keep="last")
    partes = df[["papel", "fii", "imoveis"]].clip(lower=0)
    base = partes.sum(axis=1)
    ok = base > 0
    saida = pd.DataFrame({
        "CNPJ": df.loc[ok, "CNPJ"],
        "Pct_Papel": (partes.loc[ok, "papel"] / base[ok]).round(3),
        "Pct_FII": (partes.loc[ok, "fii"] / base[ok]).round(3),
        "Pct_Imoveis": (partes.loc[ok, "imoveis"] / base[ok]).round(3),
    })
    log.info("CVM: composição da carteira de %d fundos (colunas usadas: %s)", len(saida),
             {k: v for k, v in achadas.items() if v})
    return saida.reset_index(drop=True)


def _composicao(linha) -> dict | None:
    v = {k: linha.get(c) for k, c in (("papel", "Pct_Papel"), ("fii", "Pct_FII"), ("imoveis", "Pct_Imoveis"))}
    if all(x is None or pd.isna(x) for x in v.values()):
        return None
    return {k: (0.0 if x is None or pd.isna(x) else float(x)) for k, x in v.items()}


_LIXO_NOME = [
    r"FUNDO DE INVESTIMENTO IMOBILI[AÁ]RIO", r"FUNDO DE INVESTIMENTO", r"\bFII\b", r"\bFI\b",
    r"RESPONSABILIDADE LIMITADA", r"RESP\.? LIMITADA", r"RESP\.? LTDA", r"RESPONSABIL\w*", r"\bLTDA\b", r"\bRL\b",
    r"CLASSE [ÚU]NICA", r"\bDE COTAS\b",
]
_MINUSCULAS = {"de", "da", "do", "das", "dos", "e"}
_SIGLAS = {"XP", "BTG", "BTGP", "VBI", "HSI", "TRX", "RBR", "CSHG", "GGR", "TG", "BB", "CRI", "REC", "JS", "HGI",
           "VX", "II", "III", "IV", "SP", "RJ", "FOF", "FOFII", "RB", "TRX", "BC", "BR", "CPTS", "XPI"}


def nome_curto(nome_cvm) -> str:
    """'KINEA RENDIMENTOS IMOBILIARIOS FII RESPONSABILIDADE LIMITADA' -> 'Kinea Rendimentos Imobiliarios'."""
    if not isinstance(nome_cvm, str) or not nome_cvm.strip():
        return ""
    t = nome_cvm.upper()
    for padrao in _LIXO_NOME:
        t = re.sub(padrao, " ", t)
    t = re.sub(r"[\s\-–,.]+$", "", re.sub(r"^[\s\-–,.]+", "", re.sub(r"\s+", " ", t))).strip()
    t = re.sub(r"\s*-\s*$", "", t)
    palavras = []
    for i, p in enumerate(t.split()):
        limpa = re.sub(r"[^A-Z0-9]", "", p)
        if limpa in _SIGLAS:
            palavras.append(p)
        elif i > 0 and p.lower() in _MINUSCULAS:
            palavras.append(p.lower())
        else:
            palavras.append(p.capitalize())
    return " ".join(palavras).replace(" - ", " ").strip(" -")


# ---------------------------------------------------------------------------
# 3. Yahoo Finance
# ---------------------------------------------------------------------------

def _baixar_yahoo(tickers_yf: list[str]) -> pd.DataFrame:
    import yfinance as yf

    return yf.download(tickers_yf, period="1mo", group_by="ticker", auto_adjust=False,
                       progress=False, threads=True)


def _serie_ticker(dados: pd.DataFrame, ticker_yf: str) -> pd.DataFrame | None:
    if dados is None or dados.empty:
        return None
    if isinstance(dados.columns, pd.MultiIndex):
        if ticker_yf not in dados.columns.get_level_values(0):
            return None
        return dados[ticker_yf]
    return dados  # download de um ticker só, sem MultiIndex


def checar_yahoo(tickers: list[str], baixar=_baixar_yahoo, lote: int = 80) -> pd.DataFrame:
    """Último mês de cada ticker no Yahoo: última data, último preço, quantos
    pregões tiveram negócio e o volume financeiro médio (R$/dia)."""
    linhas = []
    for i in range(0, len(tickers), lote):
        parte = tickers[i:i + lote]
        log.info("Yahoo: conferindo %d-%d de %d...", i + 1, i + len(parte), len(tickers))
        try:
            dados = baixar([f"{t}.SA" for t in parte])
        except Exception as e:  # rede/instabilidade: o lote todo fica "sem cotação"
            log.warning("Yahoo falhou para o lote %d: %s", i // lote + 1, e)
            dados = None
        for t in parte:
            serie = _serie_ticker(dados, f"{t}.SA")
            linha = {"Ticker": t, "Yahoo_Ultimo_Pregao": None, "Yahoo_Preco": None,
                     "Dias_Com_Negocio": 0, "Volume_Fin_Medio_Yahoo": None}
            if serie is not None and "Close" in serie:
                s = serie.dropna(subset=["Close"])
                if len(s):
                    vol = pd.to_numeric(s.get("Volume"), errors="coerce").fillna(0)
                    idx = pd.to_datetime(s.index)
                    linha.update({
                        "Yahoo_Ultimo_Pregao": idx.max().date().isoformat(),
                        "Yahoo_Preco": round(float(s["Close"].iloc[-1]), 2),
                        "Dias_Com_Negocio": int((vol > 0).sum()),
                        "Volume_Fin_Medio_Yahoo": round(float((s["Close"] * vol).mean()), 2),
                    })
            linhas.append(linha)
    return pd.DataFrame(linhas)


# ---------------------------------------------------------------------------
# Relatório e inclusão no config
# ---------------------------------------------------------------------------

def candidatos(fund: pd.DataFrame, cvm: pd.DataFrame, monitorados: set[str]) -> list[str]:
    """Todos os tickers do Fundamentus + raiz do ISIN dos fundos da CVM com
    cotistas suficientes para serem listados em bolsa (+ "11") + os do config."""
    universo = set(fund["Ticker"]) if len(fund) else set()
    if len(cvm):
        listados = cvm[pd.to_numeric(cvm["Cotistas"], errors="coerce").fillna(0) >= MIN_COTISTAS_CVM]
        universo |= {f"{r}11" for r in listados["Raiz"]}
    return sorted(universo | set(monitorados))


def montar_relatorio(fund: pd.DataFrame, cvm: pd.DataFrame, yahoo: pd.DataFrame,
                     monitorados: set[str], liquidez_minima: float = 0) -> pd.DataFrame:
    """Junta as três fontes e dá um status para cada ticker."""
    universo = candidatos(fund, cvm, monitorados)

    df = pd.DataFrame({"Ticker": sorted(universo)})
    df["Raiz"] = df["Ticker"].str.slice(0, 4)
    df = df.merge(fund, on="Ticker", how="left") if len(fund) else df.assign(Segmento_Fundamentus="", Liquidez_Fundamentus=pd.NA)
    df = df.merge(cvm, on="Raiz", how="left") if len(cvm) else df.assign(CNPJ=pd.NA, Nome_CVM=pd.NA, Segmento_CVM=pd.NA, Cotistas=pd.NA)
    df = df.merge(yahoo, on="Ticker", how="left")

    df["Nome"] = df["Nome_CVM"].map(nome_curto)
    df.loc[df["Nome"] == "", "Nome"] = df["Ticker"]
    seg_origem = df["Segmento_Fundamentus"].fillna("").astype(str)
    seg_origem = seg_origem.where(seg_origem.str.strip() != "", df["Segmento_CVM"].fillna("").astype(str))
    for c in ("Pct_Papel", "Pct_FII", "Pct_Imoveis"):
        if c not in df:
            df[c] = pd.NA
    nomes = df["Nome_CVM"].fillna("").astype(str)
    nomes = nomes.where(nomes.str.strip() != "", df["Nome"])
    classif = [classificar_fundo(s, n, _composicao(linha))
               for s, n, (_, linha) in zip(seg_origem, nomes, df.iterrows())]
    df["Segmento_Padrao"] = [c[0] for c in classif]
    df["Tipo_Gestao"] = [c[1] for c in classif]

    ultimas = pd.to_datetime(df["Yahoo_Ultimo_Pregao"], errors="coerce")
    corte = ultimas.max() - pd.Timedelta(days=DIAS_TOLERANCIA) if ultimas.notna().any() else None
    vol = pd.to_numeric(df["Volume_Fin_Medio_Yahoo"], errors="coerce").fillna(0)
    dias = pd.to_numeric(df["Dias_Com_Negocio"], errors="coerce").fillna(0)

    def status(i: int) -> str:
        if df.at[i, "Ticker"] in monitorados:
            return ST_MONITORADO
        if corte is None or pd.isna(ultimas.iloc[i]) or ultimas.iloc[i] < corte:
            return ST_SEM_YAHOO
        if dias.iloc[i] == 0:
            return ST_SEM_NEGOCIO
        if vol.iloc[i] < liquidez_minima:
            return ST_ILIQUIDO
        return ST_DISPONIVEL

    df["Status"] = [status(i) for i in range(len(df))]
    colunas = ["Ticker", "Status", "Nome", "Tipo_Gestao", "Segmento_Padrao", "Segmento_Fundamentus",
               "Volume_Fin_Medio_Yahoo", "Dias_Com_Negocio", "Liquidez_Fundamentus", "Yahoo_Ultimo_Pregao",
               "Yahoo_Preco", "CNPJ", "Nome_CVM", "Cotistas", "Pct_Papel", "Pct_FII", "Pct_Imoveis"]
    return df[colunas].sort_values(["Status", "Volume_Fin_Medio_Yahoo"], ascending=[True, False]).reset_index(drop=True)


def _texto(v) -> str:
    return "" if v is None or (isinstance(v, float) and pd.isna(v)) or v is pd.NA else str(v)


def novos_fundos(relatorio: pd.DataFrame) -> list[dict]:
    """Linhas "disponível" do relatório no formato do fiis_config.json."""
    novos = []
    for _, r in relatorio[relatorio["Status"] == ST_DISPONIVEL].iterrows():
        f = {
            "ticker": r["Ticker"],
            "nome": _texto(r["Nome"]) or r["Ticker"],
            "gestora": "",
            "tipo_gestao": r["Tipo_Gestao"],
            "segmento": r["Segmento_Padrao"],
            "segmento_padrao": r["Segmento_Padrao"],
        }
        if _texto(r["CNPJ"]):
            f["cnpj"] = _texto(r["CNPJ"])
        f["origem"] = "auto"
        novos.append(f)
    return novos


def gravar_config(config: dict, caminho=ARQUIVO_CONFIG) -> None:
    """Mesmo formato do arquivo escrito à mão: um fundo por linha."""
    linhas = ["{"]
    for k, v in config.items():
        if k == "fundos":
            continue
        linhas.append(f"  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},")
    fundos = [f"    {json.dumps(f, ensure_ascii=False)}" for f in config["fundos"]]
    linhas.append('  "fundos": [')
    linhas.append(",\n".join(fundos))
    linhas.append("  ]")
    linhas.append("}")
    caminho.write_text("\n".join(linhas) + "\n", encoding="utf-8")


def aplicar(relatorio: pd.DataFrame, caminho=ARQUIVO_CONFIG) -> list[str]:
    """Acrescenta ao config os fundos "disponível" que ainda não estão lá.
    Não altera nem remove os que já existem."""
    config = json.loads(caminho.read_text(encoding="utf-8"))
    existentes = {f["ticker"] for f in config["fundos"]}
    novos = [f for f in novos_fundos(relatorio) if f["ticker"] not in existentes]
    config.setdefault("_comentario_auto", (
        'Fundos com "origem": "auto" foram incluídos pelo descobrir_fiis.py: nome da CVM, tipo e segmento '
        "deduzidos do segmento do Fundamentus. Pode corrigir à mão; apague o campo origem se revisar."))
    config["fundos"].extend(novos)
    gravar_config(config, caminho)
    return [f["ticker"] for f in novos]


def reclassificar(relatorio: pd.DataFrame, caminho=ARQUIVO_CONFIG) -> dict[str, tuple[str, str]]:
    """Refaz tipo de gestão e segmento dos fundos "origem": "auto" do config com
    a classificação do relatório (completa CNPJ e nome quando faltavam). Os
    escolhidos à mão não mudam. Devolve {ticker: (tipo antigo, tipo novo)} dos que mudaram de tipo."""
    config = json.loads(caminho.read_text(encoding="utf-8"))
    rel = relatorio.set_index("Ticker")
    mudou = {}
    for f in config["fundos"]:
        if f.get("origem") != "auto" or f["ticker"] not in rel.index:
            continue
        r = rel.loc[f["ticker"]]
        if f.get("tipo_gestao") != r["Tipo_Gestao"]:
            mudou[f["ticker"]] = (f.get("tipo_gestao"), r["Tipo_Gestao"])
        f["tipo_gestao"] = r["Tipo_Gestao"]
        f["segmento"] = f["segmento_padrao"] = r["Segmento_Padrao"]
        if not f.get("cnpj") and _texto(r["CNPJ"]):
            f["cnpj"] = _texto(r["CNPJ"])
        if f.get("nome") in ("", f["ticker"]) and _texto(r["Nome"]) not in ("", f["ticker"]):
            f["nome"] = _texto(r["Nome"])
    # "origem" continua sendo a última chave da linha
    config["fundos"] = [{**{k: v for k, v in f.items() if k != "origem"},
                         **({"origem": f["origem"]} if "origem" in f else {})} for f in config["fundos"]]
    config["_comentario_auto"] = (
        'Fundos com "origem": "auto" foram incluídos pelo descobrir_fiis.py: nome da CVM; tipo pela composição '
        "da carteira no informe da CVM; segmento pelo Fundamentus ou pelo nome. Pode corrigir à mão; apague o "
        "campo origem se revisar (aí o --reclassificar não mexe mais nele).")
    gravar_config(config, caminho)
    return mudou


def conferir_com_manuais(relatorio: pd.DataFrame, fundos: list[dict]) -> None:
    """Mede a classificação automática contra os fundos classificados à mão."""
    rel = relatorio.set_index("Ticker")
    manuais = [f for f in fundos if f.get("origem") != "auto" and f["ticker"] in rel.index]
    if not manuais:
        return
    diferentes = [f"{f['ticker']} (à mão {f['tipo_gestao']}, automático {rel.loc[f['ticker'], 'Tipo_Gestao']})"
                  for f in manuais if rel.loc[f["ticker"], "Tipo_Gestao"] != f["tipo_gestao"]]
    log.info("Conferência com os fundos classificados à mão: %d de %d com o mesmo tipo de gestão.",
             len(manuais) - len(diferentes), len(manuais))
    if diferentes:
        log.info("  Diferentes: %s", "; ".join(diferentes))


def _faixa_liquidez(v) -> str:
    v = 0 if pd.isna(v) else float(v)
    if v >= 1_000_000:
        return "acima de R$ 1 mi/dia"
    if v >= 100_000:
        return "R$ 100 mil a 1 mi/dia"
    if v >= 10_000:
        return "R$ 10 mil a 100 mil/dia"
    return "abaixo de R$ 10 mil/dia"


def resumir(relatorio: pd.DataFrame) -> None:
    log.info("Tickers encontrados: %d", len(relatorio))
    for st, n in relatorio["Status"].value_counts().items():
        log.info("  %-32s %d", st, n)
    disp = relatorio[relatorio["Status"] == ST_DISPONIVEL]
    if len(disp):
        log.info("Disponíveis por segmento: %s", disp["Segmento_Padrao"].value_counts().to_dict())
        log.info("Disponíveis por liquidez: %s",
                 disp["Volume_Fin_Medio_Yahoo"].map(_faixa_liquidez).value_counts().to_dict())


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Descobre FIIs disponíveis nas fontes do projeto")
    p.add_argument("--aplicar", action="store_true", help="inclui os disponíveis no fiis_config.json")
    p.add_argument("--reclassificar", action="store_true",
                   help="refaz tipo e segmento dos fundos com origem auto (não consulta o Yahoo)")
    p.add_argument("--liquidez-minima", type=float, default=0,
                   help="volume financeiro médio mínimo no último mês, em R$/dia (padrão 0 = todos com negócio)")
    a = p.parse_args(argv)

    try:
        html = cf.baixar(cf.URL_FUNDAMENTUS, timeout=60).decode("latin-1")
        fund = ler_lista_fundamentus(html)
        log.info("Fundamentus: %d FIIs na lista", len(fund))
    except Exception as e:
        log.warning("Fundamentus indisponível (%s); seguindo só com a CVM", e)
        fund = pd.DataFrame(columns=["Ticker", "Segmento_Fundamentus", "Liquidez_Fundamentus"])

    gerais, compls, composicao = [], [], None
    ano = date.today().year
    for a_ in (ano, ano - 1):
        try:
            conteudo = cf.baixar(cf.URL_CVM.format(ano=a_))
            g, c = cf.ler_zip_cvm(conteudo)
            gerais.append(g)
            compls.append(c)
            log.info("CVM %d: %d informes", a_, len(g))
            try:
                composicao = ler_composicao_cvm(conteudo)
            except Exception as e:  # composição é um extra: sem ela, classifica por segmento e nome
                log.warning("CVM: não deu para ler a composição da carteira (%s)", e)
            break  # o ano corrente basta para o cadastro; o anterior só se ele faltar
        except Exception as e:
            log.warning("CVM %d indisponível: %s", a_, e)
    cvm = ler_cadastro_cvm(pd.concat(gerais), pd.concat(compls)) if gerais else \
        pd.DataFrame(columns=["Raiz", "CNPJ", "Nome_CVM", "Segmento_CVM", "Cotistas"])
    if composicao is not None and len(composicao) and len(cvm):
        cvm = cvm.merge(composicao, on="CNPJ", how="left")
    log.info("CVM: %d fundos com ISIN de cota", len(cvm))

    if fund.empty and cvm.empty:
        log.error("Nenhuma das listas (Fundamentus, CVM) foi baixada; nada a fazer.")
        return 1

    fundos = carregar_config()
    monitorados = {f["ticker"] for f in fundos}
    if a.reclassificar:
        vazio = pd.DataFrame(columns=["Ticker", "Yahoo_Ultimo_Pregao", "Yahoo_Preco", "Dias_Com_Negocio",
                                      "Volume_Fin_Medio_Yahoo"])
        rel = montar_relatorio(fund, cvm, vazio, monitorados)
        conferir_com_manuais(rel, fundos)
        mudou = reclassificar(rel)
        log.info("Reclassificação: %d fundo(s) mudaram de tipo de gestão.", len(mudou))
        auto = [f for f in carregar_config() if f.get("origem") == "auto"]
        log.info("Fundos auto por tipo: %s", pd.Series([f["tipo_gestao"] for f in auto]).value_counts().to_dict())
        log.info("Fundos auto por segmento: %s",
                 pd.Series([f["segmento_padrao"] for f in auto]).value_counts().to_dict())
        log.info("Agora rode de novo o gerar_dados_site.py (e o ingest do site) para os pares e filtros "
                 "usarem a nova classificação.")
        return 0

    lista = candidatos(fund, cvm, monitorados)
    log.info("%d tickers candidatos; conferindo cotação no Yahoo...", len(lista))
    yahoo = checar_yahoo(lista)
    rel = montar_relatorio(fund, cvm, yahoo, monitorados, a.liquidez_minima)
    conferir_com_manuais(rel, fundos)
    rel.to_csv(ARQUIVO_RELATORIO, sep=";", index=False, encoding="utf-8-sig")
    log.info("Relatório gravado em '%s'.", ARQUIVO_RELATORIO.name)
    resumir(rel)

    sem_yahoo = rel[(rel["Status"] == ST_MONITORADO) & rel["Yahoo_Ultimo_Pregao"].isna()]
    if len(sem_yahoo):
        log.warning("Monitorados sem cotação no Yahoo nesta checagem: %s", ", ".join(sem_yahoo["Ticker"]))

    if a.aplicar:
        incluidos = aplicar(rel)
        log.info("%d fundos incluídos no %s. Agora rode a coleta (atualizador_fiis.py faz a carga de 1 ano "
                 "dos fundos novos automaticamente).", len(incluidos), ARQUIVO_CONFIG.name)
    else:
        n = (rel["Status"] == ST_DISPONIVEL).sum()
        log.info("Nada foi alterado. Para incluir os %d disponíveis: python descobrir_fiis.py --aplicar", n)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
