// Sessão dos clientes (somente app web).
// Token aleatório no cookie; no banco fica apenas o SHA-256 dele.
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getAccount, type Account, type User } from './accounts';
import { one, q } from './db';

export const SESSION_COOKIE = 'aa_session';
const TTL_DAYS = 30;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

export async function startSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  await q(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)`, [sha(token), userId, String(TTL_DAYS)]);
  await q('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    path: '/',
    maxAge: TTL_DAYS * 86400,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await q('DELETE FROM sessions WHERE token_hash = $1', [sha(token)]);
  jar.delete(SESSION_COOKIE);
}

export type Ctx = { user: User; account: Account };

export const currentSession = cache(async (): Promise<Ctx | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const user = await one<User>(
    `SELECT u.id, u.account_id, u.name, u.email, u.created_at, u.last_login_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha(token)]
  );
  if (!user) return null;
  const account = await getAccount(user.account_id);
  if (!account) return null;
  return { user, account };
});

// Para páginas e ações do painel: redireciona para o login se não houver sessão
export async function requireSession(): Promise<Ctx> {
  const s = await currentSession();
  if (!s) redirect('/entrar');
  return s;
}

// Encerra as outras sessões (ex.: após trocar a senha)
export async function endOtherSessions(userId: string) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  await q('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, token ? sha(token) : '']);
}
