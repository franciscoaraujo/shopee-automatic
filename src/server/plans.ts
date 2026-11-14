// Planos, promoções e limites por cliente, lidos do banco (tabelas plans, promotions,
// account_overrides). Quem edita é o painel administrativo; aqui só se lê e se aplica.
//
// Cache em memória por processo (padrão 30 s, PLANS_CACHE_MS): uma alteração no painel
// chega ao site, ao painel do cliente e ao worker em até 30 s, sem reiniciar nada.
// Se o banco falhar, valem os planos padrão do código (o site não cai).
import {
  DEFAULT_PLANS, MAX_PER_RUN, MAX_WA_GROUPS, TRIAL_PLAN, bestOffer, discounted, findPlan, formatPrice,
  type Plan, type Promotion, type SchedulePolicy,
} from '@/lib/plans';
import { one, q, type tx } from './db';

type Catalog = { plans: Plan[]; promos: Promotion[]; fallback: boolean };

const TTL = Number(process.env.PLANS_CACHE_MS || 30_000);
const g = globalThis as unknown as { __catalog?: { at: number; ttl: number; data: Promise<Catalog> } };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = /^[0-6](,[0-6])*$/;

// O painel administrativo é outro sistema: tudo que vem do banco é validado de novo aqui.
function parseSchedule(raw: unknown, planId: string): SchedulePolicy {
  const s = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, string> | null;
  if (s?.mode === 'full') return { mode: 'full' };
  if (s?.mode === 'fixed' && TIME.test(s.start) && TIME.test(s.end) && s.start !== s.end && DAYS.test(String(s.days ?? '0,1,2,3,4,5,6'))) {
    return { mode: 'fixed', start: s.start, end: s.end, days: String(s.days ?? '0,1,2,3,4,5,6') };
  }
  if (s?.mode === 'bounded' && TIME.test(s.earliest) && TIME.test(s.latest) && s.earliest < s.latest) {
    return { mode: 'bounded', earliest: s.earliest, latest: s.latest };
  }
  console.error(`[planos] horário inválido no plano "${planId}"; usando 06:00–23:00`, raw);
  return { mode: 'bounded', earliest: '06:00', latest: '23:00' };
}

const clamp = (n: unknown, min: number, max: number, dflt: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : dflt;
};

type PlanRow = {
  id: string; name: string; price_cents: number; tagline: string; interval_min: number; max_channels: number;
  max_per_run: number; max_wa_groups: number; schedule: unknown; items: unknown; highlight: boolean; visible: boolean;
};
function rowToPlan(r: PlanRow): Plan {
  const priceCents = clamp(r.price_cents, 0, 10_000_000, 0);
  return {
    id: r.id,
    name: r.name,
    priceCents,
    price: formatPrice(priceCents),
    tagline: r.tagline ?? '',
    intervalMin: clamp(r.interval_min, 10, 240, 60),
    maxChannels: Number(r.max_channels) >= 2 ? 2 : 1,
    maxPerRun: clamp(r.max_per_run, 1, MAX_PER_RUN, 3),
    maxWaGroups: clamp(r.max_wa_groups, 1, MAX_WA_GROUPS, 1),
    schedule: parseSchedule(r.schedule, r.id),
    items: Array.isArray(r.items) ? r.items.map(String).slice(0, 12) : [],
    highlight: !!r.highlight,
    visible: r.visible !== false,
  };
}

type PromoRow = {
  id: string; code: string | null; description: string; plan_ids: string[]; discount_type: Promotion['type'];
  discount_value: number; starts_at: Date; ends_at: Date | null; max_redemptions: number | null; redemptions: number;
};
const rowToPromo = (r: PromoRow): Promotion => ({
  id: r.id,
  code: r.code,
  description: r.description,
  planIds: r.plan_ids ?? [],
  type: r.discount_type,
  value: Number(r.discount_value),
  startsAt: new Date(r.starts_at).toISOString(),
  endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
  maxRedemptions: r.max_redemptions,
  redemptions: Number(r.redemptions),
});

async function load(): Promise<Catalog> {
  try {
    const [rows, prows] = await Promise.all([
      q<PlanRow>('SELECT * FROM plans ORDER BY sort_order, price_cents, id'),
      q<PromoRow>('SELECT * FROM promotions WHERE active AND (ends_at IS NULL OR ends_at > now())'),
    ]);
    const promos = prows.map(rowToPromo);
    const plans = (rows.length ? rows.map(rowToPlan) : DEFAULT_PLANS).map((p) => ({ ...p, offer: bestOffer(p, promos) }));
    return { plans, promos, fallback: !rows.length };
  } catch (err) {
    console.error('[planos] falha ao ler do banco; usando os planos padrão:', err);
    return { plans: DEFAULT_PLANS, promos: [], fallback: true };
  }
}

async function catalog(): Promise<Catalog> {
  const now = Date.now();
  const c = g.__catalog;
  if (c && now - c.at < c.ttl) return c.data;
  const data = load();
  g.__catalog = { at: now, ttl: TTL, data };
  // Com falha no banco, tenta de novo logo
  void data.then((d) => { if (d.fallback && g.__catalog?.data === data) g.__catalog.ttl = 5_000; });
  return data;
}

export const invalidatePlans = () => { g.__catalog = undefined; };

/** Planos à venda (site, cadastro, troca de plano). `all` inclui os ocultos (admin). */
export async function listPlans(opts: { all?: boolean } = {}): Promise<Plan[]> {
  const { plans } = await catalog();
  return opts.all ? plans : plans.filter((p) => p.visible !== false);
}

export async function getPlan(id: string): Promise<Plan> {
  return findPlan((await catalog()).plans, id);
}

export async function planExists(id: string, opts: { visibleOnly?: boolean } = {}) {
  const p = (await catalog()).plans.find((x) => x.id === id);
  return !!p && (!opts.visibleOnly || p.visible !== false);
}

/* ------------------------------------------------------------------ por conta */
type Override = {
  interval_min: number | null; max_channels: number | null; max_per_run: number | null; max_wa_groups: number | null; price_cents: number | null;
  reason: string; promo: PromoRow | null; promo_active: boolean | null;
};

const getOverride = (accountId: string) =>
  one<Override>(
    `SELECT o.interval_min, o.max_channels, o.max_per_run, o.max_wa_groups, o.price_cents, o.reason,
            to_jsonb(p) - 'active' AS promo, p.active AS promo_active
     FROM account_overrides o LEFT JOIN promotions p ON p.id = o.promotion_id
     WHERE o.account_id = $1`,
    [accountId]
  );

export type EffectivePlan = Plan & { custom: string[] };

/**
 * Limites que valem agora para a conta: o plano contratado (ou o de teste, durante o teste
 * grátis) com os ajustes sob medida do cliente por cima.
 */
export async function effectivePlan(a: { id: string; plan: string; status: string }): Promise<EffectivePlan> {
  const [base, o] = await Promise.all([getPlan(a.status === 'trial' ? TRIAL_PLAN : a.plan), getOverride(a.id)]);
  const plan: EffectivePlan = { ...base, custom: [] };
  if (o?.interval_min != null) { plan.intervalMin = clamp(o.interval_min, 10, 240, base.intervalMin); plan.custom.push('ciclo'); }
  if (o?.max_channels != null) { plan.maxChannels = Number(o.max_channels) >= 2 ? 2 : 1; plan.custom.push('canais'); }
  if (o?.max_per_run != null) { plan.maxPerRun = clamp(o.max_per_run, 1, MAX_PER_RUN, base.maxPerRun); plan.custom.push('ofertas por rodada'); }
  if (o?.max_wa_groups != null) { plan.maxWaGroups = clamp(o.max_wa_groups, 1, MAX_WA_GROUPS, base.maxWaGroups); plan.custom.push('grupos de WhatsApp'); }
  return plan;
}

export type Billing = { plan: Plan; baseCents: number; priceCents: number; price: string; reason: string | null };

// Preço de um plano para uma conta: preço sob medida > promoção vinculada > preço do plano.
// A promoção vinculada (cupom ou promoção do cadastro) segue valendo depois do fim da campanha;
// deixa de valer se for desativada no admin ou se a conta mudar para um plano fora dela.
export function priceWith(plan: Plan, o: Pick<Override, 'price_cents' | 'promo' | 'promo_active'> | null): Omit<Billing, 'plan'> {
  if (o?.price_cents != null) return { baseCents: plan.priceCents, priceCents: o.price_cents, price: formatPrice(o.price_cents), reason: 'Preço especial' };
  const pr = o?.promo && o.promo_active ? rowToPromo(o.promo) : null;
  if (pr && pr.type !== 'extra_trial_days' && pr.planIds.includes(plan.id)) {
    const c = discounted(plan.priceCents, pr);
    return { baseCents: plan.priceCents, priceCents: c, price: formatPrice(c), reason: pr.description };
  }
  return { baseCents: plan.priceCents, priceCents: plan.priceCents, price: plan.price, reason: null };
}

export async function accountBilling(a: { id: string; plan: string }): Promise<Billing> {
  const [plan, o] = await Promise.all([getPlan(a.plan), getOverride(a.id)]);
  return { plan, ...priceWith(plan, o) };
}

/** Receita mensal estimada das contas ativas, com preços especiais e promoções. */
export async function monthlyRevenueCents(): Promise<number> {
  const rows = await q<Override & { plan: string }>(
    `SELECT a.plan, o.price_cents, to_jsonb(p) - 'active' AS promo, p.active AS promo_active
     FROM accounts a
     LEFT JOIN account_overrides o ON o.account_id = a.id
     LEFT JOIN promotions p ON p.id = o.promotion_id
     WHERE a.status = 'active'`
  );
  const { plans } = await catalog();
  return rows.reduce((s, r) => s + priceWith(findPlan(plans, r.plan), r).priceCents, 0);
}

/** Preço de cada conta (lista do admin). */
export async function billingByAccount(): Promise<Map<string, Omit<Billing, 'plan'>>> {
  const rows = await q<Override & { account_id: string; plan: string }>(
    `SELECT a.id AS account_id, a.plan, o.price_cents, to_jsonb(p) - 'active' AS promo, p.active AS promo_active
     FROM accounts a
     JOIN account_overrides o ON o.account_id = a.id
     LEFT JOIN promotions p ON p.id = o.promotion_id`
  );
  const { plans } = await catalog();
  return new Map(rows.map((r) => [r.account_id, priceWith(findPlan(plans, r.plan), r)]));
}

/* ------------------------------------------------------------------ cupons */
export type Redeemed = Promotion;
type Tx = Parameters<Parameters<typeof tx>[0]>[0];

/**
 * Consome uma promoção dentro da transação do cadastro. Com código: o cupom digitado.
 * Sem código: a melhor promoção automática do plano. A contagem de usos é atômica.
 */
export async function redeemPromotion(c: Tx, planId: string, code: string | null): Promise<Redeemed | null> {
  const cond = `active AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
                AND (max_redemptions IS NULL OR redemptions < max_redemptions) AND $1 = ANY(plan_ids)`;
  let id: string | null = null;
  if (code) {
    const [r] = await c.query<{ id: string }>(`SELECT id FROM promotions WHERE code = $2 AND ${cond}`, [planId, code]);
    id = r?.id ?? null;
  } else {
    const { plans, promos } = await catalog();
    id = bestOffer(findPlan(plans, planId), promos)?.promotionId ?? null;
  }
  if (!id) return null;
  const [row] = await c.query<PromoRow>(`UPDATE promotions SET redemptions = redemptions + 1 WHERE id = $2 AND ${cond} RETURNING *`, [planId, id]);
  return row ? rowToPromo(row) : null;
}
