// xAI — Grok Imagine Video. Documentação (conferida em 11/2026):
//   https://docs.x.ai/developers/rest-api-reference/inference/videos
//   POST /v1/videos/generations      → { request_id }
//   GET  /v1/videos/{request_id}     → { status: pending | done | failed | expired, progress, video: { url, duration, respect_moderation }, error: { code, message } }
//   GET  /v1/video-generation-models → modelos de vídeo disponíveis para a chave
import type { ModelCapabilities, ProviderCapabilities } from '@/lib/videos';
import { callJson, downloadLimited, errorMessage, type FetchLike } from './http';
import {
  ProviderError, type ConnectionResult, type GenerateRequest, type GenerateSubmission, type GenerationResult,
  type GenerationStatus, type ProviderConfig, type VideoGenerationProvider,
} from './types';

const BASE = 'https://api.x.ai/v1';

export const grokModel = (id: string, label = id): ModelCapabilities => ({
  id, label,
  minDuration: 1, maxDuration: 15,
  aspectRatios: ['9:16', '16:9', '1:1'],
  resolutions: ['480p', '720p', '1080p'],
  defaultResolution: '720p',
  imageInput: true,
  audio: true,
  notes: [
    'Gera de 1 a 15 segundos.',
    'Vídeos barrados pela moderação do provedor voltam sem arquivo e ficam como "Falhou".',
  ],
});

export const GROK_CAPABILITIES: ProviderCapabilities = {
  videoGeneration: true,
  models: [grokModel('grok-imagine-video-1.5', 'Grok Imagine Video 1.5'), grokModel('grok-imagine-video', 'Grok Imagine Video')],
};

type Poll = {
  status?: string;
  progress?: number | null;
  model?: string;
  video?: { url?: string | null; duration?: number; respect_moderation?: boolean };
  error?: { code?: string; message?: string };
  usage?: { cost_in_usd_ticks?: number };
};

function describe(status: number, body: unknown) {
  const m = errorMessage(body);
  if (status === 400 && /api key|unauthorized|incorrect/i.test(m)) return 'Chave de API inválida.';
  if (status === 401 || status === 403) return `Acesso negado pela API da xAI (${status})${m ? `: ${m}` : ''}`;
  if (status === 429) return 'Limite de uso da API da xAI atingido (429). Tente mais tarde.';
  return `API da xAI respondeu ${status}${m ? `: ${m}` : ''}`;
}

export class GrokVideoProvider implements VideoGenerationProvider {
  readonly type = 'xai';
  constructor(private cfg: ProviderConfig, private doFetch: FetchLike = fetch) {}

  private headers(json = false): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg.apiKey}`, ...(json ? { 'Content-Type': 'application/json' } : {}) };
  }

  getCapabilities(): ProviderCapabilities {
    return GROK_CAPABILITIES;
  }

  async getAvailableModels(): Promise<ModelCapabilities[]> {
    const res = await callJson<{ models?: { id?: string }[]; data?: { id?: string }[] }>(
      this.doFetch, `${BASE}/video-generation-models`, { headers: this.headers(), timeoutMs: 20_000 }, this.cfg.apiKey, describe
    );
    const list = res?.models ?? res?.data ?? [];
    const known = new Map(GROK_CAPABILITIES.models.map((m) => [m.id, m]));
    // Modelos novos que a API listar também entram, com os limites documentados do endpoint
    return list.filter((m) => m?.id).map((m) => known.get(m.id!) ?? grokModel(m.id!));
  }

  async validateConnection(): Promise<ConnectionResult> {
    try {
      const models = await this.getAvailableModels();
      return models.length
        ? { ok: true, message: `Conectado. ${models.length} modelo(s) de vídeo disponível(is).`, models }
        : { ok: false, message: 'Chave válida, mas ela não tem acesso a modelos de geração de vídeo.', models: [] };
    } catch (err) {
      return { ok: false, message: (err as Error).message, models: [] };
    }
  }

  async generateVideo(req: GenerateRequest): Promise<GenerateSubmission> {
    const image = req.referenceImage
      ? { url: req.referenceImage.data ? `data:${req.referenceImage.mimeType || 'image/jpeg'};base64,${req.referenceImage.data.toString('base64')}` : req.referenceImage.url }
      : undefined;
    const body = {
      model: req.model,
      prompt: req.prompt,
      duration: req.duration,
      aspect_ratio: req.format,
      resolution: req.resolution,
      ...(image ? { image } : {}),
      ...(req.withAudio ? {} : { generate_audio: false }),
    };
    const res = await callJson<{ request_id?: string }>(
      this.doFetch, `${BASE}/videos/generations`, { method: 'POST', headers: this.headers(true), body: JSON.stringify(body), timeoutMs: 60_000 },
      this.cfg.apiKey, describe
    );
    if (!res?.request_id) throw new ProviderError('A API da xAI não devolveu o identificador da geração.', false);
    return { jobId: res.request_id, requestMeta: {} };
  }

  async getGenerationStatus(jobId: string): Promise<GenerationStatus> {
    const res = await callJson<Poll>(
      this.doFetch, `${BASE}/videos/${encodeURIComponent(jobId)}`, { headers: this.headers(), timeoutMs: 30_000 }, this.cfg.apiKey, describe
    );
    const meta = { status: res?.status ?? null, progress: res?.progress ?? null, costUsdTicks: res?.usage?.cost_in_usd_ticks ?? null };
    switch (res?.status) {
      case 'pending':
        return { state: 'running', progress: typeof res.progress === 'number' ? res.progress : null, meta };
      case 'done':
        if (res.video?.respect_moderation === false || !res.video?.url) {
          return { state: 'failed', error: 'O vídeo foi barrado pela moderação da xAI.', retryable: false, meta };
        }
        return { state: 'succeeded', result: { kind: 'url', url: res.video.url, authenticated: false }, meta };
      case 'failed': {
        const code = res.error?.code ?? '';
        return {
          state: 'failed',
          error: res.error?.message || `A xAI informou falha na geração${code ? ` (${code})` : ''}.`,
          retryable: code === 'service_unavailable' || code === 'internal_error',
          meta,
        };
      }
      case 'expired':
        return { state: 'failed', error: 'O resultado expirou no provedor antes de ser baixado.', retryable: false, meta };
      default:
        return { state: 'failed', error: `Status inesperado da xAI: ${res?.status ?? 'vazio'}`, retryable: false, meta };
    }
  }

  async downloadResult(result: GenerationResult, maxBytes: number): Promise<Buffer> {
    if (result.kind === 'inline') return Buffer.from(result.data, 'base64');
    // A URL do vídeo é de outro host: nunca enviar a chave junto
    return downloadLimited(this.doFetch, result.url, {}, maxBytes, this.cfg.apiKey);
  }
}
