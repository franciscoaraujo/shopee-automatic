// Vídeos PREMIUM: gerados com a conta Google Gemini da PLATAFORMA (custo do operador).
// O cliente não configura nada; cada plano tem uma cota mensal de vídeos premium.
// Vídeos ECONÔMICOS usam a chave xAI do próprio cliente (ai_providers) e não entram aqui.
//
// Variáveis de ambiente:
//   PLATFORM_GEMINI_API_KEY        chave da Gemini API do operador (projeto com faturamento ativo)
//   PLATFORM_GEMINI_MODEL          padrão gemini-omni-1.2-flash
//   PLATFORM_VIDEO_MAX_DURATION    padrão 10 (segundos) — controla o custo por vídeo
//   PLATFORM_VIDEO_MAX_RESOLUTION  padrão 720p
//   PREMIUM_VIDEOS_TRIAL           padrão 2 — cota mensal de contas em teste grátis
import type { ModelCapabilities } from '@/lib/videos';
import { TRIAL_PLAN } from '@/lib/plans';
import { one } from '@/server/db';
import { GEMINI_CATALOG, GeminiVideoProvider } from './providers/gemini';
import type { VideoGenerationProvider } from './providers/types';

export const PLATFORM_PROVIDER_ID = 'platform:gemini';
export const PLATFORM_PROVIDER_TYPE = 'gemini';
export const PLATFORM_LABEL = 'Google Gemini (Premium)';

const RES_ORDER = ['360p', '480p', '720p', '1080p', '4k'];

export function platformConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    apiKey: (env.PLATFORM_GEMINI_API_KEY || '').trim(),
    model: env.PLATFORM_GEMINI_MODEL || 'gemini-omni-1.2-flash',
    maxDuration: Math.max(3, Math.min(15, Number(env.PLATFORM_VIDEO_MAX_DURATION) || 10)),
    maxResolution: RES_ORDER.includes(env.PLATFORM_VIDEO_MAX_RESOLUTION || '') ? env.PLATFORM_VIDEO_MAX_RESOLUTION! : '720p',
    trialQuota: Math.max(0, Number(env.PREMIUM_VIDEOS_TRIAL ?? 2) || 0),
  };
}

export const isPlatformConfigured = () => platformConfig().apiKey.length > 0;

// Capacidades do modelo da plataforma, já com os limites de custo do operador
export function platformModel(): ModelCapabilities | null {
  const cfg = platformConfig();
  const base = GEMINI_CATALOG.find((m) => m.id === cfg.model);
  if (!base) return null;
  const maxIdx = RES_ORDER.indexOf(cfg.maxResolution);
  const resolutions = base.resolutions.filter((r) => RES_ORDER.indexOf(r) <= maxIdx);
  return {
    ...base,
    label: 'Gemini Omni Flash',
    maxDuration: Math.min(base.maxDuration, cfg.maxDuration),
    resolutions,
    defaultResolution: resolutions.includes(base.defaultResolution) ? base.defaultResolution : resolutions[resolutions.length - 1],
    // Notas do modelo ajustadas aos limites da plataforma (e sem a de plano pago: quem paga é a plataforma)
    notes: [
      `Vídeos premium: de ${base.minDuration} a ${Math.min(base.maxDuration, cfg.maxDuration)} segundos, até ${cfg.maxResolution}, nos formatos 9:16 e 16:9 (sem 1:1).`,
      ...base.notes.filter((n) => !/plano gratuito|^Gera de|ampliados/.test(n)),
    ],
  };
}

export function platformAdapter(): VideoGenerationProvider {
  const cfg = platformConfig();
  if (!cfg.apiKey) throw new Error('IA premium não configurada (PLATFORM_GEMINI_API_KEY).');
  return new GeminiVideoProvider({ apiKey: cfg.apiKey, settings: {} });
}

// Disponibilidade real (chave válida e com acesso ao modelo). Cache de 10 min por processo.
const g = globalThis as unknown as { __platformStatus?: { at: number; ok: boolean; message: string } };
export async function platformStatus(force = false): Promise<{ ok: boolean; message: string }> {
  if (!isPlatformConfigured()) return { ok: false, message: 'Vídeos premium ainda não foram ativados pela plataforma.' };
  const c = g.__platformStatus;
  if (!force && c && Date.now() - c.at < 10 * 60_000) return c;
  const r = await platformAdapter().validateConnection().catch((err: Error) => ({ ok: false, message: err.message, models: [] }));
  const model = platformConfig().model;
  const ok = r.ok && r.models.some((m) => m.id === model);
  const status = { at: Date.now(), ok, message: ok ? 'Disponível' : `Vídeos premium indisponíveis no momento (${r.message}).` };
  if (!ok) console.error('[vídeos premium] provedor da plataforma indisponível:', r.message);
  g.__platformStatus = status;
  return status;
}

// Cota mensal (mês corrente no fuso de São Paulo). Vídeos que falharam não contam:
// o Google não cobra por eles.
export async function premiumQuota(accountId: string): Promise<{ limit: number; used: number; remaining: number }> {
  const r = await one<{ limit: number; used: string }>(
    `SELECT coalesce(o.premium_videos_month,
                     CASE WHEN a.status = 'trial' THEN $3::int ELSE p.premium_videos_month END, 0) AS limit,
            (SELECT count(*) FROM video_projects v
              WHERE v.account_id = a.id AND v.provider_source = 'platform' AND v.status <> 'FAILED'
                AND v.created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS used
     FROM accounts a
     LEFT JOIN plans p ON p.id = CASE WHEN a.status = 'trial' THEN $2 ELSE a.plan END
     LEFT JOIN account_overrides o ON o.account_id = a.id
     WHERE a.id = $1`,
    [accountId, TRIAL_PLAN, platformConfig().trialQuota]
  );
  const limit = Number(r?.limit ?? 0);
  const used = Number(r?.used ?? 0);
  return { limit, used, remaining: Math.max(0, limit - used) };
}
