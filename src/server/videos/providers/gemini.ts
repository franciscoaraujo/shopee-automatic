// Google Gemini API — geração de vídeo com Gemini Omni Flash pela Interactions API.
// Documentação (conferida em 11/2026): https://aistudio.google.com/docs/omni
//   POST /v1beta/interactions         cria (background=true → devolve id e status in_progress)
//   GET  /v1beta/interactions/{id}    status: in_progress | completed | failed | cancelled | requires_action
//   vídeo: steps[] → type "model_output" → content[] → { type: "video", mime_type, data | uri }
// Os modelos Veo 3.1 Preview foram desligados na Gemini API em 22/10/2026; por isso o
// adaptador usa o Omni Flash. A listagem de modelos (GET /v1beta/models) não informa
// modalidade, então as capacidades vêm do catálogo abaixo e a disponibilidade, da listagem.
import type { ModelCapabilities, ProviderCapabilities } from '@/lib/videos';
import { callJson, downloadLimited, errorMessage, type FetchLike } from './http';
import {
  ProviderError, type ConnectionResult, type GenerateRequest, type GenerateSubmission, type GenerationResult,
  type GenerationStatus, type ProviderConfig, type VideoGenerationProvider,
} from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const API_REVISION = '2026-05-20';

const omni = (id: string, label: string): ModelCapabilities => ({
  id, label,
  minDuration: 3, maxDuration: 15,
  aspectRatios: ['9:16', '16:9'],
  resolutions: ['360p', '720p', '1080p', '4k'],
  defaultResolution: '720p',
  imageInput: true,
  audio: true,
  notes: [
    'Não disponível no plano gratuito da Gemini API: exige faturamento ativo no projeto da chave (cerca de US$ 0,07 por segundo em 720p).',
    'Gera de 3 a 15 segundos, só nos formatos 9:16 e 16:9 (sem 1:1).',
    'Áudio e voz avaliados oficialmente só em inglês; em português o resultado pode variar.',
    '1080p e 4K são ampliados a partir de 720p e demoram mais.',
    'Todo vídeo leva marca d’água invisível SynthID.',
  ],
});

export const GEMINI_CATALOG: ModelCapabilities[] = [
  omni('gemini-omni-1.2-flash', 'Gemini Omni 1.2 Flash'),
  omni('gemini-omni-1.1-flash', 'Gemini Omni 1.1 Flash (redirecionado ao 1.2 a partir de 03/12/2026)'),
];

export const GEMINI_CAPABILITIES: ProviderCapabilities = { videoGeneration: true, models: GEMINI_CATALOG };

type Interaction = { id?: string; status?: string; error?: unknown; steps?: unknown[] };

function describe(status: number, body: unknown) {
  const m = errorMessage(body);
  if (status === 400 && /api key/i.test(m)) return 'Chave de API inválida.';
  if (status === 401 || status === 403) return `Acesso negado pela Gemini API (${status})${m ? `: ${m}` : ''}`;
  if (status === 429) return 'Limite de uso da Gemini API atingido (429). Tente mais tarde.';
  return `Gemini API respondeu ${status}${m ? `: ${m}` : ''}`;
}

// Procura o item de vídeo na resposta (steps → model_output → content → video).
export function findVideo(body: unknown): GenerationResult | null {
  const steps = (body as Interaction)?.steps;
  if (!Array.isArray(steps)) return null;
  for (const step of steps) {
    const s = step as { type?: string; content?: unknown[] };
    if (s?.type !== 'model_output' || !Array.isArray(s.content)) continue;
    for (const c of s.content) {
      const v = c as { type?: string; data?: string; uri?: string; mime_type?: string };
      if (v?.type !== 'video') continue;
      if (v.data) return { kind: 'inline', data: v.data, mimeType: v.mime_type || 'video/mp4' };
      if (v.uri) return { kind: 'url', url: v.uri, authenticated: true };
    }
  }
  return null;
}

export class GeminiVideoProvider implements VideoGenerationProvider {
  readonly type = 'gemini';
  constructor(private cfg: ProviderConfig, private doFetch: FetchLike = fetch) {}

  private headers(json = false): Record<string, string> {
    return {
      'x-goog-api-key': this.cfg.apiKey,
      'Api-Revision': API_REVISION,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  getCapabilities(): ProviderCapabilities {
    return GEMINI_CAPABILITIES;
  }

  async getAvailableModels(): Promise<ModelCapabilities[]> {
    const ids = new Set<string>();
    let pageToken = '';
    for (let i = 0; i < 10; i++) {
      const url = `${BASE}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const page = await callJson<{ models?: { name?: string; baseModelId?: string }[]; nextPageToken?: string }>(
        this.doFetch, url, { headers: this.headers(), timeoutMs: 20_000 }, this.cfg.apiKey, describe
      );
      for (const m of page?.models ?? []) {
        if (m.name) ids.add(m.name.replace(/^models\//, ''));
        if (m.baseModelId) ids.add(m.baseModelId);
      }
      if (!page?.nextPageToken) break;
      pageToken = page.nextPageToken;
    }
    return GEMINI_CATALOG.filter((m) => ids.has(m.id));
  }

  async validateConnection(): Promise<ConnectionResult> {
    try {
      const models = await this.getAvailableModels();
      return models.length
        ? { ok: true, message: `Conectado. ${models.length} modelo(s) de vídeo disponível(is).`, models }
        : { ok: false, message: 'Chave válida, mas ela não tem acesso a modelos de geração de vídeo (Gemini Omni Flash).', models: [] };
    } catch (err) {
      return { ok: false, message: (err as Error).message, models: [] };
    }
  }

  private body(req: GenerateRequest, background: boolean) {
    const input: unknown[] = [];
    if (req.referenceImage?.data) {
      input.push({ type: 'image', data: req.referenceImage.data.toString('base64'), mime_type: req.referenceImage.mimeType || 'image/jpeg' });
    }
    input.push({ type: 'text', text: req.prompt });
    return {
      model: req.model,
      input,
      response_format: { type: 'video', aspect_ratio: req.format, duration: `${req.duration}s`, resolution: req.resolution },
      ...(background ? { background: true } : {}),
    };
  }

  async generateVideo(req: GenerateRequest): Promise<GenerateSubmission> {
    const send = (background: boolean) =>
      callJson<Interaction>(this.doFetch, `${BASE}/interactions`, {
        method: 'POST', headers: this.headers(true), body: JSON.stringify(this.body(req, background)),
        timeoutMs: background ? 60_000 : 15 * 60_000,
      }, this.cfg.apiKey, describe);
    let res: Interaction;
    let mode = 'background';
    try {
      res = await send(true);
    } catch (err) {
      // Se o modelo não aceitar execução em segundo plano, gera de forma síncrona.
      // A interação continua armazenada (store=true), então o worker consulta pelo id igual.
      if (err instanceof ProviderError && err.status === 400 && /background/i.test(err.message)) {
        res = await send(false);
        mode = 'sync';
      } else throw err;
    }
    if (!res?.id) throw new ProviderError('A Gemini API não devolveu o identificador da geração.', false);
    return { jobId: res.id, requestMeta: { mode, status: res.status ?? null } };
  }

  async getGenerationStatus(jobId: string): Promise<GenerationStatus> {
    const res = await callJson<Interaction>(
      this.doFetch, `${BASE}/interactions/${encodeURIComponent(jobId)}`, { headers: this.headers(), timeoutMs: 120_000 }, this.cfg.apiKey, describe
    );
    const meta = { status: res?.status ?? null };
    switch (res?.status) {
      case 'in_progress':
        return { state: 'running', progress: null, meta };
      case 'completed': {
        const video = findVideo(res);
        return video
          ? { state: 'succeeded', result: video, meta }
          : { state: 'failed', error: 'A geração terminou sem vídeo (o pedido pode ter sido bloqueado pelas políticas de uso).', retryable: false, meta };
      }
      case 'failed': {
        // Interações com falha trazem "errors": [{ code, message }] (fora da documentação; visto na API real)
        const first = Array.isArray((res as { errors?: unknown }).errors) ? ((res as { errors: { code?: string; message?: string }[] }).errors[0] ?? {}) : {};
        const code = first.code ?? '';
        if (code === 'RESOURCE_EXHAUSTED') {
          return {
            state: 'failed', retryable: true, meta: { ...meta, code },
            accountIssue: 'Plano pago necessário: o Gemini recusou a geração por falta de cota (RESOURCE_EXHAUSTED). Ative o faturamento no projeto da chave (AI Studio → Billing) e clique em "Testar conexão".',
            error: 'Cota da Gemini API esgotada (RESOURCE_EXHAUSTED). O Gemini Omni Flash não está disponível no plano gratuito: ative o faturamento no projeto da chave (AI Studio → Billing) ou aguarde a renovação da cota.',
          };
        }
        const msg = first.message || errorMessage(res) || 'A Gemini API informou falha na geração.';
        return { state: 'failed', error: code ? `${msg} (${code})` : msg, retryable: /rate|quota|exhausted|429|unavailable/i.test(`${code} ${msg}`), meta: { ...meta, code: code || null } };
      }
      case 'cancelled':
        return { state: 'failed', error: 'A geração foi cancelada no provedor.', retryable: false, meta };
      default:
        return { state: 'failed', error: `Status inesperado da Gemini API: ${res?.status ?? 'vazio'}`, retryable: false, meta };
    }
  }

  async downloadResult(result: GenerationResult, maxBytes: number): Promise<Buffer> {
    if (result.kind === 'inline') {
      const buf = Buffer.from(result.data, 'base64');
      if (buf.length > maxBytes) throw new ProviderError('Vídeo maior que o limite permitido', false);
      return buf;
    }
    // URI de arquivo da Gemini: baixa pelo endpoint :download (exige a chave)
    const url = /\/files\/[^/:?]+$/.test(result.url) ? `${result.url}:download?alt=media` : result.url;
    const sameHost = new URL(url).hostname === 'generativelanguage.googleapis.com';
    return downloadLimited(this.doFetch, url, sameHost ? this.headers() : {}, maxBytes, this.cfg.apiKey);
  }
}
