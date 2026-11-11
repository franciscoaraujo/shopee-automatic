'use server';

// Ações do painel do cliente. A conta SEMPRE vem da sessão — nunca de um parâmetro do navegador.
import { revalidatePath } from 'next/cache';
import { SECTIONS, type SectionId } from '@/lib/settings-schema';
import { rateLimit } from '@/lib/rate-limit';
import { findUserForLogin, isOperational, setPassword, verifyPassword } from '@/server/accounts';
import { q } from '@/server/db';
import { testShopee, testTelegram, waGroups, waLogout, waState, type Result } from '@/server/integrations';
import { connectError, connectWhatsApp, type ConnectResult } from '@/server/whatsapp-connection';
import { endOtherSessions, requireSession } from '@/server/session';
import { effectivePlan } from '@/server/plans';
import { clearSetting, getSettings, saveSection, setSettingsRaw } from '@/server/settings';

export type SaveState = { ok?: boolean; errors?: Record<string, string>; message?: string; n?: number; values?: Record<string, string> };

export async function saveSectionAction(section: SectionId, prev: SaveState, fd: FormData): Promise<SaveState> {
  const { account } = await requireSession();
  if (!(section in SECTIONS)) return { errors: { form: 'Seção inválida' } };
  const input: Record<string, unknown> = {};
  for (const f of SECTIONS[section] as { key: string; type: string }[]) {
    if (f.type === 'bool') input[f.key] = fd.get(f.key) === 'on';
    else if (f.type === 'days') input[f.key] = fd.getAll(f.key).map(String).join(',');
    else if (fd.has(f.key)) input[f.key] = fd.get(f.key);
  }
  const r = await saveSection(account.id, await effectivePlan(account), section, input);
  if (!r.ok) {
    // Devolve o que foi digitado (exceto segredos) para o formulário não voltar aos valores salvos
    const values: Record<string, string> = {};
    for (const f of SECTIONS[section] as { key: string; type: string }[]) {
      if (f.type === 'secret') continue;
      values[f.key] = f.type === 'bool' ? (input[f.key] ? 'on' : '') : String(input[f.key] ?? '');
    }
    return { errors: r.errors, values, n: (prev.n ?? 0) + 1 };
  }
  // Horário mudou: o worker reavalia a próxima rodada no próximo ciclo (≤ 20 s)
  if (section === 'schedule') await q('UPDATE accounts SET next_run_at = NULL WHERE id = $1', [account.id]);
  if (section === 'frequency') {
    const min = Number(input.runIntervalMin);
    await q(`UPDATE accounts SET next_run_at = LEAST(next_run_at, now() + $2 * interval '1 minute') WHERE id = $1`, [account.id, min]);
  }
  revalidatePath('/app', 'layout');
  return { ok: true, message: 'Salvo', n: (prev.n ?? 0) + 1 };
}

export async function clearSecretAction(key: 'shopeeSecret' | 'telegramBotToken') {
  const { account } = await requireSession();
  if (key !== 'shopeeSecret' && key !== 'telegramBotToken') return;
  await clearSetting(account.id, key);
  revalidatePath('/app', 'layout');
}

// Testes usam o valor digitado (ainda não salvo) ou, se vazio, o salvo
export async function testShopeeAction(appId: string, secret: string): Promise<Result> {
  const { account } = await requireSession();
  if (!rateLimit(`test:${account.id}`, 20, 10 * 60_000)) return { ok: false, message: 'Muitos testes seguidos. Aguarde alguns minutos.' };
  const s = await getSettings(account.id);
  return testShopee(appId.trim() || s.shopeeAppId, secret.trim() || s.shopeeSecret);
}

export async function testTelegramAction(token: string, chatId: string): Promise<Result> {
  const { account } = await requireSession();
  if (!rateLimit(`test:${account.id}`, 20, 10 * 60_000)) return { ok: false, message: 'Muitos testes seguidos. Aguarde alguns minutos.' };
  const s = await getSettings(account.id);
  return testTelegram(token.trim() || s.telegramBotToken, chatId.trim() || s.telegramChatId);
}

/* ------------------------------------------------------------------ WhatsApp */
export async function waStatusAction() {
  const { account } = await requireSession();
  return waState(account.id);
}

// dedicatedNumberConfirmed: a caixa "uso um número dedicado" marcada na tela. A renovação automática
// do QR Code chama sem ela; o servidor aceita porque a conta já confirmou.
export async function waConnectAction(dedicatedNumberConfirmed = false): Promise<ConnectResult> {
  const { account } = await requireSession();
  if (!rateLimit(`wa-connect:${account.id}`, 30, 10 * 60_000)) return connectError('Muitas tentativas. Aguarde alguns minutos.');
  try {
    return await connectWhatsApp(account.id, { dedicatedNumberConfirmed: dedicatedNumberConfirmed === true });
  } catch (err) {
    return connectError((err as Error).message);
  }
}

export async function waGroupsAction(): Promise<{ groups?: { id: string; subject: string; size: number | null }[]; error?: string }> {
  const { account } = await requireSession();
  try {
    return { groups: await waGroups(account.id) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function waSelectGroupAction(jid: string, name: string): Promise<SaveState> {
  const { account } = await requireSession();
  const groups = await waGroups(account.id).catch(() => null);
  const g = groups?.find((x) => x.id === jid);
  if (!g) return { errors: { whatsappGroupJid: 'Grupo não encontrado. Atualize a lista.' } };
  await setSettingsRaw(account.id, { whatsappGroupJid: g.id, whatsappGroupName: g.subject || name });
  revalidatePath('/app', 'layout');
  return { ok: true, message: `Publicará em “${g.subject}”` };
}

export async function waDisconnectAction() {
  const { account } = await requireSession();
  await waLogout(account.id);
  await setSettingsRaw(account.id, { whatsappGroupJid: '', whatsappGroupName: '' });
  revalidatePath('/app', 'layout');
}

/* ------------------------------------------------------------------ Esteira */
export async function runNowAction(): Promise<{ ok: boolean; message: string }> {
  const { account } = await requireSession();
  if (!isOperational(account)) return { ok: false, message: 'Sua conta está pausada.' };
  if (!rateLimit(`run-now:${account.id}`, 1, 5 * 60_000)) return { ok: false, message: 'Você já pediu uma rodada há pouco. Aguarde alguns minutos.' };
  await q('UPDATE accounts SET next_run_at = now(), manual_run = true WHERE id = $1', [account.id]);
  revalidatePath('/app');
  return { ok: true, message: 'Rodada na fila. As ofertas saem em instantes.' };
}

/* ------------------------------------------------------------------ Conta */
export async function changePasswordAction(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const { user } = await requireSession();
  if (!rateLimit(`pw:${user.id}`, 5, 15 * 60_000)) return { errors: { form: 'Muitas tentativas. Aguarde 15 minutos.' } };
  const current = String(fd.get('current') ?? '');
  const next = String(fd.get('next') ?? '');
  if (next.length < 10) return { errors: { next: 'Mínimo de 10 caracteres' } };
  const u = await findUserForLogin(user.email);
  if (!u || !(await verifyPassword(current, u.password_hash))) return { errors: { current: 'Senha atual incorreta' } };
  await setPassword(user.id, next);
  await endOtherSessions(user.id);
  return { ok: true, message: 'Senha alterada. Outras sessões foram encerradas.' };
}
