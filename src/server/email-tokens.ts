// Tokens de uso único enviados por e-mail. Só o SHA-256 fica no banco.
import { createHash, randomBytes } from 'node:crypto';
import { one, q } from './db';

export type Purpose = 'verify' | 'reset';
const TTL: Record<Purpose, string> = { verify: '48 hours', reset: '1 hour' };
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

export async function issueToken(userId: string, purpose: Purpose): Promise<string> {
  // Um link válido por vez: novos pedidos invalidam os anteriores do mesmo tipo
  await q(`UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [userId, purpose]);
  const token = randomBytes(32).toString('base64url');
  await q(`INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, now() + $4::interval)`, [sha(token), userId, purpose, TTL[purpose]]);
  return token;
}

// Valida sem consumir (para mostrar a página de nova senha)
export async function peekToken(token: string, purpose: Purpose) {
  if (!token || token.length > 100) return null;
  return one<{ user_id: string }>(
    `SELECT user_id FROM email_tokens WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()`,
    [sha(token), purpose]
  );
}

// Consome de forma atômica: um único uso, mesmo com cliques duplicados
export async function consumeToken(token: string, purpose: Purpose) {
  if (!token || token.length > 100) return null;
  return one<{ user_id: string }>(
    `UPDATE email_tokens SET used_at = now()
     WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [sha(token), purpose]
  );
}
