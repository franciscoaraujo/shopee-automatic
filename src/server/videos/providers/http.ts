// HTTP para os adaptadores: tempo-limite, classificação de erros e remoção de segredos.
import { ProviderError } from './types';

export type FetchLike = typeof fetch;

// Remove a chave de qualquer texto que possa ir para log, banco ou tela.
export function redact(text: string, secret: string): string {
  let out = String(text ?? '');
  if (secret && secret.length >= 6) out = out.split(secret).join('[chave oculta]');
  return out.replace(/([?&]key=)[^&\s"]+/gi, '$1[oculta]').replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/g, '$1[oculta]');
}

export const isRetryableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

export async function callJson<T>(
  doFetch: FetchLike,
  url: string,
  init: RequestInit & { timeoutMs?: number },
  secret: string,
  describe: (status: number, body: unknown) => string
): Promise<T> {
  const { timeoutMs = 60_000, ...rest } = init;
  let res: Response;
  try {
    res = await doFetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const e = err as Error;
    const msg = e.name === 'TimeoutError' ? `Tempo esgotado (${Math.round(timeoutMs / 1000)} s) ao chamar o provedor` : `Falha de rede: ${e.message}`;
    throw new ProviderError(redact(msg, secret), true);
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    throw new ProviderError(redact(describe(res.status, body), secret), isRetryableStatus(res.status), res.status);
  }
  return body as T;
}

// Baixa um arquivo com limite de tamanho (não carrega mais que maxBytes na memória).
export async function downloadLimited(doFetch: FetchLike, url: string, headers: Record<string, string>, maxBytes: number, secret: string): Promise<Buffer> {
  let res: Response;
  try {
    res = await doFetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(5 * 60_000) });
  } catch (err) {
    throw new ProviderError(redact(`Falha ao baixar o vídeo: ${(err as Error).message}`, secret), true);
  }
  if (!res.ok || !res.body) throw new ProviderError(`Falha ao baixar o vídeo (HTTP ${res.status})`, isRetryableStatus(res.status), res.status);
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new ProviderError(`Vídeo maior que o limite (${Math.round(maxBytes / 1048576)} MB)`, false);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new ProviderError(`Vídeo maior que o limite (${Math.round(maxBytes / 1048576)} MB)`, false);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// Extrai a mensagem de erro dos formatos usados pelas APIs ({error:{message}} ou {error:"..."}).
// A Gemini Interactions API embrulha o erro num array: [{ "error": { … } }].
export function errorMessage(body: unknown): string {
  if (Array.isArray(body)) return body.length ? errorMessage(body[0]) : '';
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const e = b.error;
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object' && typeof (e as Record<string, unknown>).message === 'string') return (e as Record<string, string>).message;
    if (typeof b.message === 'string') return b.message;
    if (typeof b.code === 'string') return b.code;
  }
  return typeof body === 'string' ? body.slice(0, 300) : '';
}
