// Contrato comum dos provedores de geração de vídeo. As regras de negócio (fila, estados,
// armazenamento, avaliação) só conhecem esta interface; cada API real fica num adaptador.
import type { ModelCapabilities, ProviderCapabilities, VideoFormat } from '@/lib/videos';

export type ProviderConfig = {
  apiKey: string;
  settings: Record<string, unknown>;
};

export type GenerateRequest = {
  model: string;
  prompt: string;
  format: VideoFormat;
  duration: number;            // segundos
  resolution: string;
  withAudio: boolean;
  referenceImage: { url: string; data?: Buffer; mimeType?: string } | null;
};

// Resultado do envio: o identificador do job no provedor (para consultar depois).
export type GenerateSubmission = { jobId: string; requestMeta: Record<string, unknown> };

export type GenerationStatus =
  | { state: 'running'; progress: number | null; meta?: Record<string, unknown> }
  | { state: 'succeeded'; result: GenerationResult; meta?: Record<string, unknown> }
  // accountIssue: a falha é da CONTA do provedor (ex.: sem plano pago), não deste vídeo.
  // Quando a falha é definitiva, o provedor é marcado com esse problema e sai da tela de geração.
  | { state: 'failed'; error: string; retryable: boolean; accountIssue?: string; meta?: Record<string, unknown> };

// Onde está o vídeo pronto. downloadResult transforma isto em bytes.
export type GenerationResult =
  | { kind: 'inline'; data: string; mimeType: string }         // base64
  | { kind: 'url'; url: string; authenticated: boolean };

export type ConnectionResult = { ok: boolean; message: string; models: ModelCapabilities[] };

export interface VideoGenerationProvider {
  readonly type: string;
  validateConnection(): Promise<ConnectionResult>;
  getAvailableModels(): Promise<ModelCapabilities[]>;
  getCapabilities(): ProviderCapabilities;
  generateVideo(req: GenerateRequest): Promise<GenerateSubmission>;
  getGenerationStatus(jobId: string): Promise<GenerationStatus>;
  downloadResult(result: GenerationResult, maxBytes: number): Promise<Buffer>;
}

// Descrição estática de um tipo de provedor (para a tela de configuração e o registro).
export type ProviderDefinition = {
  type: string;
  label: string;
  docsUrl: string;
  keyHelp: string;                       // onde obter a chave
  clientConfigurable: boolean;           // o cliente cadastra a própria chave? (false = só a plataforma usa)
  requirement?: { title: string; text: string; confirm: string }; // pré-requisito da conta, confirmado no cadastro
  keyPattern?: RegExp;                   // validação leve do formato da chave
  capabilities: ProviderCapabilities;    // capacidades documentadas (antes de validar a chave)
  create: (cfg: ProviderConfig) => VideoGenerationProvider;
};

// Erro de chamada a provedor. `retryable` indica falha temporária (rede, 429, 5xx).
export class ProviderError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number, readonly code?: string) {
    super(message);
    this.name = 'ProviderError';
  }
}
