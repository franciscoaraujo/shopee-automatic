// Conexão com o PostgreSQL e criação das tabelas (idempotente).
// Usado pelo app web e pelo worker.
import { Pool, type QueryResultRow } from 'pg';
import { DEFAULT_PLANS } from '@/lib/plans';
import { runMigrations } from './migrations';

const g = globalThis as unknown as { __pool?: Pool; __migrated?: Promise<void> };

export function pool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não configurada');
  g.__pool ??= new Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX || 10),
    ssl: /sslmode=require|neon\.tech|supabase\.co/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  return g.__pool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id             uuid PRIMARY KEY,
  name           text NOT NULL,
  plan           text NOT NULL DEFAULT 'pro',
  status         text NOT NULL DEFAULT 'trial',   -- trial | active | suspended | canceled
  trial_ends_at  timestamptz,
  whatsapp       text,
  source         text,
  notes          text NOT NULL DEFAULT '',
  next_run_at    timestamptz,
  manual_run     boolean NOT NULL DEFAULT false,
  kw_index       integer NOT NULL DEFAULT -1,
  page           integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounts_due_idx ON accounts (next_run_at) WHERE status IN ('trial', 'active');

CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY,
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name           text NOT NULL,
  email          text NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);
CREATE INDEX IF NOT EXISTS users_account_idx ON users (account_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS account_settings (
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key         text NOT NULL,
  value       text NOT NULL,
  encrypted   boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, key)
);

CREATE TABLE IF NOT EXISTS runs (
  id           bigserial PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  trigger      text NOT NULL DEFAULT 'schedule',
  keyword      text,
  page         integer,
  sort_type    integer,
  found        integer NOT NULL DEFAULT 0,
  selected     integer NOT NULL DEFAULT 0,
  error        text,
  duration_ms  integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_account_idx ON runs (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS deliveries (
  id               bigserial PRIMARY KEY,
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  run_id           bigint REFERENCES runs(id) ON DELETE CASCADE,
  channel          text NOT NULL,
  item_id          text NOT NULL,
  product_name     text,
  price            numeric,
  commission_rate  numeric,
  commission       numeric,
  affiliate_link   text,
  image_url        text,
  success          boolean NOT NULL,
  error            text,
  message_id       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deliveries_account_idx ON deliveries (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sent_items (
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id     text NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, item_id)
);

-- Evolução do esquema em bancos já existentes
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS manual_run boolean NOT NULL DEFAULT false;

-- Confirmação de e-mail. Contas que já existiam ficam confirmadas (o DEFAULT now() só
-- preenche as linhas existentes ao criar a coluna); as novas nascem sem confirmação.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz DEFAULT now();
ALTER TABLE users ALTER COLUMN email_verified_at DROP DEFAULT;

-- Links de uso único enviados por e-mail (confirmação de cadastro e recuperação de senha).
-- Guarda-se só o SHA-256 do token.
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL,              -- verify | reset
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_tokens_user_idx ON email_tokens (user_id, purpose);

CREATE TABLE IF NOT EXISTS system_kv (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Planos (editáveis pelo painel administrativo). Lidos pelo site, pelo painel e pelo worker.
CREATE TABLE IF NOT EXISTS plans (
  id            text PRIMARY KEY CHECK (id ~ '^[a-z0-9_-]{2,30}$'),
  name          text NOT NULL,
  price_cents   integer NOT NULL CHECK (price_cents >= 0),
  tagline       text NOT NULL DEFAULT '',
  interval_min  integer NOT NULL CHECK (interval_min BETWEEN 10 AND 240),
  max_channels  smallint NOT NULL CHECK (max_channels IN (1, 2)),
  max_per_run   smallint NOT NULL CHECK (max_per_run BETWEEN 1 AND 20),
  schedule      jsonb NOT NULL CHECK (schedule->>'mode' IN ('fixed', 'bounded', 'full')),
  items         jsonb NOT NULL DEFAULT '[]',
  highlight     boolean NOT NULL DEFAULT false,
  visible       boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Promoções: sem código = automática (vitrine do site); com código = cupom no cadastro
CREATE TABLE IF NOT EXISTS promotions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text UNIQUE CHECK (code IS NULL OR code ~ '^[A-Z0-9_-]{3,30}$'),
  description      text NOT NULL,
  plan_ids         text[] NOT NULL,
  discount_type    text NOT NULL CHECK (discount_type IN ('percent', 'fixed', 'extra_trial_days')),
  discount_value   integer NOT NULL CHECK (discount_value > 0),
  starts_at        timestamptz NOT NULL DEFAULT now(),
  ends_at          timestamptz,
  max_redemptions  integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redemptions      integer NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (discount_type <> 'percent' OR discount_value <= 100)
);

-- Limites e preço sob medida por cliente (NULL = vale o do plano)
CREATE TABLE IF NOT EXISTS account_overrides (
  account_id    uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  interval_min  integer CHECK (interval_min IS NULL OR interval_min BETWEEN 10 AND 240),
  max_channels  smallint CHECK (max_channels IS NULL OR max_channels IN (1, 2)),
  max_per_run   smallint CHECK (max_per_run IS NULL OR max_per_run BETWEEN 1 AND 20),
  price_cents   integer CHECK (price_cents IS NULL OR price_cents >= 0),
  promotion_id  uuid REFERENCES promotions(id) ON DELETE SET NULL,
  reason        text NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Vários grupos de WhatsApp por conta (limite por plano; NULL no override = vale o do plano).
-- Todos os grupos recebem as mesmas ofertas da rodada.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_wa_groups smallint NOT NULL DEFAULT 1 CHECK (max_wa_groups BETWEEN 1 AND 50);
ALTER TABLE account_overrides ADD COLUMN IF NOT EXISTS max_wa_groups smallint CHECK (max_wa_groups IS NULL OR max_wa_groups BETWEEN 1 AND 50);
CREATE TABLE IF NOT EXISTS whatsapp_groups (
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  jid         text NOT NULL CHECK (jid ~ '^[0-9][0-9-]*@g[.]us$'),
  name        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, jid)
);
-- Destino de cada envio (JID do grupo / chat do Telegram); NULL nos envios antigos
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS target text;
`;

// Passos de dados que rodam uma única vez (marcados em system_kv), na mesma transação da marca.
const ONCE: { key: string; sql: string }[] = [
  {
    // Grupo único das configurações (whatsappGroupJid/Name) → tabela whatsapp_groups;
    // limites iniciais dos planos padrão (o admin pode alterar depois).
    key: 'wa_groups_v1',
    sql: `
      INSERT INTO whatsapp_groups (account_id, jid, name)
      SELECT j.account_id, j.value::jsonb #>> '{}', coalesce(n.value::jsonb #>> '{}', '')
      FROM account_settings j
      LEFT JOIN account_settings n ON n.account_id = j.account_id AND n.key = 'whatsappGroupName' AND NOT n.encrypted
      WHERE j.key = 'whatsappGroupJid' AND NOT j.encrypted AND (j.value::jsonb #>> '{}') ~ '^[0-9][0-9-]*@g[.]us$'
      ON CONFLICT DO NOTHING;
      UPDATE plans SET max_wa_groups = 3 WHERE id = 'pro';
      UPDATE plans SET max_wa_groups = 10 WHERE id = 'escala';`,
  },
];

async function runOnce() {
  for (const step of ONCE) {
    const client = await pool().connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(`INSERT INTO system_kv (key, value) VALUES ($1, '1') ON CONFLICT DO NOTHING RETURNING key`, [`once:${step.key}`]);
      if (r.rowCount) await client.query(step.sql);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}

// Carga inicial dos planos, uma única vez (marcada em system_kv): se o admin apagar ou
// renomear um plano depois, ele não volta sozinho no próximo deploy.
async function seedPlans() {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`INSERT INTO system_kv (key, value) VALUES ('plans_seeded', '1') ON CONFLICT DO NOTHING RETURNING key`);
    if (r.rowCount) {
      for (const [i, p] of DEFAULT_PLANS.entries()) {
        await client.query(
          `INSERT INTO plans (id, name, price_cents, tagline, interval_min, max_channels, max_per_run, max_wa_groups, schedule, items, highlight, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (id) DO NOTHING`,
          [p.id, p.name, p.priceCents, p.tagline, p.intervalMin, p.maxChannels, p.maxPerRun, p.maxWaGroups, JSON.stringify(p.schedule), JSON.stringify(p.items), !!p.highlight, i]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function migrate(): Promise<void> {
  g.__migrated ??= pool()
    .query(SCHEMA)
    .then(seedPlans)
    .then(() => runMigrations(pool()))
    .then(runOnce)
    .then(() => undefined)
    .catch((err) => {
      g.__migrated = undefined; // tenta de novo na próxima chamada
      throw err;
    });
  return g.__migrated;
}

export async function q<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  await migrate();
  const r = await pool().query<T>(sql, params);
  return r.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await q<T>(sql, params))[0] ?? null;
}

export async function tx<T>(fn: (c: { query: <R extends QueryResultRow>(sql: string, p?: unknown[]) => Promise<R[]> }) => Promise<T>): Promise<T> {
  await migrate();
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn({ query: async (sql, p = []) => (await client.query(sql, p)).rows });
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
