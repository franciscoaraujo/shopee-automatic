'use server';

// Ações do Shopee Video Studio. A conta SEMPRE vem da sessão; ids vindos do navegador são
// conferidos contra a conta em cada consulta (repo.ts). Nenhuma ação publica vídeos.
import { revalidatePath } from 'next/cache';
import { rateLimit } from '@/lib/rate-limit';
import {
  CRITERIA, DECISIONS, FORMATS, LANGUAGES, NARRATIONS, STYLES,
  type Criterion, type Decision, type GenerationOptions, type VideoFormat,
} from '@/lib/videos';
import { isOperational } from '@/server/accounts';
import { requireSession } from '@/server/session';
import { createProvider as createAdapter, getProviderDefinition } from '@/server/videos/providers';
import {
  addReview, createProjects, createProvider, deleteProject, deleteProvider, getProviderWithKey, listProducts, logEvent, newVersion,
  saveValidation, setDefaultProvider, setProviderEnabled, updateProvider, VideoError, type ProductRow,
} from '@/server/videos/repo';
import { getStorage } from '@/server/videos/storage';

// warning: a operação foi feita, mas há um problema a mostrar (ex.: salvo, porém a conexão falhou)
export type ActionResult = { ok: boolean; warning?: boolean; message?: string; errors?: Record<string, string>; id?: string; ids?: string[] };

const fail = (err: unknown): ActionResult => {
  if (err instanceof VideoError) return { ok: false, errors: { [err.field]: err.message }, message: err.message };
  console.error('[vídeos]', err);
  return { ok: false, message: 'Não foi possível concluir. Tente novamente.' };
};

const refresh = () => revalidatePath('/app/videos', 'layout');

/* ------------------------------------------------------------------ Provedores */
export async function createProviderAction(fd: FormData): Promise<ActionResult> {
  const { account } = await requireSession();
  if (!rateLimit(`ai-provider:${account.id}`, 20, 10 * 60_000)) return { ok: false, message: 'Muitas alterações seguidas. Aguarde alguns minutos.' };
  try {
    const type = String(fd.get('type') ?? '');
    // Pré-requisito da conta do provedor (ex.: plano pago da Gemini API): confirmação obrigatória
    const requirement = getProviderDefinition(type)?.requirement;
    if (requirement && fd.get('paidPlan') !== 'on') throw new VideoError(`Marque a confirmação: ${requirement.title}.`, 'paidPlan');
    const settings = requirement ? { paidPlanConfirmedAt: new Date().toISOString() } : {};
    const id = await createProvider(account.id, { type, name: String(fd.get('name') ?? ''), apiKey: String(fd.get('apiKey') ?? ''), settings });
    const test = await testProvider(account.id, id);
    refresh();
    return { ok: true, warning: !test.ok, id, message: test.ok ? `Provedor salvo. ${test.message}` : `Provedor salvo, mas a conexão falhou: ${test.message}` };
  } catch (err) {
    return fail(err);
  }
}

export async function updateProviderAction(id: string, fd: FormData): Promise<ActionResult> {
  const { account } = await requireSession();
  if (!rateLimit(`ai-provider:${account.id}`, 20, 10 * 60_000)) return { ok: false, message: 'Muitas alterações seguidas. Aguarde alguns minutos.' };
  try {
    const apiKey = String(fd.get('apiKey') ?? '').trim();
    await updateProvider(account.id, id, {
      name: String(fd.get('name') ?? ''),
      apiKey: apiKey || undefined,
      defaultModel: fd.has('defaultModel') ? String(fd.get('defaultModel') ?? '') || null : undefined,
      settings: { defaultResolution: String(fd.get('defaultResolution') ?? '') || undefined },
    });
    const test = apiKey ? await testProvider(account.id, id) : null;
    refresh();
    return { ok: true, warning: test ? !test.ok : false, message: test ? (test.ok ? `Chave atualizada. ${test.message}` : `Chave salva, mas a conexão falhou: ${test.message}`) : 'Salvo' };
  } catch (err) {
    return fail(err);
  }
}

async function testProvider(accountId: string, id: string) {
  const p = await getProviderWithKey(accountId, id);
  if (!p) throw new VideoError('Provedor não encontrado.');
  const t0 = Date.now();
  const result = await createAdapter(p.type, { apiKey: p.apiKey, settings: p.settings }).validateConnection();
  await saveValidation(accountId, id, result);
  await logEvent({ accountId, provider: p.type, event: result.ok ? 'provider.validated' : 'provider.validation_failed', error: result.ok ? null : result.message, ms: Date.now() - t0, response: { models: result.models.map((m) => m.id) } });
  return result;
}

export async function testProviderAction(id: string): Promise<ActionResult> {
  const { account } = await requireSession();
  if (!rateLimit(`ai-test:${account.id}`, 15, 10 * 60_000)) return { ok: false, message: 'Muitos testes seguidos. Aguarde alguns minutos.' };
  try {
    const r = await testProvider(account.id, id);
    refresh();
    return { ok: r.ok, message: r.message };
  } catch (err) {
    return fail(err);
  }
}

export async function setDefaultProviderAction(id: string): Promise<ActionResult> {
  const { account } = await requireSession();
  try {
    await setDefaultProvider(account.id, id);
    refresh();
    return { ok: true, message: 'Provedor padrão atualizado' };
  } catch (err) {
    return fail(err);
  }
}

export async function toggleProviderAction(id: string, enabled: boolean): Promise<ActionResult> {
  const { account } = await requireSession();
  await setProviderEnabled(account.id, id, enabled);
  refresh();
  return { ok: true, message: enabled ? 'Provedor ativado' : 'Provedor desativado' };
}

export async function deleteProviderAction(id: string): Promise<ActionResult> {
  const { account } = await requireSession();
  try {
    await deleteProvider(account.id, id);
    refresh();
    return { ok: true, message: 'Provedor removido (a chave foi apagada).' };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------------ Produtos */
export async function searchProductsAction(f: { search?: string; category?: string; page?: number }): Promise<{ items: ProductRow[]; total: number; page: number; pages: number }> {
  const { account } = await requireSession();
  return listProducts(account.id, { search: String(f.search ?? ''), category: String(f.category ?? ''), page: Number(f.page) || 1 });
}

/* ------------------------------------------------------------------ Geração */
export type GeneratePayload = {
  requestKey: string; providerId: string; model: string; format: string; duration: number;
  options: Partial<GenerationOptions>; items: { productId: string; prompt: string }[];
};

function parseOptions(o: Partial<GenerationOptions>): GenerationOptions {
  if (!o.style || !(o.style in STYLES)) throw new VideoError('Escolha o estilo visual.', 'style');
  if (!o.narration || !(o.narration in NARRATIONS)) throw new VideoError('Escolha a narração.', 'narration');
  if (!o.language || !(o.language in LANGUAGES)) throw new VideoError('Escolha o idioma.', 'language');
  const voice = String(o.voiceInstructions ?? '').trim();
  const extra = String(o.extraInstructions ?? '').trim();
  if (voice.length > 300) throw new VideoError('Instruções de voz: máx. 300 caracteres.', 'voiceInstructions');
  if (extra.length > 1000) throw new VideoError('Instruções adicionais: máx. 1000 caracteres.', 'extraInstructions');
  return { style: o.style, narration: o.narration, language: o.language, voiceInstructions: voice, extraInstructions: extra, resolution: String(o.resolution ?? '') };
}

export async function generateVideosAction(payload: GeneratePayload): Promise<ActionResult> {
  const { account, user } = await requireSession();
  if (!isOperational(account)) return { ok: false, message: 'Sua conta está pausada. Fale com o suporte para gerar vídeos.' };
  if (!rateLimit(`video-gen:${account.id}`, 10, 60_000)) return { ok: false, message: 'Muitos pedidos seguidos. Aguarde um minuto.' };
  try {
    if (!(payload.format in FORMATS)) throw new VideoError('Formato inválido.', 'format');
    const out = await createProjects(account.id, user.id, {
      requestKey: String(payload.requestKey ?? ''), providerId: String(payload.providerId ?? ''), model: String(payload.model ?? ''),
      format: payload.format as VideoFormat, duration: Math.round(Number(payload.duration)), options: parseOptions(payload.options ?? {}),
      items: (Array.isArray(payload.items) ? payload.items : []).map((i) => ({ productId: String(i.productId), prompt: String(i.prompt ?? '') })),
    });
    refresh();
    return {
      ok: true, ids: out.ids,
      message: out.created ? `${out.created} vídeo(s) na fila de geração.` : 'Este pedido já tinha sido enviado; nada foi duplicado.',
    };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------------ Avaliação e galeria */
export async function reviewAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const { account, user } = await requireSession();
  const decision = String(fd.get('decision') ?? '') as Decision;
  if (!(decision in DECISIONS)) return { ok: false, message: 'Escolha uma decisão.' };
  const ratings: Partial<Record<Criterion, number>> = {};
  for (const c of Object.keys(CRITERIA) as Criterion[]) {
    const v = Number(fd.get(c));
    if (v) ratings[c] = v;
  }
  try {
    const { newProjectId } = await addReview(account.id, user.id, { projectId, decision, comments: String(fd.get('comments') ?? ''), ratings });
    refresh();
    return {
      ok: true, id: newProjectId ?? undefined,
      message: decision === 'APPROVED' ? 'Vídeo aprovado (uso interno — nada foi publicado).' : decision === 'REJECTED' ? 'Vídeo rejeitado.' : 'Avaliação salva e nova versão enviada para a fila.',
    };
  } catch (err) {
    return fail(err);
  }
}

export async function quickDecisionAction(projectId: string, decision: 'APPROVED' | 'REJECTED'): Promise<ActionResult> {
  const { account, user } = await requireSession();
  if (decision !== 'APPROVED' && decision !== 'REJECTED') return { ok: false };
  try {
    await addReview(account.id, user.id, { projectId, decision, comments: '', ratings: {} });
    refresh();
    return { ok: true, message: decision === 'APPROVED' ? 'Aprovado' : 'Rejeitado' };
  } catch (err) {
    return fail(err);
  }
}

export async function newVersionAction(projectId: string, requestKey: string): Promise<ActionResult> {
  const { account, user } = await requireSession();
  if (!isOperational(account)) return { ok: false, message: 'Sua conta está pausada.' };
  if (!rateLimit(`video-gen:${account.id}`, 10, 60_000)) return { ok: false, message: 'Muitos pedidos seguidos. Aguarde um minuto.' };
  try {
    const id = await newVersion(account.id, user.id, projectId, '', requestKey);
    refresh();
    return { ok: true, id, message: 'Nova versão na fila de geração.' };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteVideoAction(projectId: string): Promise<ActionResult> {
  const { account } = await requireSession();
  try {
    await deleteProject(account.id, projectId, (key) => getStorage().delete(key));
    refresh();
    return { ok: true, message: 'Vídeo excluído.' };
  } catch (err) {
    return fail(err);
  }
}

