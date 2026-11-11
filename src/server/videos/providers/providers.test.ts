// Testes dos adaptadores com um fetch de teste: conferem o formato EXATO das requisições
// (conforme a documentação oficial) e a interpretação das respostas. Não há chamadas reais.
import { describe, expect, it } from 'vitest';
import { GeminiVideoProvider } from './gemini';
import { GrokVideoProvider } from './grok';
import { redact } from './http';
import { ProviderError, type GenerateRequest } from './types';

type Call = { url: string; init: RequestInit };
function fakeFetch(responses: (Response | ((c: Call) => Response))[]) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL, init: RequestInit = {}) => {
    const c = { url: String(url), init };
    calls.push(c);
    const r = responses.shift();
    if (!r) throw new Error('requisição inesperada');
    return typeof r === 'function' ? r(c) : r;
  }) as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const KEY_G = 'AIzaSyTESTKEY000000000000000000000000';
const KEY_X = 'xai-TESTKEY00000000000000000000000';
const req: GenerateRequest = {
  model: 'gemini-omni-1.2-flash', prompt: 'Vídeo do produto', format: '9:16', duration: 10, resolution: '720p', withAudio: true,
  referenceImage: { url: 'https://cdn/img.jpg', data: Buffer.from('JPEGDATA'), mimeType: 'image/jpeg' },
};

describe('GeminiVideoProvider', () => {
  it('valida a chave listando modelos e mantém só os modelos de vídeo conhecidos', async () => {
    const { fn, calls } = fakeFetch([json({ models: [{ name: 'models/gemini-3.8-flash' }, { name: 'models/gemini-omni-1.2-flash' }] })]);
    const r = await new GeminiVideoProvider({ apiKey: KEY_G, settings: {} }, fn).validateConnection();
    expect(r.ok).toBe(true);
    expect(r.models.map((m) => m.id)).toEqual(['gemini-omni-1.2-flash']);
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
    expect(calls[0].url).not.toContain(KEY_G);                       // chave só no header
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY_G);
  });

  it('chave válida sem modelo de vídeo: informa a limitação', async () => {
    const { fn } = fakeFetch([json({ models: [{ name: 'models/gemini-3.8-flash' }] })]);
    const r = await new GeminiVideoProvider({ apiKey: KEY_G, settings: {} }, fn).validateConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/não tem acesso a modelos de geração de vídeo/);
  });

  it('chave inválida: mensagem clara e sem vazar a chave', async () => {
    const { fn } = fakeFetch([json({ error: { code: 400, message: `API key not valid. key=${KEY_G}`, status: 'INVALID_ARGUMENT' } }, 400)]);
    const r = await new GeminiVideoProvider({ apiKey: KEY_G, settings: {} }, fn).validateConnection();
    expect(r.ok).toBe(false);
    expect(r.message).not.toContain(KEY_G);
  });

  it('entende o erro embrulhado em array da Interactions API (resposta real)', async () => {
    const real = [{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }];
    const p = new GeminiVideoProvider({ apiKey: KEY_G, settings: {} }, fakeFetch([json(real, 400)]).fn);
    await expect(p.generateVideo(req)).rejects.toMatchObject({ message: 'Chave de API inválida.', retryable: false });
  });

  it('envia a geração em segundo plano pela Interactions API', async () => {
    const { fn, calls } = fakeFetch([json({ id: 'int-1', status: 'in_progress' })]);
    const sub = await new GeminiVideoProvider({ apiKey: KEY_G, settings: {} }, fn).generateVideo(req);
    expect(sub.jobId).toBe('int-1');
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({
      model: 'gemini-omni-1.2-flash',
      input: [{ type: 'image', data: Buffer.from('JPEGDATA').toString('base64'), mime_type: 'image/jpeg' }, { type: 'text', text: 'Vídeo do produto' }],
      response_format: { type: 'video', aspect_ratio: '9:16', duration: '10s', resolution: '720p' },
      background: true,
    });
  });

  it('se o modelo recusar background, gera de forma síncrona', async () => {
    const { fn, calls } = fakeFetch([
      json({ error: { message: 'background is not supported for this model' } }, 400),
      json({ id: 'int-2', status: 'completed' }),
    ]);
    const sub = await new GeminiVideoProvider({ apiKey: KEY_G, settings: {} }, fn).generateVideo(req);
    expect(sub).toEqual({ jobId: 'int-2', requestMeta: { mode: 'sync', status: 'completed' } });
    expect(JSON.parse(String(calls[1].init.body)).background).toBeUndefined();
  });

  it('interpreta os status da interação', async () => {
    const video = { steps: [{ type: 'user_input' }, { type: 'model_output', content: [{ type: 'text', text: 'ok' }, { type: 'video', mime_type: 'video/mp4', data: 'AAAA' }] }] };
    const { fn } = fakeFetch([
      json({ id: 'i', status: 'in_progress' }),
      json({ id: 'i', status: 'completed', ...video }),
      json({ id: 'i', status: 'completed', steps: [] }),
      json({ id: 'i', status: 'failed', error: { message: 'Resource exhausted (429)' } }),
      json({ id: 'i', status: 'cancelled' }),
    ]);
    const p = new GeminiVideoProvider({ apiKey: KEY_G, settings: {} }, fn);
    expect((await p.getGenerationStatus('i')).state).toBe('running');
    expect(await p.getGenerationStatus('i')).toMatchObject({ state: 'succeeded', result: { kind: 'inline', data: 'AAAA', mimeType: 'video/mp4' } });
    expect(await p.getGenerationStatus('i')).toMatchObject({ state: 'failed', retryable: false });
    expect(await p.getGenerationStatus('i')).toMatchObject({ state: 'failed', retryable: true });
    expect(await p.getGenerationStatus('i')).toMatchObject({ state: 'failed', retryable: false });
  });

  it('explica a falha por cota (formato real da API: campo "errors")', async () => {
    const real = { id: 'i', status: 'failed', object: 'interaction', errors: [{ message: 'There was a problem processing your request. You will only be charged for tokens successfully generated.', code: 'RESOURCE_EXHAUSTED' }] };
    const other = { id: 'i', status: 'failed', errors: [{ message: 'Something else', code: 'INTERNAL' }] };
    const p = new GeminiVideoProvider({ apiKey: KEY_G, settings: {} }, fakeFetch([json(real), json(other)]).fn);
    expect(await p.getGenerationStatus('i')).toMatchObject({ state: 'failed', retryable: true, error: expect.stringMatching(/plano gratuito.*faturamento/) });
    expect(await p.getGenerationStatus('i')).toMatchObject({ state: 'failed', error: 'Something else (INTERNAL)' });
  });

  it('429 e 5xx são temporários; 400 não', async () => {
    const p429 = new GeminiVideoProvider({ apiKey: KEY_G, settings: {} }, fakeFetch([json({}, 429)]).fn);
    await expect(p429.generateVideo(req)).rejects.toMatchObject({ retryable: true, status: 429 });
    const p400 = new GeminiVideoProvider({ apiKey: KEY_G, settings: {} }, fakeFetch([json({ error: { message: 'bad prompt' } }, 400)]).fn);
    await expect(p400.generateVideo(req)).rejects.toMatchObject({ retryable: false, status: 400 });
  });

  it('baixa arquivo da Files API com a chave no header', async () => {
    const { fn, calls } = fakeFetch([new Response(Buffer.from('VIDEO'), { status: 200 })]);
    const buf = await new GeminiVideoProvider({ apiKey: KEY_G, settings: {} }, fn)
      .downloadResult({ kind: 'url', url: 'https://generativelanguage.googleapis.com/v1beta/files/abc', authenticated: true }, 1000);
    expect(buf.toString()).toBe('VIDEO');
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY_G);
  });
});

describe('GrokVideoProvider', () => {
  it('lista modelos de vídeo pela API', async () => {
    const { fn, calls } = fakeFetch([json({ models: [{ id: 'grok-imagine-video-1.5' }, { id: 'grok-imagine-video-2' }] })]);
    const r = await new GrokVideoProvider({ apiKey: KEY_X, settings: {} }, fn).validateConnection();
    expect(r.ok).toBe(true);
    expect(r.models.map((m) => m.id)).toEqual(['grok-imagine-video-1.5', 'grok-imagine-video-2']);
    expect(r.models[1].maxDuration).toBe(15);
    expect(calls[0].url).toBe('https://api.x.ai/v1/video-generation-models');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY_X}`);
  });

  it('envia o pedido no formato documentado', async () => {
    const { fn, calls } = fakeFetch([json({ request_id: 'r-1' })]);
    const sub = await new GrokVideoProvider({ apiKey: KEY_X, settings: {} }, fn)
      .generateVideo({ ...req, model: 'grok-imagine-video-1.5', format: '1:1', duration: 12, withAudio: false });
    expect(sub.jobId).toBe('r-1');
    expect(calls[0].url).toBe('https://api.x.ai/v1/videos/generations');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: 'grok-imagine-video-1.5', prompt: 'Vídeo do produto', duration: 12, aspect_ratio: '1:1', resolution: '720p',
      image: { url: `data:image/jpeg;base64,${Buffer.from('JPEGDATA').toString('base64')}` }, generate_audio: false,
    });
  });

  it('interpreta pending, done, moderação e falhas', async () => {
    const { fn } = fakeFetch([
      json({ status: 'pending', progress: 40 }),
      json({ status: 'done', video: { url: 'https://vidgen.x.ai/v.mp4', duration: 12, respect_moderation: true } }),
      json({ status: 'done', video: { url: '', respect_moderation: false } }),
      json({ status: 'failed', error: { code: 'service_unavailable', message: 'overload' } }),
      json({ status: 'failed', error: { code: 'invalid_argument', message: 'bad' } }),
      json({ status: 'expired' }),
    ]);
    const p = new GrokVideoProvider({ apiKey: KEY_X, settings: {} }, fn);
    expect(await p.getGenerationStatus('r')).toMatchObject({ state: 'running', progress: 40 });
    expect(await p.getGenerationStatus('r')).toMatchObject({ state: 'succeeded', result: { kind: 'url', url: 'https://vidgen.x.ai/v.mp4', authenticated: false } });
    expect(await p.getGenerationStatus('r')).toMatchObject({ state: 'failed', retryable: false, error: expect.stringContaining('moderação') });
    expect(await p.getGenerationStatus('r')).toMatchObject({ state: 'failed', retryable: true });
    expect(await p.getGenerationStatus('r')).toMatchObject({ state: 'failed', retryable: false });
    expect(await p.getGenerationStatus('r')).toMatchObject({ state: 'failed', retryable: false });
  });

  it('nunca envia a chave ao baixar de outro host', async () => {
    const { fn, calls } = fakeFetch([new Response(Buffer.from('VIDEO'))]);
    await new GrokVideoProvider({ apiKey: KEY_X, settings: {} }, fn).downloadResult({ kind: 'url', url: 'https://vidgen.x.ai/v.mp4', authenticated: false }, 1000);
    expect(JSON.stringify(calls[0].init.headers ?? {})).not.toContain(KEY_X);
  });

  it('respeita o limite de tamanho no download', async () => {
    const { fn } = fakeFetch([new Response(Buffer.alloc(2000))]);
    await expect(new GrokVideoProvider({ apiKey: KEY_X, settings: {} }, fn).downloadResult({ kind: 'url', url: 'https://vidgen.x.ai/v.mp4', authenticated: false }, 1000))
      .rejects.toBeInstanceOf(ProviderError);
  });
});

describe('formato das chaves', () => {
  it('aceita a chave clássica (AIza…) e a nova (AQ.…) do Google', async () => {
    const { PROVIDERS } = await import('./index');
    expect(PROVIDERS.gemini.keyPattern!.test(KEY_G)).toBe(true);
    expect(PROVIDERS.gemini.keyPattern!.test('AQ.Ab8RN6Ik1xYlJKBicuB2ybE7cP7DNyb4ojmGbDHYTESTE')).toBe(true);
    expect(PROVIDERS.gemini.keyPattern!.test('chave com espaço e muito longa ......')).toBe(false);
  });
});

describe('redact', () => {
  it('remove chaves de textos de erro', () => {
    expect(redact(`erro com ${KEY_X} e ?key=abc123&x=1 e Bearer abcdefghijkl`, KEY_X)).toBe('erro com [chave oculta] e ?key=[oculta]&x=1 e Bearer [oculta]');
  });
});
