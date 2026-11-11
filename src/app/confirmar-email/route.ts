// Link do e-mail de confirmação: ativa a conta e leva para o login.
import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { one } from '@/server/db';
import { consumeToken } from '@/server/email-tokens';
import { publicUrl } from '@/lib/public-url';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const to = (path: string) => NextResponse.redirect(publicUrl(request, path), 303);

  const ok = await consumeToken(token, 'verify');
  let userId = ok?.user_id ?? null;

  if (!userId && token && token.length <= 100) {
    // Já usado (ex.: antivírus do e-mail abriu o link antes): se a conta já está confirmada, é sucesso
    const row = await one<{ user_id: string; verified: boolean }>(
      `SELECT t.user_id, (u.email_verified_at IS NOT NULL) AS verified
       FROM email_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1 AND t.purpose = 'verify' AND t.used_at IS NOT NULL`,
      [sha(token)]
    );
    if (row?.verified) userId = row.user_id;
  }

  if (!userId) return to('/entrar?link=invalido');

  const u = await one<{ email: string }>(
    'UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1 RETURNING email',
    [userId]
  );
  return to(`/entrar?confirmado=1&email=${encodeURIComponent(u?.email ?? '')}`);
}
