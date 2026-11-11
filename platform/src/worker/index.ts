// Worker da esteira: roda continuamente, separado do site.
//   npm run worker        (produção: node dist/worker.mjs)
// Seguro para várias instâncias: cada conta é "reservada" com FOR UPDATE SKIP LOCKED.
import { TRIAL_PLAN } from '@/lib/plans';
import type { Account } from '@/server/accounts';
import { migrate, q } from '@/server/db';
import { runAccount } from '@/server/pipeline';

const TICK_MS = Number(process.env.WORKER_TICK_MS || 20_000);
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 4);
const BATCH = CONCURRENCY * 2;
let stopping = false;
let active = 0;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

// Agendamento provisório ao reservar a conta: ciclo sob medida do cliente, senão o do plano
// (tabela plans; em teste grátis, o do plano de teste). A rodada agendada recalcula com o
// ciclo escolhido pelo cliente.
const intervalSql = `coalesce(
  (SELECT o.interval_min FROM account_overrides o WHERE o.account_id = a.id),
  (SELECT p.interval_min FROM plans p WHERE p.id = CASE WHEN a.status = 'trial' THEN $2 ELSE a.plan END),
  30)`;

async function claimDue(limit: number): Promise<(Account & { was_manual: boolean })[]> {
  return q<Account & { was_manual: boolean }>(
    `WITH due AS (
       SELECT id, manual_run FROM accounts
       WHERE (status = 'active' OR (status = 'trial' AND trial_ends_at > now()))
         AND (next_run_at IS NULL OR next_run_at <= now())
       ORDER BY next_run_at NULLS FIRST
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE accounts a SET next_run_at = now() + ${intervalSql} * interval '1 minute', manual_run = false
     FROM due WHERE a.id = due.id
     RETURNING a.*, due.manual_run AS was_manual`,
    [limit, TRIAL_PLAN]
  );
}

async function processAccount(a: Account & { was_manual: boolean }) {
  active++;
  try {
    const out = await runAccount(a, a.was_manual ? 'manual' : 'schedule');
    if (out.status === 'done') log(`[${a.id.slice(0, 8)}] ${a.name}: ${out.found} encontrados, ${out.published} publicados${out.failures ? `, ${out.failures} falhas` : ''}${out.error ? ` — ${out.error}` : ''}`);
  } catch (err) {
    log(`[${a.id.slice(0, 8)}] erro inesperado:`, err);
  } finally {
    active--;
  }
}

async function heartbeat() {
  await q(
    `INSERT INTO system_kv (key, value, updated_at) VALUES ('worker_heartbeat', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ active, pid: process.pid })]
  );
}

async function tick() {
  await heartbeat();
  const free = CONCURRENCY - active;
  if (free <= 0) return;
  const accounts = await claimDue(Math.min(free, BATCH));
  for (const a of accounts) void processAccount(a);
}

async function main() {
  await migrate();
  log(`Worker iniciado · concorrência ${CONCURRENCY} · verificação a cada ${TICK_MS / 1000}s`);
  while (!stopping) {
    try {
      await tick();
    } catch (err) {
      log('Falha no ciclo:', err);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
  // aguarda rodadas em andamento terminarem
  while (active > 0) await new Promise((r) => setTimeout(r, 500));
  log('Worker encerrado');
  process.exit(0);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1);
    stopping = true;
    log(`Recebido ${sig}, finalizando rodadas em andamento…`);
  });
}

void main();
