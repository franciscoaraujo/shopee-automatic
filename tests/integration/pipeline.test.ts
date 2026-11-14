// Integração da rodada da esteira com PostgreSQL real e remetentes dublês (Shopee, WhatsApp,
// Telegram). Os dublês existem só aqui: em produção a rodada usa as integrações reais.
// Rode com: npm run test:integration:docker
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Offer } from '@/server/integrations';

const DB = process.env.TEST_DATABASE_URL;
const suite = DB ? describe : describe.skip;
process.env.DATABASE_URL = DB;
process.env.APP_MASTER_KEY ??= 'a'.repeat(64);

type Mods = {
  db: typeof import('@/server/db');
  pipeline: typeof import('@/server/pipeline');
  accounts: typeof import('@/server/accounts');
  settings: typeof import('@/server/settings');
  plans: typeof import('@/server/plans');
};
let m: Mods;

const offer = (itemId: string, name: string): Offer => ({
  itemId, productName: name, productLink: `https://shopee.com.br/p/${itemId}`, offerLink: `https://s.shopee.com.br/${itemId}`,
  imageUrl: `https://cf.shopee.com.br/file/${itemId}`, priceMin: '49.90', priceMax: '49.90', priceDiscountRate: 20,
  commissionRate: '0.12', commission: '5.99', sales: 1500, ratingStar: '4.8', shopName: 'Loja Teste', periodEndTime: 0,
});

// Dublês: registram o que receberam, como uma integração real faria
function fakes(opts: { waState?: 'open' | 'close' } = {}) {
  const sent = { whatsapp: [] as { jid: string; caption: string }[], telegram: [] as { chatId: string; caption: string }[] };
  return {
    sent,
    deps: {
      searchOffers: async () => [offer('111', 'Garrafa Térmica 1L'), offer('222', 'Fone Bluetooth')],
      shortLink: async (_c: unknown, originUrl: string) => `${originUrl}?curto=1`,
      waState: async () => ({ state: opts.waState ?? 'open' }),
      waSendImage: async (_acc: string, jid: string, _img: string, caption: string) => { sent.whatsapp.push({ jid, caption }); return `wa-${sent.whatsapp.length}`; },
      telegramSendPhoto: async (_t: string, chatId: string, _img: string, caption: string) => { sent.telegram.push({ chatId, caption }); return `tg-${sent.telegram.length}`; },
      sleep: async () => {},
    },
  };
}

// Conta ativa configurada pelos caminhos da tela; WhatsApp sempre, Telegram opcional
async function newAccount(opts: { telegram?: boolean; plan?: 'start' | 'pro' | 'escala' } = {}) {
  const id = randomUUID();
  await m.db.q(`INSERT INTO accounts (id, name, plan, status) VALUES ($1, 'Loja', $2, 'active')`, [id, opts.plan ?? 'escala']);
  const account = (await m.accounts.getAccount(id))!;
  const p = await m.plans.effectivePlan(account);
  // Configura pelos mesmos caminhos da tela (segredos criptografados)
  expect((await m.settings.saveSection(id, p, 'shopee', { shopeeAppId: '18312345678', shopeeSecret: 'segredo-shopee-teste' })).ok).toBe(true);
  await m.settings.setSettingsRaw(id, { whatsappEnabled: true, whatsappGroupJid: '120363000000000000@g.us', whatsappGroupName: 'Ofertas' });
  if (opts.telegram) {
    const r = await m.settings.saveSection(id, p, 'telegram', {
      telegramEnabled: true, telegramBotToken: '123456789:AAEhBP0av18bHkzLcNoP4Z6S0rQf9rTeste', telegramChatId: '@canalteste',
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
  return account;
}

// Executa a rodada e exige que ela tenha sido concluída (não pulada)
async function runDone(account: Awaited<ReturnType<typeof newAccount>>, deps: Parameters<typeof m.pipeline.runAccount>[2]) {
  const out = await m.pipeline.runAccount(account, 'manual', deps);
  if (out.status !== 'done') throw new Error(`rodada não concluída: ${out.reason}`);
  return out;
}

const deliveries = (runId: number) => m.db.q<{ channel: string; success: boolean; item_id: string; message_id: string }>(
  'SELECT channel, success, item_id, message_id FROM deliveries WHERE run_id = $1 ORDER BY channel, item_id', [runId]);

suite('Rodada da esteira (integração)', () => {
  beforeAll(async () => {
    if (!/test/.test(DB!)) throw new Error('TEST_DATABASE_URL precisa apontar para um banco de teste');
    const { Pool } = await import('pg');
    const admin = new Pool({ connectionString: DB });
    await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await admin.end();
    m = {
      db: await import('@/server/db'), pipeline: await import('@/server/pipeline'), accounts: await import('@/server/accounts'),
      settings: await import('@/server/settings'), plans: await import('@/server/plans'),
    };
    await m.db.migrate();
  });

  afterAll(async () => { await m?.db.pool().end(); });

  it('publica as ofertas selecionadas pelos remetentes recebidos e registra as entregas por canal', async () => {
    const account = await newAccount({ telegram: true });
    const f = fakes();

    const out = await runDone(account, f.deps);

    expect(out).toMatchObject({ status: 'done', found: 2, published: 2, failures: 0 });
    expect(await deliveries(out.runId)).toEqual([
      { channel: 'telegram', success: true, item_id: '111', message_id: 'tg-1' },
      { channel: 'telegram', success: true, item_id: '222', message_id: 'tg-2' },
      { channel: 'whatsapp', success: true, item_id: '111', message_id: 'wa-1' },
      { channel: 'whatsapp', success: true, item_id: '222', message_id: 'wa-2' },
    ]);
    expect(f.sent.whatsapp.map((s) => s.jid)).toEqual(['120363000000000000@g.us', '120363000000000000@g.us']);
    expect(f.sent.telegram.map((s) => s.chatId)).toEqual(['@canalteste', '@canalteste']);
    expect(f.sent.whatsapp[0].caption).toContain('?curto=1');                  // link curto da Shopee na legenda
  });

  it('com o WhatsApp desconectado, publica só pelo Telegram', async () => {
    const account = await newAccount({ telegram: true });
    const f = fakes({ waState: 'close' });

    const out = await runDone(account, f.deps);

    expect(out).toMatchObject({ status: 'done', published: 2, failures: 0 });
    expect((await deliveries(out.runId)).map((d) => d.channel)).toEqual(['telegram', 'telegram']);
    expect(f.sent.whatsapp).toEqual([]);
  });

  it('não reenvia em outra rodada o mesmo produto reanunciado com outro itemId', async () => {
    const account = await newAccount();
    const f = fakes();
    await runDone(account, f.deps);
    f.deps.searchOffers = async () => [offer('333', 'garrafa  térmica 1l'), offer('444', 'Air Fryer 5L')];

    const out = await runDone((await m.accounts.getAccount(account.id))!, f.deps);

    expect((await deliveries(out.runId)).map((d) => d.item_id)).toEqual(['444']);
  });

  it('registra a falha de um envio e continua pelo outro canal', async () => {
    const account = await newAccount({ telegram: true });
    const f = fakes();
    f.deps.waSendImage = async () => { throw new Error('Evolution fora do ar'); };

    const out = await runDone(account, f.deps);

    expect(out).toMatchObject({ status: 'done', published: 2, failures: 2 });
    const rows = await deliveries(out.runId);
    expect(rows.filter((d) => d.channel === 'whatsapp').map((d) => d.success)).toEqual([false, false]);
    expect(rows.filter((d) => d.channel === 'telegram').map((d) => d.success)).toEqual([true, true]);
  });
});
