// Leitura e gravação das configurações de cada conta (segredos criptografados).
import type { Plan } from '@/lib/plans';
import { FIELD, SECTIONS, type FieldDef, type PublicSettings, type SectionId, type Settings } from '@/lib/settings-schema';
import { decrypt, encrypt } from './crypto';
import { q, tx } from './db';

const aad = (accountId: string, key: string) => `${accountId}:${key}`;

function coerce(f: FieldDef, raw: unknown) {
  switch (f.type) {
    case 'bool': return raw === true || raw === 'true';
    case 'number': case 'percent': case 'select': { const n = Number(raw); return Number.isFinite(n) ? n : null; }
    default: return raw == null ? null : String(raw);
  }
}

export async function getSettings(accountId: string): Promise<Settings & { _errors: string[] }> {
  const rows = await q<{ key: string; value: string; encrypted: boolean }>('SELECT key, value, encrypted FROM account_settings WHERE account_id = $1', [accountId]);
  const stored = new Map(rows.map((r) => [r.key, r]));
  const out: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const f of Object.values(FIELD)) {
    const row = stored.get(f.key);
    if (row) {
      try {
        out[f.key] = coerce(f, row.encrypted ? decrypt(row.value, aad(accountId, f.key)) : JSON.parse(row.value));
        continue;
      } catch {
        errors.push(f.key);
      }
    }
    out[f.key] = 'default' in f ? f.default : null;
  }
  return { ...(out as Settings), _errors: errors };
}

const mask = (v: string | null) => (v ? (v.length >= 12 ? `•••• ${v.slice(-4)}` : '••••') : null);

export async function getPublicSettings(accountId: string): Promise<PublicSettings> {
  const { _errors, ...s } = await getSettings(accountId);
  void _errors;
  return {
    ...s,
    shopeeSecret: { isSet: !!s.shopeeSecret, hint: mask(s.shopeeSecret) },
    telegramBotToken: { isSet: !!s.telegramBotToken, hint: mask(s.telegramBotToken) },
  };
}

export type SaveResult = { ok: true } | { ok: false; errors: Record<string, string> };

// Valida e grava os campos de UMA seção. Segredo vazio = manter o atual.
export async function saveSection(accountId: string, p: Plan, section: SectionId, input: Record<string, unknown>): Promise<SaveResult> {
  const fields = SECTIONS[section] as FieldDef[];
  const errors: Record<string, string> = {};
  const updates: [string, unknown][] = [];

  for (const f of fields) {
    if (!(f.key in input)) continue;
    const raw = input[f.key];
    if (f.type === 'secret') {
      const s = String(raw ?? '').trim();
      if (!s) continue;
      if (s.length > 500) { errors[f.key] = 'Muito longo'; continue; }
      if (f.pattern && !f.pattern.test(s)) { errors[f.key] = f.patternMsg || 'Formato inválido'; continue; }
      updates.push([f.key, s]);
    } else if (f.type === 'text') {
      const s = String(raw ?? '').trim();
      if (s.length > (f.max ?? 300)) { errors[f.key] = 'Muito longo'; continue; }
      if (s && f.pattern && !f.pattern.test(s)) { errors[f.key] = f.patternMsg || 'Formato inválido'; continue; }
      updates.push([f.key, s]);
    } else if (f.type === 'bool') {
      updates.push([f.key, raw === true || raw === 'on' || raw === 'true']);
    } else if (f.type === 'time') {
      const t = String(raw ?? '').trim().slice(0, 5);
      if (!f.pattern.test(t)) { errors[f.key] = 'Use o formato HH:MM'; continue; }
      updates.push([f.key, t]);
    } else if (f.type === 'days') {
      const list = [...new Set(String(raw ?? '').split(',').map((d) => d.trim()).filter((d) => f.options.some((o) => o.value === d)))];
      if (!list.length) { errors[f.key] = 'Escolha ao menos um dia'; continue; }
      updates.push([f.key, list.sort().join(',')]);
    } else {
      const str = String(raw ?? '').replace(',', '.').trim();
      let n = Number(str);
      if (!str || !Number.isFinite(n)) { errors[f.key] = 'Informe um número'; continue; }
      if (f.type === 'percent') n = n / 100; // formulário envia em %
      // O ciclo mínimo do plano (ou do ajuste da conta) é sempre aceito, mesmo fora da lista padrão
      const planMin = f.key === 'runIntervalMin' && n === p.intervalMin;
      if (f.type === 'select' && !planMin && !f.options.some((o) => o.value === n)) { errors[f.key] = 'Opção inválida'; continue; }
      if (f.type !== 'select') {
        if (n < f.min) { errors[f.key] = `Mínimo ${f.type === 'percent' ? f.min * 100 + '%' : f.min}`; continue; }
        if (n > f.max) { errors[f.key] = `Máximo ${f.type === 'percent' ? f.max * 100 + '%' : f.max}`; continue; }
        if (f.type === 'number' && f.step === 1 && !Number.isInteger(n)) { errors[f.key] = 'Use um número inteiro'; continue; }
      }
      updates.push([f.key, n]);
    }
  }

  // Limites do plano (já com os ajustes sob medida da conta)

  // Ciclo de publicação: não pode ser menor que o mínimo do plano
  const iv = updates.find(([k]) => k === 'runIntervalMin');
  if (iv && Number(iv[1]) < p.intervalMin) errors.runIntervalMin = `O plano ${p.name} permite ciclos a partir de ${p.intervalMin} min`;

  // Horário de envio conforme o plano
  if (section === 'schedule') {
    const pol = p.schedule;
    if (pol.mode === 'fixed') {
      return { ok: false, errors: { form: `No plano ${p.name} o horário é fixo (${pol.start} às ${pol.end}). Mude de plano para escolher o seu.` } };
    }
    const start = updates.find(([k]) => k === 'scheduleStart')?.[1] as string | undefined;
    const end = updates.find(([k]) => k === 'scheduleEnd')?.[1] as string | undefined;
    if (start && end && start === end) errors.scheduleEnd = 'O horário de parada deve ser diferente do início';
    if (pol.mode === 'bounded') {
      // Sempre há janela neste plano
      const en = updates.find(([k]) => k === 'scheduleEnabled');
      if (en) en[1] = true; else updates.push(['scheduleEnabled', true]);
      if (start && start < pol.earliest) errors.scheduleStart = `No plano ${p.name}, o mais cedo é ${pol.earliest}`;
      if (end && end > pol.latest) errors.scheduleEnd = `No plano ${p.name}, o mais tarde é ${pol.latest}`;
      if (start && end && start > end && !errors.scheduleStart && !errors.scheduleEnd) errors.scheduleEnd = 'Horários que passam da meia-noite são do plano Escala';
    }
  }
  const maxPosts = updates.find(([k]) => k === 'maxPostsPerRun');
  if (maxPosts && Number(maxPosts[1]) > p.maxPerRun) errors.maxPostsPerRun = `Seu plano permite até ${p.maxPerRun} por rodada`;

  if (section === 'telegram' || section === 'whatsapp') {
    const cur = await getSettings(accountId);
    const tg = section === 'telegram' ? updates.find(([k]) => k === 'telegramEnabled')?.[1] ?? cur.telegramEnabled : cur.telegramEnabled;
    const wa = section === 'whatsapp' ? updates.find(([k]) => k === 'whatsappEnabled')?.[1] ?? cur.whatsappEnabled : cur.whatsappEnabled;
    if (tg && wa && p.maxChannels < 2) {
      errors[section === 'telegram' ? 'telegramEnabled' : 'whatsappEnabled'] = `O plano ${p.name} permite um canal por vez. Desative o outro ou mude de plano.`;
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  await tx(async (c) => {
    for (const [key, value] of updates) {
      const secret = FIELD[key].type === 'secret';
      await c.query(
        `INSERT INTO account_settings (account_id, key, value, encrypted, updated_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (account_id, key) DO UPDATE SET value = EXCLUDED.value, encrypted = EXCLUDED.encrypted, updated_at = now()`,
        [accountId, key, secret ? encrypt(String(value), aad(accountId, key)) : JSON.stringify(value), secret]
      );
    }
  });
  return { ok: true };
}

export async function setSettingsRaw(accountId: string, values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    const f = FIELD[key];
    if (!f || f.type === 'secret') continue;
    await q(
      `INSERT INTO account_settings (account_id, key, value, encrypted, updated_at) VALUES ($1, $2, $3, false, now())
       ON CONFLICT (account_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [accountId, key, JSON.stringify(value)]
    );
  }
}

export async function clearSetting(accountId: string, key: string) {
  if (!FIELD[key]) return;
  await q('DELETE FROM account_settings WHERE account_id = $1 AND key = $2', [accountId, key]);
}

// O que falta para a conta publicar
export function readiness(s: Settings, waConnected: boolean | null) {
  const items = [
    { id: 'shopee', label: 'Shopee', ok: !!(s.shopeeAppId && s.shopeeSecret), detail: s.shopeeAppId && s.shopeeSecret ? 'Credenciais salvas' : 'Informe App ID e Secret' },
    {
      id: 'whatsapp', label: 'WhatsApp', enabled: s.whatsappEnabled,
      ok: !s.whatsappEnabled || (!!s.whatsappGroupJid && waConnected !== false),
      detail: !s.whatsappEnabled ? 'Desativado' : waConnected === false ? 'Desconectado — leia o QR Code' : s.whatsappGroupJid ? `Publica em “${s.whatsappGroupName || 'grupo'}”` : 'Escolha o grupo',
    },
    {
      id: 'telegram', label: 'Telegram', enabled: s.telegramEnabled,
      ok: !s.telegramEnabled || !!(s.telegramBotToken && s.telegramChatId),
      detail: !s.telegramEnabled ? 'Desativado' : s.telegramBotToken && s.telegramChatId ? `Publica em ${s.telegramChatId}` : 'Informe bot e canal',
    },
  ];
  const anyChannel = (s.whatsappEnabled && items[1].ok) || (s.telegramEnabled && items[2].ok);
  return { ready: items.every((i) => i.ok) && !!anyChannel, items };
}
