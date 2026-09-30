// Contrato de dados — espelha site/backend/app/schemas.py
export type TipoGestao = "Papel" | "Tijolo" | "Híbrido" | "FoF" | string;
export type Liquidez = "Alta" | "Média" | "Baixa" | "Sem dados";

export interface Fundo {
  ticker: string;
  nome: string;
  gestora: string | null;
  tipo_gestao: TipoGestao | null;
  segmento: string | null;
}

export interface Meta {
  ultimo_pregao: string | null;
  pregoes: string[];
  total_fundos: number;
  tipos_gestao: string[];
  segmentos: string[];
  atualizado_em: string | null;
  ultimo_dividendo_registrado?: string | null;
  /** Banco Central: CDI_aa, Selic_meta_aa, IPCA_12m (vazio se não coletado) */
  indicadores?: Record<string, { valor: number; data: string | null }>;
  fundos: Fundo[];
}

export interface FundoSnapshot extends Fundo {
  data_pregao: string;
  preco: number | null;
  variacao_dia_pct: number | null;
  variacao_periodo_pct: number | null;
  preco_min: number | null;
  preco_max: number | null;
  volume_cotas: number | null;
  volume_financeiro: number | null;
  volume_financeiro_medio: number | null;
  volatilidade_pct: number | null;
  pregoes: number;
  liquidez: Liquidez;
  rank_liquidez: number;
  // renda — null quando o fundo ainda não tem rendimentos coletados
  ultimo_dividendo: number | null;
  data_ultimo_dividendo: string | null;
  dy_ultimo_pct: number | null;
  dividendos_12m: number | null;
  dy_12m_pct: number | null;
  pagamentos_12m: number;
  media_dividendo_12m: number | null;
  media_dividendo_3_ult: number | null;
  tendencia_dividendo_pct: number | null;
  estabilidade_cv_pct: number | null;
  quedas_dividendo_12m: number | null;
  historico_dividendos_meses: number;
  retorno_total_12m_pct: number | null;
  variacao_preco_12m_pct: number | null;
  grupo_pares: string | null;
  dy_12m_mediana_pares_pct: number | null;
  dy_12m_vs_pares_pp: number | null;
  // fundamentos — null quando a fonte ainda não foi coletada
  vp_cota: number | null;
  data_ref_vp: string | null;
  p_vp: number | null;
  fonte_p_vp: "CVM" | "Fundamentus" | null;
  p_vp_mediana_pares: number | null;
  p_vp_vs_pares: number | null;
  vp_var_12m_pct: number | null;
  patrimonio_liquido: number | null;
  cotistas: number | null;
  cotistas_var_12m_pct: number | null;
  vacancia_pct: number | null;
  cap_rate_pct: number | null;
  qtd_imoveis: number | null;
  ffo_yield_pct: number | null;
  spread_cdi_liquido_pp: number | null;
  dy_real_pct: number | null;
  // checklist de triagem (fase 3)
  checklist_nota: number | null;
  checklist_sinal: Sinal;
  checklist_cobertura_pct: number;
  checklist: ItemChecklist[];
}

export type Sinal = "verde" | "amarelo" | "vermelho" | "cinza";
export type StatusCriterio = "verde" | "amarelo" | "vermelho" | "sem_dado";

export interface Faixa { min: number | null; max: number | null }

export interface ItemChecklist {
  id: string;
  nome: string;
  descricao: string | null;
  valor: number | null;
  unidade: string;
  status: StatusCriterio;
  peso: number;
  eliminatorio: boolean;
  verde: Faixa | null;
  amarelo: Faixa | null;
}

export interface PontoDividendo {
  data_ex: string;
  valor: number;
  preco_data_com: number | null;
  dy_pct: number | null;
}

export interface PontoHistorico {
  data_pregao: string;
  preco: number | null;
  volume_cotas: number | null;
  volume_financeiro: number | null;
  variacao_dia_pct: number | null;
}
