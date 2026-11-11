// Contas (tenants) e usuários. Sem dependência do Next.js — usado também pelo worker.
import { randomUUID, scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { TRIAL_DAYS, TRIAL_PLAN, type AccountStatus, type PlanId } from '@/lib/plans';
import { one, q, tx } from './db';
import { redeemPromotion } from './plans';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, h] = stored.split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const expected = Buffer.from(h, 'base64');
  const got = await scrypt(pw, Buffer.from(s, 'base64'), expected.length, SCRYPT);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// Hash fixo para igualar o tempo de resposta quando o e-mail não existe
let dummyHash: Promise<string> | null = null;
export const dummyPasswordCheck = async (pw: string) => verifyPassword(pw, await (dummyHash ??= hashPassword('dummy-password')));

export type Account = {
  id: string;
  name: string;
  plan: PlanId;
  status: AccountStatus;
  trial_ends_at: Date | null;
  whatsapp: string | null;
  source: string | null;
  notes: string;
  next_run_at: Date | null;
  manual_run: boolean;
  kw_index: number;
  page: number;
  created_at: Date;
};

export type User = { id: string; account_id: string; name: string; email: string; created_at: Date; last_login_at: Date | null; email_verified_at?: Date | null };

class CouponError extends Error {}

/**
 * Cria conta + dono em teste grátis. Aplica a promoção do cadastro: o cupom digitado (inválido =
 * erro) ou, sem cupom, a melhor promoção automática do plano. Dias extras somam ao teste;
 * desconto fica vinculado à conta (account_overrides.promotion_id).
 */
export async function createAccountWithOwner(input: {
  name: string; email: string; password: string; whatsapp: string; plan: PlanId; source: string | null; coupon?: string | null;
}): Promise<{ account: Account; user: User; promotion: string | null } | { error: 'email_taken' | 'coupon_invalid' }> {
  const passwordHash = await hashPassword(input.password);
  const accountId = randomUUID();
  const userId = randomUUID();
  try {
    return await tx(async (c) => {
      const [account] = await c.query<Account>(
        `INSERT INTO accounts (id, name, plan, status, trial_ends_at, whatsapp, source)
         VALUES ($1, $2, $3, 'trial', now() + ($4 || ' days')::interval, $5, $6) RETURNING *`,
        [accountId, input.name, input.plan || TRIAL_PLAN, String(TRIAL_DAYS), input.whatsapp, input.source]
      );
      const [user] = await c.query<User>(
        `INSERT INTO users (id, account_id, name, email, password_hash) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, account_id, name, email, created_at, last_login_at`,
        [userId, accountId, input.name, input.email, passwordHash]
      );
      const promo = await redeemPromotion(c, account.plan, input.coupon || null);
      if (input.coupon && !promo) throw new CouponError();
      if (promo?.type === 'extra_trial_days') {
        const [a] = await c.query<Account>(
          `UPDATE accounts SET trial_ends_at = trial_ends_at + ($2 || ' days')::interval WHERE id = $1 RETURNING *`,
          [accountId, String(promo.value)]
        );
        Object.assign(account, a);
      } else if (promo) {
        await c.query(
          `INSERT INTO account_overrides (account_id, promotion_id, reason) VALUES ($1, $2, $3)`,
          [accountId, promo.id, `Promoção no cadastro: ${promo.description}`.slice(0, 300)]
        );
      }
      return { account, user, promotion: promo?.description ?? null };
    });
  } catch (err) {
    if (err instanceof CouponError) return { error: 'coupon_invalid' };
    if ((err as { code?: string }).code === '23505') return { error: 'email_taken' };
    throw err;
  }
}

export const getAccount = (id: string) => one<Account>('SELECT * FROM accounts WHERE id = $1', [id]);

export async function findUserForLogin(email: string) {
  return one<User & { password_hash: string }>('SELECT * FROM users WHERE email = $1', [email]);
}

export async function setPassword(userId: string, pw: string) {
  await q('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, await hashPassword(pw)]);
}

// Conta pode rodar a esteira?
export function isOperational(a: Pick<Account, 'status' | 'trial_ends_at'>, now = new Date()) {
  if (a.status === 'active') return true;
  if (a.status === 'trial') return !!a.trial_ends_at && new Date(a.trial_ends_at) > now;
  return false;
}

export function trialDaysLeft(a: Pick<Account, 'status' | 'trial_ends_at'>, now = new Date()) {
  if (a.status !== 'trial' || !a.trial_ends_at) return null;
  return Math.max(0, Math.ceil((new Date(a.trial_ends_at).getTime() - now.getTime()) / 86_400_000));
}
