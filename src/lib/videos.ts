// Regras e vocabulário do módulo de vídeos (puro: usado no navegador, no servidor e no worker).

/* ------------------------------------------------------------------ Estados */
export const VIDEO_STATUSES = [
  'PENDING', 'GENERATING', 'PROCESSING', 'GENERATED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'FAILED',
] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

// Transições permitidas. Toda mudança de status passa por canTransition (no servidor, a
// atualização também confere o status atual no WHERE, então corridas não pulam etapas).
//   PENDING → GENERATING            worker enviou ao provedor
//   GENERATING → PENDING            falha temporária ao enviar: volta para a fila
//   GENERATING → PROCESSING         provedor terminou; baixando e armazenando
//   PROCESSING → GENERATED          MP4 + miniatura + metadados armazenados
//   GENERATED → PENDING_REVIEW      liberado para avaliação humana
//   PENDING_REVIEW → APPROVED | REJECTED
//   APPROVED ⇄ REJECTED            reavaliação (o histórico guarda todas as decisões)
//   PENDING | GENERATING | PROCESSING → FAILED
export const TRANSITIONS: Record<VideoStatus, readonly VideoStatus[]> = {
  PENDING: ['GENERATING', 'FAILED'],
  GENERATING: ['PENDING', 'PROCESSING', 'FAILED'],
  PROCESSING: ['GENERATED', 'FAILED'],
  GENERATED: ['PENDING_REVIEW'],
  PENDING_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['REJECTED'],
  REJECTED: ['APPROVED'],
  FAILED: [],
};

export const canTransition = (from: VideoStatus, to: VideoStatus) => TRANSITIONS[from].includes(to);
export const IN_PROGRESS: readonly VideoStatus[] = ['PENDING', 'GENERATING', 'PROCESSING', 'GENERATED'];
export const REVIEWABLE: readonly VideoStatus[] = ['PENDING_REVIEW', 'APPROVED', 'REJECTED'];
export const isReviewable = (s: VideoStatus) => REVIEWABLE.includes(s);

export const STATUS_LABEL: Record<VideoStatus, string> = {
  PENDING: 'Na fila',
  GENERATING: 'Gerando',
  PROCESSING: 'Processando',
  GENERATED: 'Gerado',
  PENDING_REVIEW: 'Aguardando avaliação',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  FAILED: 'Falhou',
};

// Filtros da galeria e do painel (agrupam estados técnicos)
export const STATUS_GROUPS = {
  all: { label: 'Todos', statuses: VIDEO_STATUSES },
  processing: { label: 'Em processamento', statuses: IN_PROGRESS },
  review: { label: 'Aguardando avaliação', statuses: ['PENDING_REVIEW'] },
  approved: { label: 'Aprovados', statuses: ['APPROVED'] },
  rejected: { label: 'Rejeitados', statuses: ['REJECTED'] },
  failed: { label: 'Falharam', statuses: ['FAILED'] },
} as const satisfies Record<string, { label: string; statuses: readonly VideoStatus[] }>;
export type StatusGroup = keyof typeof STATUS_GROUPS;
export const statusGroup = (v: unknown): StatusGroup => (typeof v === 'string' && v in STATUS_GROUPS ? (v as StatusGroup) : 'all');

/* ------------------------------------------------------------------ Opções de geração */
export const FORMATS = {
  '9:16': { label: 'Vertical 9:16', hint: 'Reels, Shorts, Status' },
  '16:9': { label: 'Horizontal 16:9', hint: 'YouTube, sites' },
  '1:1': { label: 'Quadrado 1:1', hint: 'Feed' },
} as const;
export type VideoFormat = keyof typeof FORMATS;
export const DEFAULT_FORMAT: VideoFormat = '9:16';

export const PRESET_DURATIONS = [10, 15, 20, 30] as const;

export const STYLES = {
  showcase: { label: 'Apresentação de produto', prompt: 'apresentação de produto: o produto em destaque, ângulos variados e fundo limpo' },
  promo: { label: 'Comercial promocional', prompt: 'comercial promocional: ritmo animado, cortes rápidos e destaque para o preço' },
  demo: { label: 'Demonstração de funcionalidades', prompt: 'demonstração: mostre o produto em uso, apenas com as funções descritas' },
  review: { label: 'Review narrado', prompt: 'review narrado: tom de recomendação honesta, como alguém apresentando o produto' },
  benefits: { label: 'Oferta e benefícios', prompt: 'oferta e benefícios: liste os benefícios descritos e encerre com o preço da oferta' },
} as const;
export type VideoStyle = keyof typeof STYLES;

export const NARRATIONS = {
  none: { label: 'Sem narração', needsAudio: false },
  female: { label: 'Voz feminina', needsAudio: true },
  male: { label: 'Voz masculina', needsAudio: true },
  text: { label: 'Texto na tela', needsAudio: false },
  narrated_subtitles: { label: 'Narração com legendas', needsAudio: true },
} as const;
export type Narration = keyof typeof NARRATIONS;

export const LANGUAGES = { 'pt-BR': 'Português (Brasil)', 'en-US': 'Inglês', 'es-ES': 'Espanhol' } as const;
export type Language = keyof typeof LANGUAGES;

export type GenerationOptions = {
  style: VideoStyle;
  narration: Narration;
  language: Language;
  voiceInstructions: string;
  extraInstructions: string;
  resolution: string;
};

/* ------------------------------------------------------------------ Capacidades */
// Descrição do que um modelo de um provedor aceita. Vem do adaptador (verificada na API
// quando possível) e é usada tanto para montar o formulário quanto para validar o pedido.
export type ModelCapabilities = {
  id: string;
  label: string;
  minDuration: number;
  maxDuration: number;
  aspectRatios: VideoFormat[];
  resolutions: string[];
  defaultResolution: string;
  imageInput: boolean;          // aceita a foto do produto como referência
  audio: boolean;               // gera áudio/voz
  notes: string[];              // limitações a mostrar na tela
  usdPerSecond?: number;        // preço oficial por segundo (para estimar o custo)
};

export type ProviderCapabilities = {
  videoGeneration: boolean;
  limitation?: string;          // quando não gera vídeo, por quê
  models: ModelCapabilities[];
};

export type ValidationIssue = { field: string; message: string };

// Confere um pedido contra as capacidades do modelo. Retorna a lista de problemas (vazia = ok).
export function validateRequest(
  caps: ModelCapabilities | undefined,
  req: { duration: number; format: VideoFormat; narration: Narration; resolution: string }
): ValidationIssue[] {
  if (!caps) return [{ field: 'model', message: 'Modelo indisponível para este provedor.' }];
  const out: ValidationIssue[] = [];
  if (!Number.isInteger(req.duration) || req.duration < caps.minDuration || req.duration > caps.maxDuration) {
    out.push({ field: 'duration', message: `${caps.label} gera de ${caps.minDuration} a ${caps.maxDuration} segundos.` });
  }
  if (!caps.aspectRatios.includes(req.format)) {
    out.push({ field: 'format', message: `${caps.label} não gera no formato ${FORMATS[req.format].label}.` });
  }
  if (NARRATIONS[req.narration].needsAudio && !caps.audio) {
    out.push({ field: 'narration', message: `${caps.label} não gera áudio; escolha "Sem narração" ou "Texto na tela".` });
  }
  if (!caps.resolutions.includes(req.resolution)) {
    out.push({ field: 'resolution', message: `Resolução ${req.resolution} indisponível em ${caps.label}.` });
  }
  return out;
}

/* ------------------------------------------------------------------ Avaliação */
export const CRITERIA = {
  visual_quality: 'Qualidade visual',
  product_fidelity: 'Fidelidade ao produto',
  message_quality: 'Clareza da mensagem',
  narration_quality: 'Qualidade da narração',
  subtitles_quality: 'Qualidade das legendas',
  commercial_fit: 'Adequação comercial',
} as const;
export type Criterion = keyof typeof CRITERIA;

export const DECISIONS = {
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  REVISION_REQUESTED: 'Nova versão solicitada',
} as const;
export type Decision = keyof typeof DECISIONS;

/* ------------------------------------------------------------------ Produto */
// Retrato do produto no momento da geração (vem do Histórico de Ofertas).
export type ProductSnapshot = {
  itemId: string;
  name: string;
  imageUrl: string | null;
  price: number | null;
  originalPrice: number | null;
  discountRate: number | null;     // %
  category: string | null;         // palavra-chave da busca que encontrou o produto
  productLink: string | null;
  affiliateLink: string | null;
  shopName: string | null;
  description: string | null;      // a API de afiliados da Shopee não fornece; fica null
};

export const originalPriceOf = (price: number | null, discountRate: number | null) =>
  price && discountRate && discountRate > 0 && discountRate < 100 ? Math.round((price / (1 - discountRate / 100)) * 100) / 100 : null;

/* ------------------------------------------------------------------ Limites */
export const MAX_PRODUCTS_PER_REQUEST = 10;
