"""Contrato da API (também é o formato dos JSON estáticos em /data)."""
from __future__ import annotations

from pydantic import BaseModel


class Fundo(BaseModel):
    ticker: str
    nome: str
    gestora: str | None = None
    tipo_gestao: str | None = None
    segmento: str | None = None


class Indicador(BaseModel):
    valor: float
    data: str | None


class Faixa(BaseModel):
    min: float | None = None
    max: float | None = None


class ItemChecklist(BaseModel):
    id: str
    nome: str
    descricao: str | None = None
    valor: float | None
    unidade: str = ""
    status: str  # verde | amarelo | vermelho | sem_dado
    peso: float
    eliminatorio: bool = False
    verde: Faixa | None = None
    amarelo: Faixa | None = None


class Meta(BaseModel):
    ultimo_pregao: str | None
    pregoes: list[str]
    total_fundos: int
    tipos_gestao: list[str]
    segmentos: list[str]
    atualizado_em: str | None
    ultimo_dividendo_registrado: str | None = None
    indicadores: dict[str, Indicador] = {}
    fundos: list[Fundo]


class FundoSnapshot(BaseModel):
    ticker: str
    nome: str
    gestora: str | None
    tipo_gestao: str | None
    segmento: str | None
    data_pregao: str
    preco: float | None
    variacao_dia_pct: float | None
    variacao_periodo_pct: float | None
    preco_min: float | None
    preco_max: float | None
    volume_cotas: int | None
    volume_financeiro: float | None
    volume_financeiro_medio: float | None
    volatilidade_pct: float | None
    pregoes: int
    liquidez: str
    rank_liquidez: int
    # renda (None quando o fundo ainda não tem rendimentos coletados)
    ultimo_dividendo: float | None = None
    data_ultimo_dividendo: str | None = None
    dy_ultimo_pct: float | None = None
    dividendos_12m: float | None = None
    dy_12m_pct: float | None = None
    pagamentos_12m: int = 0
    media_dividendo_12m: float | None = None
    media_dividendo_3_ult: float | None = None
    tendencia_dividendo_pct: float | None = None
    estabilidade_cv_pct: float | None = None
    quedas_dividendo_12m: int | None = None
    historico_dividendos_meses: int = 0
    retorno_total_12m_pct: float | None = None
    variacao_preco_12m_pct: float | None = None
    grupo_pares: str | None = None
    dy_12m_mediana_pares_pct: float | None = None
    dy_12m_vs_pares_pp: float | None = None
    # fundamentos (None quando a fonte ainda não foi coletada)
    vp_cota: float | None = None
    data_ref_vp: str | None = None
    p_vp: float | None = None
    fonte_p_vp: str | None = None
    p_vp_mediana_pares: float | None = None
    p_vp_vs_pares: float | None = None
    vp_var_12m_pct: float | None = None
    patrimonio_liquido: float | None = None
    cotistas: int | None = None
    cotistas_var_12m_pct: float | None = None
    vacancia_pct: float | None = None
    cap_rate_pct: float | None = None
    qtd_imoveis: int | None = None
    ffo_yield_pct: float | None = None
    spread_cdi_liquido_pp: float | None = None
    dy_real_pct: float | None = None
    # checklist (fase 3)
    checklist_nota: int | None = None
    checklist_sinal: str = "cinza"  # verde | amarelo | vermelho | cinza (dados insuficientes)
    checklist_cobertura_pct: int = 0
    checklist: list[ItemChecklist] = []


class PontoHistorico(BaseModel):
    data_pregao: str
    preco: float | None
    volume_cotas: int | None
    volume_financeiro: float | None
    variacao_dia_pct: float | None


class PontoDividendo(BaseModel):
    data_ex: str
    valor: float
    preco_data_com: float | None
    dy_pct: float | None
