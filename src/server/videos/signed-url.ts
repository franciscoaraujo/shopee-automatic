// URLs assinadas para os arquivos privados (vídeo e miniatura).
// A assinatura (HMAC-SHA256, chave derivada da APP_MASTER_KEY) cobre o objeto, a validade e
// o tipo de entrega; alterar qualquer um invalida a URL. Só o dono da conta recebe a URL,
// porque ela é gerada no servidor depois de conferir a sessão.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { deriveKey } from '@/server/crypto';

export const MEDIA_TTL_SEC = 15 * 60;
export type MediaDisposition = 'inline' | 'attachment';

let key: Buffer | null = null;
const hmacKey = () => (key ??= deriveKey('video-media-url'));

const sign = (objectKey: string, exp: number, disp: MediaDisposition, secret: Buffer) =>
  createHmac('sha256', secret).update(`${objectKey}\n${exp}\n${disp}`).digest('base64url');

export function signMediaUrl(objectKey: string, opts: { disposition?: MediaDisposition; filename?: string; ttlSec?: number; now?: number; secret?: Buffer } = {}): string {
  const disp = opts.disposition ?? 'inline';
  const exp = Math.floor((opts.now ?? Date.now()) / 1000) + (opts.ttlSec ?? MEDIA_TTL_SEC);
  const p = new URLSearchParams({ k: objectKey, e: String(exp), d: disp, s: sign(objectKey, exp, disp, opts.secret ?? hmacKey()) });
  if (opts.filename) p.set('f', opts.filename);
  return `/api/videos/media?${p.toString()}`;
}

export type VerifiedMedia = { objectKey: string; disposition: MediaDisposition; filename: string | null };

export function verifyMediaParams(params: URLSearchParams, opts: { now?: number; secret?: Buffer } = {}): VerifiedMedia | null {
  const k = params.get('k');
  const e = Number(params.get('e'));
  const d = params.get('d');
  const s = params.get('s');
  if (!k || !s || !Number.isInteger(e) || (d !== 'inline' && d !== 'attachment')) return null;
  if (!/^accounts\/[0-9a-f-]{36}\/videos\/[0-9a-f-]{36}\/(video\.mp4|thumb\.jpg)$/.test(k)) return null;
  if (e < Math.floor((opts.now ?? Date.now()) / 1000)) return null;
  const expected = Buffer.from(sign(k, e, d, opts.secret ?? hmacKey()));
  const given = Buffer.from(s);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const f = params.get('f');
  return { objectKey: k, disposition: d, filename: f && /^[\w .()-]{1,120}$/.test(f) ? f : null };
}
