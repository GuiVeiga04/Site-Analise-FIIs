"""
testar_fontes.py
-----------------
Verificação rápida das fontes de dados do projeto, antes de construir as
fases 2 e 3. Não grava nada na base: só testa se cada fonte responde e se o
formato é o esperado, e salva um resumo em testar_fontes_resultado.txt.

    python testar_fontes.py

Fontes testadas:
  1. Yahoo Finance (yfinance) — rendimentos de 3 FIIs        [fase 1]
  2. CVM Dados Abertos — informe mensal de FII (VP, PL...)   [fase 2]
  3. Banco Central (SGS) — CDI e IPCA                        [fase 2]
  4. Fundamentus — tabela de FIIs (vacância, cap rate)       [fase 2, opcional]
"""

from __future__ import annotations

import io
import json
import traceback
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
TICKERS_TESTE = ["HGLG11", "MXRF11", "KNCR11"]
linhas: list[str] = []


def log(msg: str) -> None:
    print(msg)
    linhas.append(msg)


def baixar(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def teste(nome):
    def deco(fn):
        def run():
            log(f"\n=== {nome}")
            try:
                fn()
                log("RESULTADO: OK")
                return True
            except Exception as e:
                log(f"RESULTADO: FALHOU — {type(e).__name__}: {e}")
                linhas.append(traceback.format_exc())
                return False
        return run
    return deco


@teste("1. Yahoo Finance — rendimentos")
def t_yahoo():
    import yfinance as yf

    for t in TICKERS_TESTE:
        d = yf.Ticker(f"{t}.SA").dividends
        if d.empty:
            raise RuntimeError(f"{t}: nenhum rendimento")
        ult = d.tail(3)
        log(f"{t}: {len(d)} rendimentos desde {d.index.min().date()}; últimos: "
            + ", ".join(f"{i.date()} R$ {v:.4f}" for i, v in ult.items()))


@teste("2. CVM — informe mensal de FII")
def t_cvm():
    ano = date.today().year
    url = f"https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_{ano}.zip"
    conteudo = baixar(url, timeout=120)
    z = zipfile.ZipFile(io.BytesIO(conteudo))
    log(f"{url} -> {len(conteudo) / 1e6:.1f} MB, arquivos: {z.namelist()}")
    for nome in z.namelist():
        with z.open(nome) as f:
            cabecalho = f.readline().decode("latin-1").strip()
        log(f"  {nome}: {cabecalho[:300]}")


@teste("3. Banco Central (SGS) — CDI e IPCA")
def t_bcb():
    series = {"CDI anualizado (4389)": 4389, "Selic meta (432)": 432, "IPCA mensal (433)": 433}
    for nome, cod in series.items():
        url = f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{cod}/dados/ultimos/1?formato=json"
        dados = json.loads(baixar(url))
        log(f"{nome}: {dados}")


@teste("4. Fundamentus — tabela de FIIs (opcional)")
def t_fundamentus():
    import pandas as pd

    html = baixar("https://www.fundamentus.com.br/fii_resultado.php").decode("latin-1")
    tabela = pd.read_html(io.StringIO(html), decimal=",", thousands=".")[0]
    log(f"{len(tabela)} FIIs, colunas: {list(tabela.columns)}")
    amostra = tabela[tabela.iloc[:, 0].isin(TICKERS_TESTE)]
    log(amostra.to_string(index=False))


if __name__ == "__main__":
    resultados = {n: f() for n, f in [("yahoo", t_yahoo), ("cvm", t_cvm), ("bcb", t_bcb), ("fundamentus", t_fundamentus)]}
    log("\n=== Resumo: " + " · ".join(f"{k}: {'OK' if v else 'FALHOU'}" for k, v in resultados.items()))
    saida = Path(__file__).with_name("testar_fontes_resultado.txt")
    saida.write_text("\n".join(linhas), encoding="utf-8")
    print(f"\nResumo salvo em {saida.name}")
