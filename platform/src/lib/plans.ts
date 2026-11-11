// Planos do SaaS: tipos e cálculos puros (seguros para o navegador).
// Os planos, promoções e limites por cliente ficam no banco (tabelas plans, promotions,
// account_overrides) e são lidos por src/server/plans.ts. DEFAULT_PLANS é a carga inicial
// da tabela e a reserva caso o banco não responda.
export type PlanId = string;

// Controle do horário de envio por plano
export type SchedulePolicy =
  | { mode: 'fixed'; start: string; end: string; days: string }   // horário fixo, cliente não altera
  | { mode: 'bounded'; earliest: string; latest: string }          // cliente escolhe dentro de um período
  | { mode: 'full' };                                              // controle total (24 h, madrugada)

export type Plan = {
  id: PlanId;
  name: string;
  priceCents: number;
  price: string;         // preço formatado ("97" ou "97,90")
  tagline: string;
  intervalMin: number;   // ciclo mínimo entre rodadas (minutos)
  maxChannels: 1 | 2;    // canais simultâneos (WhatsApp/Telegram)
  maxPerRun: number;     // ofertas por rodada
  schedule: SchedulePolicy;
  highlight?: boolean;
  visible?: boolean;     // aparece no site, no cadastro e na troca de plano
  items: string[];
  offer?: PlanOffer | null; // promoção automática em vigor (vitrine)
};

export type PromotionType = 'percent' | 'fixed' | 'extra_trial_days';
export type Promotion = {
  id: string;
  code: string | null;   // null = automática (aparece no site)
  description: string;
  planIds: string[];
  type: PromotionType;
  value: number;         // % | centavos | dias
  startsAt: string;
  endsAt: string | null;
  maxRedemptions: number | null;
  redemptions: number;
};

export type PlanOffer = { promotionId: string; description: string; priceCents: number; price: string; endsAt: string | null; extraTrialDays: number };

export const formatPrice = (cents: number) => {
  const reais = Math.floor(cents / 100);
  const c = cents % 100;
  return c ? `${reais.toLocaleString('pt-BR')},${String(c).padStart(2, '0')}` : reais.toLocaleString('pt-BR');
};

const p = (id: string, name: string, priceCents: number, rest: Omit<Plan, 'id' | 'name' | 'priceCents' | 'price'>): Plan =>
  ({ id, name, priceCents, price: formatPrice(priceCents), ...rest });

export const DEFAULT_PLANS: Plan[] = [
  p('start', 'Start', 4700, {
    tagline: 'Para começar um grupo',
    intervalMin: 60,
    maxChannels: 1,
    maxPerRun: 3,
    schedule: { mode: 'fixed', start: '08:00', end: '16:00', days: '0,1,2,3,4,5,6' },
    items: ['1 canal: WhatsApp ou Telegram', 'Envios das 8h às 16h (horário fixo)', 'Você escolhe o ciclo: a partir de 1 h', 'Até 3 ofertas por rodada', 'Painel de resultados'],
  }),
  p('pro', 'Pro', 9700, {
    tagline: 'Para grupos que já vendem',
    intervalMin: 30,
    maxChannels: 2,
    maxPerRun: 5,
    schedule: { mode: 'bounded', earliest: '06:00', latest: '23:00' },
    highlight: true,
    items: ['WhatsApp e Telegram juntos', 'Você escolhe o horário (entre 6h e 23h) e os dias', 'Ciclo a partir de 30 min', 'Até 5 ofertas por rodada', 'Suporte pelo WhatsApp'],
  }),
  p('escala', 'Escala', 19700, {
    tagline: 'Para quem vive de ofertas',
    intervalMin: 10,
    maxChannels: 2,
    maxPerRun: 10,
    schedule: { mode: 'full' },
    items: ['WhatsApp e Telegram juntos', 'Horário livre: 24 h, madrugada e dias à sua escolha', 'Ciclo a partir de 10 min', 'Até 10 ofertas por rodada', 'Suporte prioritário'],
  }),
];

// Ciclos que o cliente pode escolher (minutos). Cada plano libera a partir do seu intervalMin.
// De 5 em 5 min até 1 h; depois passos maiores.
export const INTERVAL_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 75, 90, 105, 120, 150, 180, 240] as const;
export const MAX_PER_RUN = 20;

export const formatInterval = (min: number) => {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m}` : `${h} h`;
};

// Ciclo que vale: o escolhido pelo cliente, nunca abaixo do mínimo do plano
export const effectiveInterval = (plan: Pick<Plan, 'intervalMin'>, chosen: number | null | undefined) =>
  Math.max(plan.intervalMin, Number(chosen) || plan.intervalMin);

export const TRIAL_DAYS = 7;
export const TRIAL_PLAN: PlanId = 'pro';

// Plano de uma lista; desconhecido cai no plano de teste e, em último caso, no padrão
export const findPlan = (plans: Plan[], id: string): Plan =>
  plans.find((x) => x.id === id) ?? plans.find((x) => x.id === TRIAL_PLAN) ?? DEFAULT_PLANS[1];

/* ------------------------------------------------------------------ promoções */
export function promotionIsLive(pr: Promotion, now = new Date()) {
  if (new Date(pr.startsAt) > now) return false;
  if (pr.endsAt && new Date(pr.endsAt) <= now) return false;
  if (pr.maxRedemptions != null && pr.redemptions >= pr.maxRedemptions) return false;
  return true;
}

export function discounted(priceCents: number, pr: Pick<Promotion, 'type' | 'value'> | null | undefined) {
  if (!pr) return priceCents;
  if (pr.type === 'percent') return Math.max(0, Math.round((priceCents * (100 - Math.min(100, Math.max(0, pr.value)))) / 100));
  if (pr.type === 'fixed') return Math.max(0, priceCents - Math.max(0, pr.value));
  return priceCents;
}

// Melhor promoção automática (sem cupom) para um plano: a de menor preço final; empate → mais dias de teste
export function bestOffer(plan: Plan, promos: Promotion[], now = new Date()): PlanOffer | null {
  let best: PlanOffer | null = null;
  for (const pr of promos) {
    if (pr.code || !pr.planIds.includes(plan.id) || !promotionIsLive(pr, now)) continue;
    const priceCents = discounted(plan.priceCents, pr);
    const extraTrialDays = pr.type === 'extra_trial_days' ? pr.value : 0;
    const o = { promotionId: pr.id, description: pr.description, priceCents, price: formatPrice(priceCents), endsAt: pr.endsAt, extraTrialDays };
    if (!best || o.priceCents < best.priceCents || (o.priceCents === best.priceCents && o.extraTrialDays > best.extraTrialDays)) best = o;
  }
  return best;
}

export const ACCOUNT_STATUSES = [
  { value: 'trial', label: 'Teste' },
  { value: 'active', label: 'Ativa' },
  { value: 'suspended', label: 'Suspensa' },
  { value: 'canceled', label: 'Cancelada' },
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]['value'];
