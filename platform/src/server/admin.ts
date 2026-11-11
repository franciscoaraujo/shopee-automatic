// Consultas e operações da área administrativa (dono da plataforma).
import { randomBytes } from 'node:crypto';
import { ACCOUNT_STATUSES, type AccountStatus, type PlanId } from '@/lib/plans';
import { billingByAccount, monthlyRevenueCents, planExists } from './plans';
import { setPassword } from './accounts';
import { waLogout } from './integrations';
import { one, q } from './db';

export type AdminAccountRow = {
  id: string; name: string; plan: PlanId; status: AccountStatus; trial_ends_at: string | null; created_at: string;
  whatsapp: string | null; source: string | null; notes: string;
  user_id: string; email: string; last_login_at: string | null;
  last_run_at: string | null; published_7d: number; failures_7d: number; has_shopee: boolean; trial_expired: boolean; email_verified: boolean;
  custom_price: { price: string; reason: string | null } | null; // preço especial ou promoção vinculada
};

export async function listAccounts(): Promise<AdminAccountRow[]> {
  const rows = await q(`
    SELECT a.id, a.name, a.plan, a.status, a.trial_ends_at, a.created_at, a.whatsapp, a.source, a.notes,
           u.id AS user_id, u.email, u.last_login_at, (u.email_verified_at IS NOT NULL) AS email_verified,
           (SELECT max(created_at) FROM runs r WHERE r.account_id = a.id) AS last_run_at,
           (SELECT count(DISTINCT item_id) FROM deliveries d WHERE d.account_id = a.id AND d.success AND d.created_at > now() - interval '7 days') AS published_7d,
           (SELECT count(*) FROM deliveries d WHERE d.account_id = a.id AND NOT d.success AND d.created_at > now() - interval '7 days') AS failures_7d,
           EXISTS (SELECT 1 FROM account_settings s WHERE s.account_id = a.id AND s.key = 'shopeeSecret') AS has_shopee,
           (a.status = 'trial' AND a.trial_ends_at <= now()) AS trial_expired
    FROM accounts a
    JOIN LATERAL (SELECT * FROM users WHERE account_id = a.id ORDER BY created_at LIMIT 1) u ON true
    ORDER BY a.created_at DESC
    LIMIT 2000`);
  const billing = await billingByAccount();
  return rows.map((r) => ({
    ...r,
    trial_ends_at: r.trial_ends_at ? new Date(r.trial_ends_at).toISOString() : null,
    created_at: new Date(r.created_at).toISOString(),
    last_login_at: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
    last_run_at: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
    published_7d: Number(r.published_7d),
    failures_7d: Number(r.failures_7d),
    custom_price: (() => {
      const b = billing.get(r.id);
      return b && b.priceCents !== b.baseCents ? { price: b.price, reason: b.reason } : null;
    })(),
  })) as AdminAccountRow[];
}

export async function updateAccount(id: string, patch: { status?: string; plan?: string; notes?: string }) {
  // Mudou situação ou plano: o worker recalcula a próxima rodada (intervalo e horário do novo plano)
  if (patch.status && ACCOUNT_STATUSES.some((s) => s.value === patch.status)) {
    await q('UPDATE accounts SET status = $2, next_run_at = NULL WHERE id = $1', [id, patch.status]);
  }
  if (patch.plan && (await planExists(patch.plan))) {
    await q('UPDATE accounts SET plan = $2, next_run_at = NULL WHERE id = $1', [id, patch.plan]);
  }
  if (typeof patch.notes === 'string') {
    await q('UPDATE accounts SET notes = $2 WHERE id = $1', [id, patch.notes.slice(0, 2000)]);
  }
}

export async function extendTrial(id: string, days: number) {
  await q(
    `UPDATE accounts SET status = 'trial',
       trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + ($2 || ' days')::interval
     WHERE id = $1`,
    [id, String(days)]
  );
}

// Gera uma senha temporária (mostrada uma única vez ao admin) e derruba as sessões do usuário
export async function resetUserPassword(accountId: string): Promise<{ email: string; password: string } | null> {
  const u = await one<{ id: string; email: string }>('SELECT id, email FROM users WHERE account_id = $1 ORDER BY created_at LIMIT 1', [accountId]);
  if (!u) return null;
  const password = randomBytes(9).toString('base64url');
  await setPassword(u.id, password);
  await q('DELETE FROM sessions WHERE user_id = $1', [u.id]);
  return { email: u.email, password };
}

export async function platformTotals() {
  const r = await one(`
    SELECT count(*) AS accounts,
           count(*) FILTER (WHERE status = 'active') AS active,
           count(*) FILTER (WHERE status = 'trial' AND trial_ends_at > now()) AS trial,
           count(*) FILTER (WHERE status = 'trial' AND trial_ends_at <= now()) AS trial_expired,
           count(*) FILTER (WHERE created_at > now() - interval '7 days') AS new_7d
    FROM accounts`);
  const revenue = (await monthlyRevenueCents()) / 100;
  return { accounts: Number(r?.accounts), active: Number(r?.active), trial: Number(r?.trial), trialExpired: Number(r?.trial_expired), new7d: Number(r?.new_7d), mrr: revenue };
}

// Exclusão definitiva (LGPD): desconecta o WhatsApp e apaga a conta — o banco remove em cascata
// usuários, sessões, credenciais, rodadas, envios e itens enviados.
export async function deleteAccount(id: string) {
  await waLogout(id).catch(() => {});
  await q('DELETE FROM accounts WHERE id = $1', [id]);
}

export async function confirmEmail(accountId: string) {
  await q('UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE account_id = $1', [accountId]);
}
