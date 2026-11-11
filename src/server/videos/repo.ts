// Acesso a dados do módulo de vídeos. TODA função recebe accountId (vindo da sessão) e filtra
// por ele — nunca confia em ids vindos do navegador sem conferir a conta.
import { randomUUID } from 'node:crypto';
import { buildVideoPrompt } from '@/lib/video-prompt';
import {
  canTransition, CRITERIA, IN_PROGRESS, isReviewable, MAX_PRODUCTS_PER_REQUEST, NARRATIONS, originalPriceOf, STATUS_GROUPS,
  validateRequest, type Criterion, type Decision, type GenerationOptions, type ModelCapabilities, type ProductSnapshot,
  type StatusGroup, type VideoFormat, type VideoStatus,
} from '@/lib/videos';
import { decrypt, encrypt } from '@/server/crypto';
import { one, q, tx } from '@/server/db';
import { PLATFORM_LABEL, PLATFORM_PROVIDER_ID, PLATFORM_PROVIDER_TYPE, platformModel, platformStatus, premiumQuota } from './platform';
import { getProviderDefinition } from './providers';
import type { ConnectionResult } from './providers/types';

const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export const LIMITS = {
  daily: Number(process.env.VIDEO_DAILY_LIMIT || 20),        // gerações por conta em 24 h
  active: Number(process.env.VIDEO_MAX_ACTIVE || 5),         // em andamento ao mesmo tempo
};

export class VideoError extends Error {
  constructor(message: string, readonly field: string = 'form') {
    super(message);
  }
}

/* ================================================================== Logs / auditoria */
export async function logEvent(e: {
  accountId: string; projectId?: string | null; provider?: string | null; event: string;
  request?: unknown; response?: unknown; error?: string | null; ms?: number | null;
}) {
  await q(
    `INSERT INTO video_generation_logs (account_id, project_id, provider, event, request_payload, response_metadata, error_message, execution_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.accountId, e.projectId ?? null, e.provider ?? null, e.event,
      e.request === undefined ? null : JSON.stringify(e.request), e.response === undefined ? null : JSON.stringify(e.response),
      e.error ?? null, e.ms ?? null]
  );
}

/* ================================================================== Provedores */
export type ProviderView = {
  id: string; name: string; type: string; typeLabel: string; defaultModel: string | null; enabled: boolean; isDefault: boolean;
  status: 'unknown' | 'ok' | 'error'; message: string | null; models: ModelCapabilities[]; settings: Record<string, unknown>;
  keyHint: string; lastValidatedAt: string | null; createdAt: string; updatedAt: string;
};

const aad = (accountId: string, providerId: string) => `${accountId}:ai_provider:${providerId}`;
const keyHint = (key: string) => (key.length > 8 ? `••••${key.slice(-4)}` : '••••');

type ProviderRow = {
  id: string; account_id: string; name: string; provider_type: string; api_key_encrypted: string; api_key_hint: string; default_model: string | null;
  enabled: boolean; is_default: boolean; connection_status: ProviderView['status']; connection_message: string | null; models: ModelCapabilities[];
  settings: Record<string, unknown>; last_validated_at: Date | null; created_at: Date; updated_at: Date;
};

// A chave nunca sai desta função: a view não tem o campo.
function toView(r: ProviderRow): ProviderView {
  return {
    id: r.id, name: r.name, type: r.provider_type, typeLabel: getProviderDefinition(r.provider_type)?.label ?? r.provider_type,
    defaultModel: r.default_model, enabled: r.enabled, isDefault: r.is_default, status: r.connection_status, message: r.connection_message,
    models: Array.isArray(r.models) ? r.models : [], settings: r.settings ?? {}, keyHint: r.api_key_hint,
    lastValidatedAt: iso(r.last_validated_at), createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
  };
}

export async function listProviders(accountId: string): Promise<ProviderView[]> {
  const rows = await q<ProviderRow>('SELECT * FROM ai_providers WHERE account_id = $1 ORDER BY is_default DESC, created_at', [accountId]);
  return rows.map(toView);
}

export async function getProvider(accountId: string, id: string): Promise<ProviderView | null> {
  const r = await one<ProviderRow>('SELECT * FROM ai_providers WHERE account_id = $1 AND id = $2', [accountId, id]);
  return r ? toView(r) : null;
}

// Uso interno (servidor/worker): devolve a chave descriptografada.
export async function getProviderWithKey(accountId: string, id: string): Promise<(ProviderView & { apiKey: string }) | null> {
  const r = await one<ProviderRow>('SELECT * FROM ai_providers WHERE account_id = $1 AND id = $2', [accountId, id]);
  if (!r) return null;
  return { ...toView(r), apiKey: decrypt(r.api_key_encrypted, aad(accountId, r.id)) };
}

function checkKey(type: string, apiKey: string) {
  const def = getProviderDefinition(type);
  if (!def) throw new VideoError('Tipo de provedor inválido.', 'type');
  if (!def.clientConfigurable) throw new VideoError(`${def.label} é fornecido pela plataforma (vídeos premium) e não precisa de chave.`, 'type');
  const key = apiKey.trim();
  if (key.length < 10 || key.length > 300 || /\s/.test(key)) throw new VideoError('Chave de API inválida.', 'apiKey');
  if (def.keyPattern && !def.keyPattern.test(key)) throw new VideoError(`O formato não parece uma chave de ${def.label}.`, 'apiKey');
  return key;
}

export async function createProvider(accountId: string, input: { name: string; type: string; apiKey: string; settings?: Record<string, unknown> }) {
  const key = checkKey(input.type, input.apiKey);
  const name = input.name.trim() || getProviderDefinition(input.type)!.label;
  if (name.length > 60) throw new VideoError('Nome muito longo (máx. 60).', 'name');
  const id = randomUUID();
  await q(
    `INSERT INTO ai_providers (id, account_id, name, provider_type, api_key_encrypted, api_key_hint, settings, is_default)
     VALUES ($1,$2,$3,$4,$5,$6,$7, NOT EXISTS (SELECT 1 FROM ai_providers WHERE account_id = $2 AND is_default))`,
    [id, accountId, name, input.type, encrypt(key, aad(accountId, id)), keyHint(key), JSON.stringify(input.settings ?? {})]
  );
  await logEvent({ accountId, provider: input.type, event: 'provider.created', request: { providerId: id, name } });
  return id;
}

export async function updateProvider(accountId: string, id: string, input: { name?: string; apiKey?: string; defaultModel?: string | null; settings?: Record<string, unknown> }) {
  const cur = await getProvider(accountId, id);
  if (!cur) throw new VideoError('Provedor não encontrado.');
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [accountId, id];
  const add = (sql: string, v: unknown) => { params.push(v); sets.push(`${sql} = $${params.length}`); };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name || name.length > 60) throw new VideoError('Informe um nome de até 60 caracteres.', 'name');
    add('name', name);
  }
  if (input.apiKey && input.apiKey.trim()) {
    const key = checkKey(cur.type, input.apiKey);
    add('api_key_encrypted', encrypt(key, aad(accountId, id)));
    add('api_key_hint', keyHint(key));
    // chave nova: precisa validar de novo
    sets.push(`connection_status = 'unknown'`, 'connection_message = NULL', `models = '[]'`, 'last_validated_at = NULL');
  }
  if (input.defaultModel !== undefined) {
    if (input.defaultModel && !cur.models.some((m) => m.id === input.defaultModel)) throw new VideoError('Modelo indisponível. Teste a conexão para atualizar a lista.', 'defaultModel');
    add('default_model', input.defaultModel || null);
  }
  if (input.settings !== undefined) {
    // Mescla (não apaga chaves como paidPlanConfirmedAt); valor vazio remove a chave
    const set = Object.fromEntries(Object.entries(input.settings).filter(([, v]) => v !== undefined && v !== ''));
    const drop = Object.keys(input.settings).filter((k) => input.settings![k] === undefined || input.settings![k] === '');
    params.push(JSON.stringify(set), drop);
    sets.push(`settings = (settings - $${params.length}::text[]) || $${params.length - 1}::jsonb`);
  }
  await q(`UPDATE ai_providers SET ${sets.join(', ')} WHERE account_id = $1 AND id = $2`, params);
  await logEvent({ accountId, provider: cur.type, event: input.apiKey ? 'provider.key_replaced' : 'provider.updated', request: { providerId: id } });
}

export async function saveValidation(accountId: string, id: string, result: ConnectionResult) {
  await q(
    `UPDATE ai_providers SET connection_status = $3, connection_message = $4, models = $5, last_validated_at = now(), updated_at = now(),
       default_model = CASE WHEN default_model IS NOT NULL AND $5::jsonb @> jsonb_build_array(jsonb_build_object('id', default_model)) THEN default_model
                            ELSE $5::jsonb->0->>'id' END
     WHERE account_id = $1 AND id = $2`,
    [accountId, id, result.ok ? 'ok' : 'error', result.message.slice(0, 500), JSON.stringify(result.models)]
  );
}

export async function setDefaultProvider(accountId: string, id: string) {
  await tx(async (c) => {
    const r = await c.query<{ id: string }>('SELECT id FROM ai_providers WHERE account_id = $1 AND id = $2 AND enabled', [accountId, id]);
    if (!r.length) throw new VideoError('Só um provedor ativo pode ser o padrão.');
    await c.query('UPDATE ai_providers SET is_default = false WHERE account_id = $1 AND is_default', [accountId]);
    await c.query('UPDATE ai_providers SET is_default = true, updated_at = now() WHERE account_id = $1 AND id = $2', [accountId, id]);
  });
}

export async function setProviderEnabled(accountId: string, id: string, enabled: boolean) {
  await q(`UPDATE ai_providers SET enabled = $3, is_default = is_default AND $3, updated_at = now() WHERE account_id = $1 AND id = $2`, [accountId, id, enabled]);
  await logEvent({ accountId, event: enabled ? 'provider.enabled' : 'provider.disabled', request: { providerId: id } });
}

export async function deleteProvider(accountId: string, id: string) {
  const busy = await one<{ c: string }>(`SELECT count(*) AS c FROM video_projects WHERE account_id = $1 AND provider_id = $2 AND status IN ('PENDING','GENERATING','PROCESSING')`, [accountId, id]);
  if (Number(busy?.c) > 0) throw new VideoError('Há vídeos em geração com este provedor. Aguarde terminarem.');
  const r = await one<{ provider_type: string }>('DELETE FROM ai_providers WHERE account_id = $1 AND id = $2 RETURNING provider_type', [accountId, id]);
  if (r) await logEvent({ accountId, provider: r.provider_type, event: 'provider.deleted', request: { providerId: id } });
}

/* ================================================================== Produtos (Histórico de Ofertas) */
export type ProductRow = ProductSnapshot & { lastSentAt: string; videos: number };

const productSelect = `
  WITH latest AS (
    SELECT DISTINCT ON (d.item_id)
           d.item_id, d.product_name, d.price, d.image_url, d.affiliate_link, d.product_link, d.shop_name, d.created_at, r.keyword,
           (SELECT d2.discount_rate FROM deliveries d2 WHERE d2.account_id = d.account_id AND d2.item_id = d.item_id AND d2.discount_rate IS NOT NULL
            ORDER BY d2.created_at DESC LIMIT 1) AS discount_rate
    FROM deliveries d LEFT JOIN runs r ON r.id = d.run_id
    WHERE d.account_id = $1
    ORDER BY d.item_id, d.created_at DESC
  )`;

function toProduct(r: Record<string, unknown>): ProductRow {
  const price = n(r.price);
  const discountRate = n(r.discount_rate);
  return {
    itemId: String(r.item_id), name: String(r.product_name ?? ''), imageUrl: (r.image_url as string) || null,
    price, discountRate, originalPrice: originalPriceOf(price, discountRate),
    category: (r.keyword as string) || null, productLink: (r.product_link as string) || null, affiliateLink: (r.affiliate_link as string) || null,
    shopName: (r.shop_name as string) || null, description: null,
    lastSentAt: iso(r.created_at)!, videos: Number(r.videos ?? 0),
  };
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
export const PRODUCTS_PER_PAGE = 12;

export async function listProducts(accountId: string, f: { search?: string; category?: string; page?: number }) {
  const search = (f.search ?? '').trim().slice(0, 100);
  const category = (f.category ?? '').trim().slice(0, 100);
  const params = [accountId, search ? `%${likeEscape(search)}%` : '', category];
  const where = `WHERE ($2 = '' OR l.product_name ILIKE $2) AND ($3 = '' OR l.keyword = $3)`;
  const total = Number((await one<{ c: string }>(`${productSelect} SELECT count(*) AS c FROM latest l ${where}`, params))?.c ?? 0);
  const pages = Math.max(1, Math.ceil(total / PRODUCTS_PER_PAGE));
  const page = Math.min(Math.max(1, Math.floor(f.page ?? 1) || 1), pages);
  const rows = await q(
    `${productSelect}
     SELECT l.*, (SELECT count(*) FROM video_projects vp WHERE vp.account_id = $1 AND vp.product_id = l.item_id) AS videos
     FROM latest l ${where} ORDER BY l.created_at DESC LIMIT ${PRODUCTS_PER_PAGE} OFFSET ${(page - 1) * PRODUCTS_PER_PAGE}`,
    params
  );
  return { items: rows.map(toProduct), total, page, pages };
}

export async function getProducts(accountId: string, itemIds: string[]): Promise<ProductRow[]> {
  if (!itemIds.length) return [];
  const rows = await q(`${productSelect} SELECT l.*, 0 AS videos FROM latest l WHERE l.item_id = ANY($2::text[])`, [accountId, itemIds]);
  return rows.map(toProduct);
}

export async function listCategories(accountId: string): Promise<string[]> {
  const rows = await q<{ keyword: string }>(
    `SELECT DISTINCT r.keyword FROM deliveries d JOIN runs r ON r.id = d.run_id WHERE d.account_id = $1 AND r.keyword IS NOT NULL ORDER BY r.keyword`,
    [accountId]
  );
  return rows.map((r) => r.keyword);
}

/* ================================================================== Criação de projetos */
export type CreateInput = {
  providerId: string; model: string; format: VideoFormat; duration: number; options: GenerationOptions;
  items: { productId: string; prompt: string }[];
  requestKey: string;                 // gerado pelo navegador por envio: repetir o envio não duplica
  parentProjectId?: string | null;
};

export async function createProjects(accountId: string, userId: string | null, input: CreateInput): Promise<{ ids: string[]; created: number; createdIds: string[] }> {
  if (!/^[A-Za-z0-9-]{16,64}$/.test(input.requestKey)) throw new VideoError('Requisição inválida. Recarregue a página.');
  if (!input.items.length) throw new VideoError('Selecione ao menos um produto.', 'products');
  if (input.items.length > MAX_PRODUCTS_PER_REQUEST) throw new VideoError(`Selecione no máximo ${MAX_PRODUCTS_PER_REQUEST} produtos por vez.`, 'products');
  if (new Set(input.items.map((i) => i.productId)).size !== input.items.length) throw new VideoError('Produto repetido na seleção.', 'products');

  // Origem: IA da plataforma (premium, custo do operador) ou chave do próprio cliente (econômico)
  const platform = input.providerId === PLATFORM_PROVIDER_ID;
  let provider: { id: string | null; type: string; source: 'platform' | 'account' };
  let caps: ModelCapabilities | undefined;
  if (platform) {
    const st = await platformStatus();
    if (!st.ok) throw new VideoError(st.message, 'provider');
    caps = platformModel() ?? undefined;
    if (caps && caps.id !== input.model) caps = undefined;
    provider = { id: null, type: PLATFORM_PROVIDER_TYPE, source: 'platform' };
  } else {
    const p = await getProvider(accountId, input.providerId);
    if (!p) throw new VideoError('Provedor não encontrado.', 'provider');
    if (!p.enabled) throw new VideoError('Este provedor está desativado.', 'provider');
    if (p.status !== 'ok') throw new VideoError('Teste a conexão do provedor antes de gerar.', 'provider');
    caps = p.models.find((m) => m.id === input.model);
    provider = { id: p.id, type: p.type, source: 'account' };
  }
  const issues = validateRequest(caps, { duration: input.duration, format: input.format, narration: input.options.narration, resolution: input.options.resolution });
  if (issues.length) throw new VideoError(issues[0].message, issues[0].field);

  const products = new Map((await getProducts(accountId, input.items.map((i) => i.productId))).map((p) => [p.itemId, p]));
  for (const it of input.items) {
    if (!products.has(it.productId)) throw new VideoError('Produto não encontrado no Histórico de Ofertas.', 'products');
    const len = it.prompt.trim().length;
    if (len < 10 || len > 8000) throw new VideoError('O prompt deve ter entre 10 e 8000 caracteres.', 'prompt');
  }

  return tx(async (c) => {
    // Serializa as criações da conta: os limites abaixo não podem ser furados por envios simultâneos
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`videos:${accountId}`]);
    const keys = input.items.map((it) => `${input.requestKey}:${it.productId}`);
    const existing = await c.query<{ id: string; idempotency_key: string }>(
      'SELECT id, idempotency_key FROM video_projects WHERE account_id = $1 AND idempotency_key = ANY($2::text[])', [accountId, keys]
    );
    const done = new Map(existing.map((r) => [r.idempotency_key, r.id]));
    const toCreate = input.items.filter((_, i) => !done.has(keys[i]));
    if (toCreate.length) {
      const [{ day, active }] = await c.query<{ day: string; active: string }>(
        `SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS day,
                count(*) FILTER (WHERE status IN ('PENDING','GENERATING','PROCESSING')) AS active
         FROM video_projects WHERE account_id = $1`, [accountId]
      );
      if (Number(day) + toCreate.length > LIMITS.daily) {
        throw new VideoError(`Limite de ${LIMITS.daily} vídeos em 24 horas. Restam ${Math.max(0, LIMITS.daily - Number(day))}.`, 'products');
      }
      if (Number(active) + toCreate.length > LIMITS.active) {
        throw new VideoError(`No máximo ${LIMITS.active} vídeos em geração ao mesmo tempo. Aguarde os atuais terminarem.`, 'products');
      }
      if (platform) {
        // dentro da trava da conta: envios simultâneos não furam a cota
        const quota = await premiumQuota(accountId);
        if (toCreate.length > quota.remaining) {
          throw new VideoError(quota.limit === 0
            ? 'Seu plano não inclui vídeos premium. Use a opção econômica (Grok) ou fale com o suporte.'
            : `Cota de vídeos premium do mês: ${quota.used} de ${quota.limit} usados. Restam ${quota.remaining}.`, 'products');
        }
      }
    }
    let version = 1;
    if (input.parentProjectId) {
      const p = await c.query<{ version: number }>('SELECT version FROM video_projects WHERE account_id = $1 AND id = $2', [accountId, input.parentProjectId]);
      if (!p.length) throw new VideoError('Vídeo de origem não encontrado.');
      version = p[0].version + 1;
    }
    const ids: string[] = [];
    const createdIds: string[] = [];
    for (const [i, it] of input.items.entries()) {
      const prev = done.get(keys[i]);
      if (prev) { ids.push(prev); continue; }
      const r = await c.query<{ id: string }>(
        `INSERT INTO video_projects (account_id, product_id, product_snapshot, provider_id, provider_type, provider_source, model, prompt, options,
                                     requested_duration, requested_format, idempotency_key, parent_project_id, version, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (account_id, idempotency_key) DO NOTHING RETURNING id`,
        [accountId, it.productId, JSON.stringify(products.get(it.productId)), provider.id, provider.type, provider.source, input.model, it.prompt.trim(),
          JSON.stringify(input.options), input.duration, input.format, keys[i], input.parentProjectId ?? null, version, userId]
      );
      if (r[0]) { ids.push(r[0].id); createdIds.push(r[0].id); }
    }
    return { ids, created: createdIds.length, createdIds };
  }).then(async (out) => {
    for (const id of out.createdIds) {
      await logEvent({ accountId, projectId: id, provider: provider.type, event: 'project.created', request: { model: input.model, format: input.format, duration: input.duration } });
    }
    return out;
  });
}

/* ================================================================== Consultas: galeria, detalhe, painel */
export type ProjectView = {
  id: string; productId: string; product: ProductSnapshot; providerId: string | null; source: 'platform' | 'account'; providerType: string; providerLabel: string; model: string;
  prompt: string; options: GenerationOptions; status: VideoStatus; duration: number; format: VideoFormat; version: number; parentProjectId: string | null;
  attempts: number; errorMessage: string | null; createdAt: string; updatedAt: string;
  video: { id: string; storagePath: string; thumbnailPath: string | null; duration: number | null; resolution: string | null; fileSize: number } | null;
  lastReview: { decision: Decision; createdAt: string } | null;
};

function toProject(r: Record<string, unknown>): ProjectView {
  return {
    id: String(r.id), productId: String(r.product_id), product: r.product_snapshot as ProductSnapshot, providerId: (r.provider_id as string) ?? null,
    source: r.provider_source === 'platform' ? 'platform' : 'account', providerType: String(r.provider_type),
    providerLabel: r.provider_source === 'platform' ? PLATFORM_LABEL : getProviderDefinition(String(r.provider_type))?.label ?? String(r.provider_type),
    model: String(r.model), prompt: String(r.prompt), options: r.options as GenerationOptions, status: r.status as VideoStatus,
    duration: Number(r.requested_duration), format: r.requested_format as VideoFormat, version: Number(r.version),
    parentProjectId: (r.parent_project_id as string) ?? null, attempts: Number(r.attempts), errorMessage: (r.error_message as string) ?? null,
    createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
    video: r.video_id ? {
      id: String(r.video_id), storagePath: String(r.storage_path), thumbnailPath: (r.thumbnail_path as string) ?? null,
      duration: n(r.video_duration), resolution: (r.resolution as string) ?? null, fileSize: Number(r.file_size),
    } : null,
    lastReview: r.last_decision ? { decision: r.last_decision as Decision, createdAt: iso(r.last_review_at)! } : null,
  };
}

const projectSelect = `
  SELECT p.*, v.id AS video_id, v.storage_path, v.thumbnail_path, v.duration AS video_duration, v.resolution, v.file_size,
         lr.decision AS last_decision, lr.created_at AS last_review_at
  FROM video_projects p
  LEFT JOIN generated_videos v ON v.project_id = p.id AND v.status = 'STORED'
  LEFT JOIN LATERAL (SELECT decision, created_at FROM video_reviews rv WHERE rv.video_id = v.id ORDER BY created_at DESC LIMIT 1) lr ON true`;

export type ProjectFilters = { period?: string; productId?: string; category?: string; provider?: string; group?: StatusGroup; page?: number };
export const PERIODS = { '7d': { label: 'Últimos 7 dias', days: 7 }, '30d': { label: 'Últimos 30 dias', days: 30 }, '90d': { label: 'Últimos 90 dias', days: 90 }, all: { label: 'Todo o período', days: 0 } } as const;
export type PeriodKey = keyof typeof PERIODS;
export const periodKey = (v: unknown): PeriodKey => (typeof v === 'string' && v in PERIODS ? (v as PeriodKey) : '30d');

function filterSql(f: ProjectFilters, params: unknown[]) {
  const where = ['p.account_id = $1'];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  const days = PERIODS[periodKey(f.period)].days;
  if (days) add(`p.created_at > now() - (? * interval '1 day')`, days);
  if (f.productId) add('p.product_id = ?', f.productId);
  if (f.category) add(`p.product_snapshot->>'category' = ?`, f.category);
  if (f.provider) add('p.provider_type = ?', f.provider);
  if (f.group && f.group !== 'all') add('p.status = ANY(?::text[])', [...STATUS_GROUPS[f.group].statuses]);
  return where.join(' AND ');
}

export const GALLERY_PER_PAGE = 12;

export async function listProjects(accountId: string, f: ProjectFilters) {
  const params: unknown[] = [accountId];
  const where = filterSql(f, params);
  const total = Number((await one<{ c: string }>(`SELECT count(*) AS c FROM video_projects p WHERE ${where}`, params))?.c ?? 0);
  const pages = Math.max(1, Math.ceil(total / GALLERY_PER_PAGE));
  const page = Math.min(Math.max(1, Math.floor(f.page ?? 1) || 1), pages);
  const rows = await q(`${projectSelect} WHERE ${where} ORDER BY p.created_at DESC LIMIT ${GALLERY_PER_PAGE} OFFSET ${(page - 1) * GALLERY_PER_PAGE}`, params);
  return { items: rows.map(toProject), total, page, pages };
}

export async function getProject(accountId: string, id: string): Promise<ProjectView | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const r = await one(`${projectSelect} WHERE p.account_id = $1 AND p.id = $2`, [accountId, id]);
  return r ? toProject(r) : null;
}

export async function dashboard(accountId: string, f: ProjectFilters) {
  const params: unknown[] = [accountId];
  const where = filterSql({ ...f, group: f.group }, params);
  const k = await one<Record<string, string>>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE p.status IN ('PENDING','GENERATING','PROCESSING','GENERATED')) AS processing,
            count(*) FILTER (WHERE p.status = 'PENDING_REVIEW') AS review,
            count(*) FILTER (WHERE p.status = 'APPROVED') AS approved,
            count(*) FILTER (WHERE p.status = 'REJECTED') AS rejected,
            count(*) FILTER (WHERE p.status = 'FAILED') AS failed,
            count(DISTINCT p.product_id) AS products
     FROM video_projects p WHERE ${where}`, params
  );
  const recent = await q(`${projectSelect} WHERE ${where} ORDER BY p.updated_at DESC LIMIT 8`, params);
  const used = await one<{ c: string }>(`SELECT count(*) AS c FROM video_projects WHERE account_id = $1 AND created_at > now() - interval '24 hours'`, [accountId]);
  return {
    kpis: {
      total: Number(k?.total ?? 0), processing: Number(k?.processing ?? 0), review: Number(k?.review ?? 0), approved: Number(k?.approved ?? 0),
      rejected: Number(k?.rejected ?? 0), failed: Number(k?.failed ?? 0), products: Number(k?.products ?? 0),
    },
    recent: recent.map(toProject),
    usage: { last24h: Number(used?.c ?? 0), dailyLimit: LIMITS.daily },
  };
}

export async function filterOptions(accountId: string) {
  const [products, categories, providers] = await Promise.all([
    q<{ product_id: string; name: string }>(
      `SELECT DISTINCT ON (product_id) product_id, product_snapshot->>'name' AS name FROM video_projects WHERE account_id = $1 ORDER BY product_id, created_at DESC`, [accountId]),
    q<{ c: string }>(`SELECT DISTINCT product_snapshot->>'category' AS c FROM video_projects WHERE account_id = $1 AND product_snapshot->>'category' IS NOT NULL ORDER BY 1`, [accountId]),
    q<{ t: string }>(`SELECT DISTINCT provider_type AS t FROM video_projects WHERE account_id = $1 ORDER BY 1`, [accountId]),
  ]);
  return {
    products: products.map((p) => ({ id: p.product_id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    categories: categories.map((c) => c.c),
    providers: providers.map((p) => ({ type: p.t, label: getProviderDefinition(p.t)?.label ?? p.t })),
  };
}

export type ReviewView = {
  id: string; reviewer: string | null; decision: Decision; comments: string; createdAt: string; ratings: Partial<Record<Criterion, number>>;
};

export async function listReviews(accountId: string, projectId: string): Promise<ReviewView[]> {
  const rows = await q(
    `SELECT rv.*, u.name AS reviewer FROM video_reviews rv JOIN generated_videos v ON v.id = rv.video_id
     LEFT JOIN users u ON u.id = rv.reviewer_id
     WHERE rv.account_id = $1 AND v.project_id = $2 ORDER BY rv.created_at DESC`, [accountId, projectId]
  );
  return rows.map((r) => ({
    id: String(r.id), reviewer: (r.reviewer as string) ?? null, decision: r.decision as Decision, comments: String(r.comments ?? ''), createdAt: iso(r.created_at)!,
    ratings: Object.fromEntries((Object.keys(CRITERIA) as Criterion[]).filter((c) => r[c] !== null).map((c) => [c, Number(r[c])])),
  }));
}

export async function listLogs(accountId: string, projectId: string) {
  const rows = await q(
    `SELECT id, provider, event, request_payload, response_metadata, error_message, execution_time, created_at
     FROM video_generation_logs WHERE account_id = $1 AND project_id = $2 ORDER BY created_at DESC LIMIT 50`, [accountId, projectId]
  );
  return rows.map((r) => ({
    id: Number(r.id), provider: (r.provider as string) ?? null, event: String(r.event), request: r.request_payload, response: r.response_metadata,
    error: (r.error_message as string) ?? null, ms: n(r.execution_time), createdAt: iso(r.created_at)!,
  }));
}

/* ================================================================== Avaliação */
export async function addReview(
  accountId: string, userId: string,
  input: { projectId: string; decision: Decision; comments: string; ratings: Partial<Record<Criterion, number>> }
): Promise<{ newProjectId: string | null }> {
  const comments = input.comments.trim();
  if (comments.length > 4000) throw new VideoError('Observações muito longas (máx. 4000).', 'comments');
  for (const [c, v] of Object.entries(input.ratings)) {
    if (!(c in CRITERIA) || !Number.isInteger(v) || v! < 1 || v! > 5) throw new VideoError('Notas de 1 a 5.', c);
  }
  if (input.decision === 'REVISION_REQUESTED' && !comments) throw new VideoError('Descreva o que deve mudar na nova versão.', 'comments');

  const project = await getProject(accountId, input.projectId);
  if (!project) throw new VideoError('Vídeo não encontrado.');
  if (!project.video || !isReviewable(project.status)) throw new VideoError('O vídeo só pode ser avaliado depois de gerado e armazenado.');
  const target: VideoStatus = input.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';

  await tx(async (c) => {
    const ratings = input.ratings;
    await c.query(
      `INSERT INTO video_reviews (video_id, account_id, reviewer_id, visual_quality, product_fidelity, message_quality, narration_quality,
                                  subtitles_quality, commercial_fit, comments, decision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [project.video!.id, accountId, userId, ratings.visual_quality ?? null, ratings.product_fidelity ?? null, ratings.message_quality ?? null,
        ratings.narration_quality ?? null, ratings.subtitles_quality ?? null, ratings.commercial_fit ?? null, comments, input.decision]
    );
    if (project.status !== target) {
      if (!canTransition(project.status, target)) throw new VideoError(`Não é possível mudar de ${project.status} para ${target}.`);
      const r = await c.query(`UPDATE video_projects SET status = $3, updated_at = now() WHERE account_id = $1 AND id = $2 AND status = $4 RETURNING id`,
        [accountId, project.id, target, project.status]);
      if (!r.length) throw new VideoError('O vídeo mudou enquanto você avaliava. Recarregue a página.');
    }
  });
  await logEvent({ accountId, projectId: project.id, provider: project.providerType, event: `review.${input.decision.toLowerCase()}`, request: { ratings: input.ratings } });

  if (input.decision !== 'REVISION_REQUESTED') return { newProjectId: null };
  const next = await newVersion(accountId, userId, project.id, comments);
  return { newProjectId: next };
}

// Nova versão: mesmos parâmetros; com ajustes, acrescenta-os ao prompt.
export async function newVersion(accountId: string, userId: string, projectId: string, adjustments = '', requestKey?: string): Promise<string> {
  const p = await getProject(accountId, projectId);
  if (!p) throw new VideoError('Vídeo não encontrado.');
  const providerId = p.source === 'platform' ? PLATFORM_PROVIDER_ID : p.providerId;
  if (!providerId) throw new VideoError('O provedor usado foi removido. Gere um vídeo novo pela tela "Gerar vídeos".');
  // Retrato atualizado do produto (preço pode ter mudado); se saiu do histórico, mantém o anterior
  const fresh = (await getProducts(accountId, [p.productId]))[0];
  const base = fresh ? buildVideoPrompt(fresh, p.options, p.format, p.duration) : null;
  const prompt = (base && p.prompt === buildVideoPrompt(p.product, p.options, p.format, p.duration) ? base : p.prompt)
    + (adjustments ? `\n\nAjustes solicitados na avaliação anterior:\n${adjustments}` : '');
  const out = await createProjects(accountId, userId, {
    providerId, model: p.model, format: p.format, duration: p.duration, options: p.options,
    items: [{ productId: p.productId, prompt: prompt.slice(0, 8000) }],
    requestKey: requestKey ?? `v${p.version + 1}-${p.id}`, parentProjectId: p.id,
  });
  return out.ids[0];
}

/* ================================================================== Exclusão */
export async function deleteProject(accountId: string, projectId: string, removeObject: (key: string) => Promise<void>) {
  const p = await getProject(accountId, projectId);
  if (!p) throw new VideoError('Vídeo não encontrado.');
  if ((IN_PROGRESS as readonly string[]).includes(p.status) && p.status !== 'GENERATED') {
    throw new VideoError('Aguarde a geração terminar para excluir.');
  }
  // Arquivos primeiro: se falhar, o registro continua e a exclusão pode ser repetida
  if (p.video) {
    await removeObject(p.video.storagePath);
    if (p.video.thumbnailPath) await removeObject(p.video.thumbnailPath);
  }
  await q('DELETE FROM video_projects WHERE account_id = $1 AND id = $2', [accountId, projectId]);
  await logEvent({ accountId, provider: p.providerType, event: 'project.deleted', request: { projectId, productId: p.productId, product: p.product.name } });
}

export const needsAudio = (o: GenerationOptions) => NARRATIONS[o.narration].needsAudio;
