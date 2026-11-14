// Grupos de WhatsApp de cada conta. Todos recebem as mesmas ofertas da rodada; quantos
// grupos valem depende do plano (maxWaGroups). Se a conta tiver mais grupos que o plano
// permite (ex.: depois de mudar para um plano menor), valem os mais antigos.
import { q, tx } from './db';

export type WaGroup = { jid: string; name: string };

export const listWaGroups = (accountId: string) =>
  q<WaGroup>('SELECT jid, name FROM whatsapp_groups WHERE account_id = $1 ORDER BY created_at, jid', [accountId]);

// Os grupos que recebem ofertas agora, respeitando o limite do plano
export const activeWaGroups = (groups: WaGroup[], maxWaGroups: number) => groups.slice(0, Math.max(0, maxWaGroups));

export type AddResult = { ok: true } | { ok: false; reason: 'limit' | 'exists' };

// O limite é conferido no próprio INSERT (com a conta travada), então dois cliques simultâneos
// não passam do limite do plano.
export async function addWaGroup(accountId: string, group: WaGroup, maxWaGroups: number): Promise<AddResult> {
  return tx(async (c) => {
    await c.query('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
    const [{ total, exists }] = await c.query<{ total: number; exists: boolean }>(
      `SELECT count(*)::int AS total, bool_or(jid = $2) AS exists FROM whatsapp_groups WHERE account_id = $1`,
      [accountId, group.jid]
    );
    if (exists) return { ok: false, reason: 'exists' } as const;
    if (total >= maxWaGroups) return { ok: false, reason: 'limit' } as const;
    await c.query('INSERT INTO whatsapp_groups (account_id, jid, name) VALUES ($1, $2, $3)', [accountId, group.jid, group.name.slice(0, 200)]);
    await mirrorLegacy(c, accountId);
    return { ok: true } as const;
  });
}

export async function removeWaGroup(accountId: string, jid: string) {
  await tx(async (c) => {
    await c.query('DELETE FROM whatsapp_groups WHERE account_id = $1 AND jid = $2', [accountId, jid]);
    await mirrorLegacy(c, accountId);
  });
}

export async function clearWaGroups(accountId: string) {
  await tx(async (c) => {
    await c.query('DELETE FROM whatsapp_groups WHERE account_id = $1', [accountId]);
    await mirrorLegacy(c, accountId);
  });
}

// Compatibilidade: o painel administrativo separado (autoachados-admin) ainda lê o grupo único
// das configurações (whatsappGroupJid/Name). Mantém ali o primeiro grupo da lista.
async function mirrorLegacy(c: { query: (sql: string, p?: unknown[]) => Promise<unknown[]> }, accountId: string) {
  await c.query(
    `WITH first AS (SELECT jid, name FROM whatsapp_groups WHERE account_id = $1 ORDER BY created_at, jid LIMIT 1)
     INSERT INTO account_settings (account_id, key, value, encrypted, updated_at)
     VALUES ($1, 'whatsappGroupJid', to_jsonb(coalesce((SELECT jid FROM first), ''))::text, false, now()),
            ($1, 'whatsappGroupName', to_jsonb(coalesce((SELECT name FROM first), ''))::text, false, now())
     ON CONFLICT (account_id, key) DO UPDATE SET value = EXCLUDED.value, encrypted = false, updated_at = now()`,
    [accountId]
  );
}
