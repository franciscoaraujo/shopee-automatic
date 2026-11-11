// Autenticação mínima da área /admin: uma senha (ADMIN_PASSWORD) e um cookie assinado com HMAC.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const COOKIE = 'aa_admin';
const TTL_MS = 12 * 60 * 60 * 1000; // 12 h

export const adminConfigured = () => Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 8);

function secret() {
  // ADMIN_SESSION_SECRET opcional; senão deriva da senha (trocar a senha invalida as sessões)
  return process.env.ADMIN_SESSION_SECRET || createHash('sha256').update(`aa:${process.env.ADMIN_PASSWORD}`).digest('hex');
}

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');

function safeEqual(a: string, b: string) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkPassword(input: string) {
  return adminConfigured() && safeEqual(input, process.env.ADMIN_PASSWORD!);
}

export function newSessionValue() {
  const exp = String(Date.now() + TTL_MS);
  return { value: `${exp}.${sign(exp)}`, maxAge: TTL_MS / 1000 };
}

export async function isAdmin(): Promise<boolean> {
  if (!adminConfigured()) return false;
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  const [exp, mac] = raw.split('.');
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  return safeEqual(mac, sign(exp));
}
