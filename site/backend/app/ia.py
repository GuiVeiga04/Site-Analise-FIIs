"""Diagnóstico de FIIs com o Claude (API da Anthropic).

Dois modos:
  - fundo:      um fundo, com os pares e os indicadores de mercado
  - comparacao: dois fundos lado a lado

A IA recebe SÓ os números que o próprio site calcula (snapshot, checklist,
rendimentos recentes, pares, CDI/IPCA) e é instruída a não inventar nada além
disso. O texto é uma leitura dos dados para triagem, não recomendação.

Configuração (variáveis de ambiente):
    ANTHROPIC_API_KEY   chave da API (obrigatória para gerar)
    FIIS_MODELO_IA      modelo; padrão claude-haiku-4-5-20251001
                        (alternativa: claude-sonnet-5, mais caprichado e ~2x mais caro)

Onde a chave fica:
  - no seu PC: variável de ambiente antes de subir o uvicorn
  - no GitHub Actions: Settings -> Secrets -> ANTHROPIC_API_KEY
  NUNCA no front-end: o site no Pages é público e a chave vazaria.
"""
from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Iterator

MODELO_PADRAO = "claude-haiku-4-5-20251001"
MODELOS_PERMITIDOS = {"claude-haiku-4-5-20251001", "claude-haiku-4-5", "claude-sonnet-5"}
VERSAO_PROMPT = "2026-09-25"  # mude quando alterar os prompts: invalida o cache diário
MAX_TOKENS = 1400

SISTEMA = """Você é um analista de fundos imobiliários (FIIs) brasileiro. Escreve para um investidor pessoa \
física que usa um painel de triagem. Sua tarefa é LER os dados fornecidos e explicar, em português do Brasil, \
o que eles dizem sobre o fundo.

Regras:
- Use apenas os dados do JSON. Não invente números, notícias, eventos, nomes de ativos da carteira ou motivos \
que não estejam nos dados. Se algo importante não está nos dados, diga que precisa ser conferido no relatório \
gerencial.
- Cite os números que sustentam cada ponto (ex: "P/VP de 0,89, abaixo da mediana dos pares de 0,92").
- Leve em conta que DY muito acima dos pares e P/VP muito baixo costumam refletir risco percebido, não \
pechincha; e que DY de FII é isento de IR para pessoa física (por isso a comparação é com o CDI líquido).
- Não diga "compre" ou "venda" e não dê preço-alvo. Termine com uma conclusão de triagem: vale estudar a fundo, \
estudar com ressalvas, ou há sinais de alerta que pedem cautela, alinhada (ou explicando divergência) com o \
sinal do checklist.
- Seja direto: no máximo ~300 palavras. Formato Markdown simples: títulos com "## ", listas com "- ", \
negrito com **. Sem tabelas."""

ESTRUTURA_FUNDO = """Estruture assim:
## Resumo
(2 ou 3 frases)
## Pontos fortes
## Pontos de atenção
## O que conferir no relatório gerencial
## Conclusão da triagem"""

ESTRUTURA_COMPARACAO = """Compare os dois fundos. Estruture assim:
## Resumo
(2 ou 3 frases: em que cada um se destaca)
## Renda
## Preço e patrimônio
## Riscos e sinais de alerta
## Para qual perfil cada um se encaixa melhor
## Conclusão da triagem"""

# Campos do snapshot enviados à IA (o resto é ruído para a análise)
CAMPOS = [
    "ticker", "nome", "gestora", "tipo_gestao", "segmento", "data_pregao", "preco",
    "ultimo_dividendo", "data_ultimo_dividendo", "dy_ultimo_pct", "dy_12m_pct", "dividendos_12m",
    "pagamentos_12m", "tendencia_dividendo_pct", "estabilidade_cv_pct", "quedas_dividendo_12m",
    "retorno_total_12m_pct", "variacao_preco_12m_pct", "grupo_pares", "dy_12m_mediana_pares_pct",
    "dy_12m_vs_pares_pp", "p_vp", "fonte_p_vp", "vp_cota", "data_ref_vp", "p_vp_mediana_pares",
    "vp_var_12m_pct", "patrimonio_liquido", "cotistas", "cotistas_var_12m_pct", "vacancia_pct",
    "cap_rate_pct", "qtd_imoveis", "ffo_yield_pct", "spread_cdi_liquido_pp", "dy_real_pct",
    "volume_financeiro_medio", "liquidez", "volatilidade_pct", "checklist_nota", "checklist_sinal",
]


def _arredondar(v):
    if isinstance(v, float):
        return round(v, 4) if abs(v) < 10 else round(v, 2)
    return v


def contexto_fundo(f: dict, todos: list[dict], dividendos: list[dict], meta: dict) -> dict:
    """Pacote de dados de UM fundo, pronto para virar JSON no prompt."""
    dados = {k: _arredondar(f.get(k)) for k in CAMPOS if f.get(k) is not None}
    dados["checklist"] = [
        {"criterio": i["nome"], "valor": _arredondar(i.get("valor")), "status": i["status"]}
        for i in f.get("checklist", [])
    ]
    avisos = [f'{i["nome"]}: {i["aviso"]}' for i in f.get("checklist", []) if i.get("aviso")]
    if avisos:
        # Dado suspeito: a IA deve tratá-lo como não confiável, não como fato
        dados["avisos_de_dados_suspeitos"] = avisos
    dados["rendimentos_recentes"] = [
        {"data_ex": d["data_ex"], "valor": _arredondar(d["valor"])} for d in (dividendos or [])[-12:]
    ]
    pares = [p for p in todos if p.get("grupo_pares") and p["grupo_pares"] == f.get("grupo_pares") and p["ticker"] != f["ticker"]]
    dados["pares"] = [
        {"ticker": p["ticker"], "segmento": p.get("segmento"), "p_vp": p.get("p_vp"), "dy_12m_pct": p.get("dy_12m_pct"),
         "checklist_sinal": p.get("checklist_sinal"), "checklist_nota": p.get("checklist_nota")}
        for p in pares
    ]
    return dados


def contexto_mercado(meta: dict) -> dict:
    ind = meta.get("indicadores") or {}
    return {
        "data_ultimo_pregao": meta.get("ultimo_pregao"),
        "indicadores": {k: v for k, v in ind.items()},
        "observacao": "CDI líquido = CDI × 0,85 (IR de renda fixa acima de 2 anos).",
    }


def montar_mensagem(contextos: list[dict], mercado: dict) -> str:
    modo = "comparacao" if len(contextos) == 2 else "fundo"
    estrutura = ESTRUTURA_COMPARACAO if modo == "comparacao" else ESTRUTURA_FUNDO
    payload = {"mercado": mercado, "fundos": contextos}
    return (
        f"Dados do painel (JSON):\n```json\n{json.dumps(payload, ensure_ascii=False, default=str)}\n```\n\n"
        f"{estrutura}"
    )


def modelo_configurado(pedido: str | None = None) -> str:
    m = pedido or os.environ.get("FIIS_MODELO_IA") or MODELO_PADRAO
    if m not in MODELOS_PERMITIDOS:
        raise ValueError(f"Modelo não permitido: {m}. Use um de {sorted(MODELOS_PERMITIDOS)}")
    return m


def disponivel() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def chave_cache(mensagem: str, modelo: str) -> str:
    """Hash das entradas: se nada mudou desde a última geração, não gasta outra chamada."""
    return hashlib.sha256(f"{VERSAO_PROMPT}|{modelo}|{SISTEMA}|{mensagem}".encode()).hexdigest()[:16]


def _cliente():
    import anthropic  # import tardio: o resto do site funciona sem o pacote

    return anthropic.Anthropic()


def gerar_stream(mensagem: str, modelo: str | None = None, cliente=None) -> Iterator[str]:
    """Devolve o texto em pedaços, à medida que o Claude escreve."""
    cliente = cliente or _cliente()
    with cliente.messages.stream(
        model=modelo_configurado(modelo),
        max_tokens=MAX_TOKENS,
        system=SISTEMA,
        messages=[{"role": "user", "content": mensagem}],
    ) as stream:
        yield from stream.text_stream


def gerar(mensagem: str, modelo: str | None = None, cliente=None) -> str:
    return "".join(gerar_stream(mensagem, modelo, cliente))
