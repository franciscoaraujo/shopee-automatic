// Migrations versionadas. Rodam depois do esquema-base (db.ts), uma única vez cada, em ordem.
// Cada migration é aplicada numa transação e registrada em schema_migrations.
// Um advisory lock impede que web, worker e worker de vídeos migrem ao mesmo tempo.
//
// Para alterar o banco: acrescente uma nova entrada no FIM da lista (nunca edite uma já aplicada).
import type { Pool } from 'pg';

export type Migration = { id: string; sql: string };

export const MIGRATIONS: Migration[] = [
  {
    // Campos da Shopee que já chegavam na busca e não eram guardados. Usados pelo módulo de
    // vídeos (preço original = preço / (1 − desconto)). Linhas antigas ficam NULL.
    id: '001_deliveries_product_fields',
    sql: `
      ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS discount_rate numeric;
      ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS product_link  text;
      ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS shop_name     text;
      CREATE INDEX IF NOT EXISTS deliveries_account_item_idx ON deliveries (account_id, item_id, created_at DESC);
    `,
  },
  {
    // Shopee Video Studio: provedores de IA, projetos de vídeo, arquivos, avaliações e logs.
    // Tudo isolado por account_id. Produtos NÃO são duplicados: product_id é o item_id da
    // Shopee (o mesmo de deliveries) e product_snapshot guarda os dados no momento da geração.
    id: '002_video_studio',
    sql: `
      CREATE TABLE ai_providers (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name                text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
        provider_type       text NOT NULL,
        api_key_encrypted   text NOT NULL,
        api_key_hint        text NOT NULL DEFAULT '',          -- últimos 4 caracteres, para exibição
        default_model       text,
        enabled             boolean NOT NULL DEFAULT true,
        is_default          boolean NOT NULL DEFAULT false,
        connection_status   text NOT NULL DEFAULT 'unknown' CHECK (connection_status IN ('unknown', 'ok', 'error')),
        connection_message  text,
        models              jsonb NOT NULL DEFAULT '[]',       -- modelos de vídeo disponíveis p/ a chave
        settings            jsonb NOT NULL DEFAULT '{}',       -- configurações específicas do provedor
        last_validated_at   timestamptz,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ai_providers_account_idx ON ai_providers (account_id);
      CREATE UNIQUE INDEX ai_providers_one_default ON ai_providers (account_id) WHERE is_default;

      CREATE TABLE video_projects (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        product_id          text NOT NULL,                     -- item_id da Shopee
        product_snapshot    jsonb NOT NULL,
        provider_id         uuid REFERENCES ai_providers(id) ON DELETE SET NULL,
        provider_type       text NOT NULL,
        model               text NOT NULL,
        prompt              text NOT NULL CHECK (length(prompt) BETWEEN 10 AND 8000),
        options             jsonb NOT NULL DEFAULT '{}',       -- estilo, narração, idioma, resolução…
        status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN
                              ('PENDING','GENERATING','PROCESSING','GENERATED','PENDING_REVIEW','APPROVED','REJECTED','FAILED')),
        requested_duration  smallint NOT NULL CHECK (requested_duration BETWEEN 1 AND 60),
        requested_format    text NOT NULL CHECK (requested_format IN ('9:16','16:9','1:1')),
        idempotency_key     text NOT NULL,
        parent_project_id   uuid REFERENCES video_projects(id) ON DELETE SET NULL,
        version             smallint NOT NULL DEFAULT 1,
        provider_job_id     text,
        attempts            smallint NOT NULL DEFAULT 0,
        next_attempt_at     timestamptz NOT NULL DEFAULT now(),
        locked_until        timestamptz,
        error_message       text,
        created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now(),
        UNIQUE (account_id, idempotency_key)
      );
      CREATE INDEX video_projects_account_idx ON video_projects (account_id, created_at DESC);
      CREATE INDEX video_projects_product_idx ON video_projects (account_id, product_id);
      CREATE INDEX video_projects_queue_idx ON video_projects (next_attempt_at)
        WHERE status IN ('PENDING','GENERATING','PROCESSING');

      CREATE TABLE generated_videos (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id      uuid NOT NULL UNIQUE REFERENCES video_projects(id) ON DELETE CASCADE,
        account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        storage_path    text NOT NULL,
        thumbnail_path  text,
        duration        numeric(6,2),
        resolution      text,                                  -- ex.: 720x1280
        file_size       bigint NOT NULL CHECK (file_size > 0),
        mime_type       text NOT NULL DEFAULT 'video/mp4',
        status          text NOT NULL DEFAULT 'STORED' CHECK (status IN ('STORED','DELETED')),
        created_at      timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX generated_videos_account_idx ON generated_videos (account_id);

      CREATE TABLE video_reviews (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        video_id           uuid NOT NULL REFERENCES generated_videos(id) ON DELETE CASCADE,
        account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        reviewer_id        uuid REFERENCES users(id) ON DELETE SET NULL,
        visual_quality     smallint CHECK (visual_quality BETWEEN 1 AND 5),
        product_fidelity   smallint CHECK (product_fidelity BETWEEN 1 AND 5),
        message_quality    smallint CHECK (message_quality BETWEEN 1 AND 5),
        narration_quality  smallint CHECK (narration_quality BETWEEN 1 AND 5),
        subtitles_quality  smallint CHECK (subtitles_quality BETWEEN 1 AND 5),
        commercial_fit     smallint CHECK (commercial_fit BETWEEN 1 AND 5),
        comments           text NOT NULL DEFAULT '' CHECK (length(comments) <= 4000),
        decision           text NOT NULL CHECK (decision IN ('APPROVED','REJECTED','REVISION_REQUESTED')),
        created_at         timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX video_reviews_video_idx ON video_reviews (video_id, created_at DESC);

      -- Chamadas aos provedores e operações importantes (auditoria). project_id é opcional:
      -- operações em provedores (cadastro, troca de chave) também são registradas.
      CREATE TABLE video_generation_logs (
        id                 bigserial PRIMARY KEY,
        account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        project_id         uuid REFERENCES video_projects(id) ON DELETE SET NULL,
        provider           text,
        event              text NOT NULL,
        request_payload    jsonb,                              -- sem chaves de API e sem binários
        response_metadata  jsonb,
        error_message      text,
        execution_time     integer,                            -- ms
        created_at         timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX video_generation_logs_project_idx ON video_generation_logs (project_id, created_at DESC);
      CREATE INDEX video_generation_logs_account_idx ON video_generation_logs (account_id, created_at DESC);
    `,
  },
  {
    // Vídeos premium com a IA da PLATAFORMA (Google Gemini, custo do operador) além dos vídeos
    // com a chave do próprio cliente (xAI Grok). Cota mensal de vídeos premium por plano.
    id: '003_platform_videos',
    sql: `
      ALTER TABLE video_projects ADD COLUMN provider_source text NOT NULL DEFAULT 'account'
        CHECK (provider_source IN ('account', 'platform'));
      CREATE INDEX video_projects_platform_month_idx ON video_projects (account_id, created_at) WHERE provider_source = 'platform';

      ALTER TABLE plans ADD COLUMN premium_videos_month integer NOT NULL DEFAULT 0 CHECK (premium_videos_month BETWEEN 0 AND 1000);
      UPDATE plans SET premium_videos_month = CASE id WHEN 'start' THEN 2 WHEN 'pro' THEN 5 WHEN 'escala' THEN 15 ELSE 0 END;

      ALTER TABLE account_overrides ADD COLUMN premium_videos_month integer
        CHECK (premium_videos_month IS NULL OR premium_videos_month BETWEEN 0 AND 1000);
    `,
  },
];

const LOCK_ID = 727_001; // advisory lock exclusivo das migrations

export async function runMigrations(pool: Pool, list: Migration[] = MIGRATIONS): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id          text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set((await client.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map((r) => r.id));
    for (const m of list) {
      if (done.has(m.id)) continue;
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
        await client.query('COMMIT');
        applied.push(m.id);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${m.id} falhou: ${(err as Error).message}`);
      }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}
