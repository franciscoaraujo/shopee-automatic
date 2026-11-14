// Métricas do painel do cliente — todas as consultas filtradas por account_id.
import { FAILURE_STREAK, isFailingStreak } from '@/lib/health';
import { one, q } from './db';

export const RANGES = {
  '24h': { label: 'Últimas 24 horas', interval: '24 hours', unit: 'hour', buckets: 24 },
  '7d': { label: 'Últimos 7 dias', interval: '7 days', unit: 'day', buckets: 7 },
  '30d': { label: 'Últimos 30 dias', interval: '30 days', unit: 'day', buckets: 30 },
} as const;
export type RangeKey = keyof typeof RANGES;
export const rangeKey = (v: unknown): RangeKey => (typeof v === 'string' && v in RANGES ? (v as RangeKey) : '24h');

const TZ = 'America/Sao_Paulo';
const n = (v: unknown) => Number(v) || 0;

export type Summary = Awaited<ReturnType<typeof summary>>;

export async function summary(accountId: string, key: RangeKey) {
  const r = RANGES[key];
  const [kpi, prev, runs, series, recentRuns] = await Promise.all([
    one(
      `SELECT count(DISTINCT item_id) FILTER (WHERE success)                 AS published,
              count(*) FILTER (WHERE success AND channel = 'telegram')       AS tg_ok,
              count(*) FILTER (WHERE channel = 'telegram')                   AS tg_total,
              count(*) FILTER (WHERE success AND channel = 'whatsapp')       AS wa_ok,
              count(*) FILTER (WHERE channel = 'whatsapp')                   AS wa_total,
              count(*) FILTER (WHERE NOT success)                            AS failures
       FROM deliveries WHERE account_id = $1 AND created_at > now() - $2::interval`,
      [accountId, r.interval]
    ),
    one(
      `WITH pub AS (
         SELECT item_id, max(commission) AS commission, bool_or(created_at > now() - $2::interval) AS current
         FROM deliveries
         WHERE account_id = $1 AND success AND created_at > now() - 2 * $2::interval
         GROUP BY item_id, (created_at > now() - $2::interval)
       )
       SELECT count(*) FILTER (WHERE NOT current)                     AS published_prev,
              coalesce(sum(commission) FILTER (WHERE current), 0)     AS commission_cur,
              coalesce(sum(commission) FILTER (WHERE NOT current), 0) AS commission_prev
       FROM pub`,
      [accountId, r.interval]
    ),
    one(
      `SELECT count(*) AS runs, count(*) FILTER (WHERE error IS NOT NULL) AS run_errors,
              coalesce(sum(found), 0) AS found, max(created_at) AS last_run_at
       FROM runs WHERE account_id = $1 AND created_at > now() - $2::interval`,
      [accountId, r.interval]
    ),
    q(
      `SELECT to_char(b, 'YYYY-MM-DD"T"HH24:MI') AS bucket,
              count(d.id) FILTER (WHERE d.channel = 'whatsapp' AND d.success) AS whatsapp,
              count(d.id) FILTER (WHERE d.channel = 'telegram' AND d.success) AS telegram,
              count(d.id) FILTER (WHERE NOT d.success)                        AS failures
       FROM generate_series(
              date_trunc($3::text, now() AT TIME ZONE $4::text) - ($5::int - 1) * ('1 ' || $3::text)::interval,
              date_trunc($3::text, now() AT TIME ZONE $4::text),
              ('1 ' || $3::text)::interval) AS b
       LEFT JOIN deliveries d
         ON d.account_id = $1 AND d.created_at > now() - $2::interval
        AND date_trunc($3::text, d.created_at AT TIME ZONE $4::text) = b
       GROUP BY b ORDER BY b`,
      [accountId, r.interval, r.unit, TZ, r.buckets]
    ),
    q(
      `SELECT id, created_at, trigger, keyword, found, selected, error, duration_ms,
              (SELECT count(DISTINCT item_id) FROM deliveries d WHERE d.run_id = runs.id AND d.success) AS published
       FROM runs WHERE account_id = $1 ORDER BY created_at DESC LIMIT 8`,
      [accountId]
    ),
  ]);

  return {
    range: key,
    unit: r.unit as 'hour' | 'day',
    kpis: {
      published: n(kpi?.published),
      publishedPrev: n(prev?.published_prev),
      commission: n(prev?.commission_cur),
      commissionPrev: n(prev?.commission_prev),
      failures: n(kpi?.failures),
      channels: {
        whatsapp: { ok: n(kpi?.wa_ok), total: n(kpi?.wa_total) },
        telegram: { ok: n(kpi?.tg_ok), total: n(kpi?.tg_total) },
      },
      runs: n(runs?.runs),
      runErrors: n(runs?.run_errors),
      found: n(runs?.found),
      lastRunAt: runs?.last_run_at ? new Date(runs.last_run_at).toISOString() : null,
    },
    series: series.map((s) => ({ bucket: String(s.bucket), whatsapp: n(s.whatsapp), telegram: n(s.telegram), failures: n(s.failures) })),
    runs: recentRuns.map((r) => ({
      id: Number(r.id), at: new Date(r.created_at).toISOString(), trigger: String(r.trigger), keyword: r.keyword ? String(r.keyword) : null,
      found: n(r.found), selected: n(r.selected), published: n(r.published), error: r.error ? String(r.error) : null, durationMs: n(r.duration_ms),
    })),
  };
}

// Falhas seguidas nas últimas 24 h (busca na Shopee e envio por canal). O detalhe técnico dos
// erros fica só no /admin; o cliente vê um aviso simples quando a falha persiste.
export async function failureStreaks(accountId: string) {
  const [runs, deliveries] = await Promise.all([
    q<{ ok: boolean }>(
      `SELECT error IS NULL AS ok FROM runs
       WHERE account_id = $1 AND created_at > now() - interval '24 hours'
       ORDER BY created_at DESC LIMIT $2`,
      [accountId, FAILURE_STREAK]
    ),
    q<{ channel: string; ok: boolean }>(
      `SELECT channel, ok FROM (
         SELECT channel, success AS ok, row_number() OVER (PARTITION BY channel ORDER BY created_at DESC) AS rn
         FROM deliveries WHERE account_id = $1 AND created_at > now() - interval '24 hours'
       ) d WHERE rn <= $2 ORDER BY channel, rn`,
      [accountId, FAILURE_STREAK]
    ),
  ]);
  const channel = (c: string) => isFailingStreak(deliveries.filter((d) => d.channel === c).map((d) => d.ok));
  return { shopee: isFailingStreak(runs.map((r) => r.ok)), whatsapp: channel('whatsapp'), telegram: channel('telegram') };
}

export async function workerHealth() {
  const row = await one<{ updated_at: Date }>(`SELECT updated_at FROM system_kv WHERE key = 'worker_heartbeat'`);
  if (!row) return { ok: false, lastSeen: null as string | null };
  const age = Date.now() - new Date(row.updated_at).getTime();
  return { ok: age < 2 * 60_000, lastSeen: new Date(row.updated_at).toISOString() };
}

export const OFFERS_PER_PAGE = 10;

export type OfferRow = {
  key: string; itemId: string; productName: string; price: number; commissionRate: number; commission: number;
  link: string | null; imageUrl: string | null; sentAt: string; keyword: string | null;
  whatsapp: boolean | null; telegram: boolean | null;
};

// Histórico completo de publicações (uma linha por produto em cada rodada), paginado
export async function offersHistory(accountId: string, page: number) {
  const totalRow = await one<{ total: string }>(
    `SELECT count(*) AS total FROM (SELECT 1 FROM deliveries WHERE account_id = $1 GROUP BY run_id, item_id) x`,
    [accountId]
  );
  const total = Number(totalRow?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / OFFERS_PER_PAGE));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const rows = await q(
    `SELECT d.run_id, d.item_id, max(d.product_name) AS product_name, max(d.price) AS price,
            max(d.commission_rate) AS commission_rate, max(d.commission) AS commission,
            max(d.affiliate_link) AS affiliate_link, max(d.image_url) AS image_url,
            max(d.created_at) AS sent_at, max(r.keyword) AS keyword,
            bool_or(d.success) FILTER (WHERE d.channel = 'whatsapp') AS whatsapp,
            bool_or(d.success) FILTER (WHERE d.channel = 'telegram') AS telegram
     FROM deliveries d LEFT JOIN runs r ON r.id = d.run_id
     WHERE d.account_id = $1
     GROUP BY d.run_id, d.item_id
     ORDER BY max(d.created_at) DESC, d.item_id
     LIMIT $2 OFFSET $3`,
    [accountId, OFFERS_PER_PAGE, (current - 1) * OFFERS_PER_PAGE]
  );
  const items: OfferRow[] = rows.map((o) => ({
    key: `${o.run_id}:${o.item_id}`,
    itemId: String(o.item_id),
    productName: String(o.product_name ?? ''),
    price: n(o.price),
    commissionRate: n(o.commission_rate),
    commission: n(o.commission),
    link: o.affiliate_link ? String(o.affiliate_link) : null,
    imageUrl: o.image_url ? String(o.image_url) : null,
    sentAt: new Date(o.sent_at).toISOString(),
    keyword: o.keyword ? String(o.keyword) : null,
    whatsapp: o.whatsapp as boolean | null,
    telegram: o.telegram as boolean | null,
  }));
  return { items, total, page: current, pages, perPage: OFFERS_PER_PAGE };
}
