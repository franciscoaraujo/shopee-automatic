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
  groups: typeof import('@/server/wa-groups');
  metrics: typeof import('@/server/metrics');
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

const GRUPO = '120363000000000000@g.us';

// Conta ativa configurada pelos caminhos da tela; WhatsApp sempre (um grupo, salvo outros), Telegram opcional
async function newAccount(opts: { telegram?: boolean; plan?: 'start' | 'pro' | 'escala'; groups?: string[] } = {}) {
  const id = randomUUID();
  await m.db.q(`INSERT INTO accounts (id, name, plan, status) VALUES ($1, 'Loja', $2, 'active')`, [id, opts.plan ?? 'escala']);
  const account = (await m.accounts.getAccount(id))!;
  const p = await m.plans.effectivePlan(account);
  // Configura pelos mesmos caminhos da tela (segredos criptografados)
  expect((await m.settings.saveSection(id, p, 'shopee', { shopeeAppId: '18312345678', shopeeSecret: 'segredo-shopee-teste' })).ok).toBe(true);
  await m.settings.setSettingsRaw(id, { whatsappEnabled: true });
  for (const [i, jid] of (opts.groups ?? [GRUPO]).entries()) {
    expect(await m.groups.addWaGroup(id, { jid, name: `Grupo ${i + 1}` }, 50)).toEqual({ ok: true });
  }
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
      groups: await import('@/server/wa-groups'), metrics: await import('@/server/metrics'),
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

  describe('vários grupos de WhatsApp', () => {
    const G = ['120363000000000001@g.us', '120363000000000002@g.us', '120363000000000003@g.us'];
    const targets = (runId: number) => m.db.q<{ target: string; item_id: string }>(
      `SELECT target, item_id FROM deliveries WHERE run_id = $1 AND channel = 'whatsapp' ORDER BY item_id, target`, [runId]);

    it('publica cada oferta em todos os grupos e registra o grupo de cada envio', async () => {
      const account = await newAccount({ plan: 'escala', groups: G });
      const f = fakes();

      const out = await runDone(account, f.deps);

      expect(out).toMatchObject({ published: 2, failures: 0 });
      expect(f.sent.whatsapp.map((x) => x.jid)).toEqual([...G, ...G]);
      expect(await targets(out.runId)).toEqual(['111', '222'].flatMap((item) => G.map((target) => ({ target, item_id: item }))));
    });

    it('acima do limite do plano, só os grupos mais antigos recebem', async () => {
      const account = await newAccount({ plan: 'start', groups: G }); // Start: 1 grupo
      const f = fakes();

      await runDone(account, f.deps);

      expect([...new Set(f.sent.whatsapp.map((x) => x.jid))]).toEqual([G[0]]);
    });

    it('não deixa adicionar além do limite nem repetir grupo', async () => {
      const account = await newAccount({ plan: 'pro', groups: [] });
      const limit = (await m.plans.effectivePlan(account)).maxWaGroups;
      expect(limit).toBe(3);

      for (const jid of G) expect(await m.groups.addWaGroup(account.id, { jid, name: '' }, limit)).toEqual({ ok: true });
      expect(await m.groups.addWaGroup(account.id, { jid: '120363000000000009@g.us', name: '' }, limit)).toEqual({ ok: false, reason: 'limit' });
      await m.groups.removeWaGroup(account.id, G[2]);
      expect(await m.groups.addWaGroup(account.id, { jid: G[0], name: '' }, limit)).toEqual({ ok: false, reason: 'exists' });
      expect((await m.groups.listWaGroups(account.id)).map((g) => g.jid)).toEqual([G[0], G[1]]);
      // O primeiro grupo continua espelhado na configuração antiga (lida pelo admin separado)
      expect((await m.settings.getSettings(account.id)).whatsappGroupJid).toBe(G[0]);
    });

    it('aponta o grupo com falhas seguidas, sem misturar com os que funcionam', async () => {
      const account = await newAccount({ plan: 'escala', groups: G.slice(0, 2) });
      const f = fakes();
      f.deps.waSendImage = async (_acc: string, jid: string) => { if (jid === G[1]) throw new Error('not-authorized'); return 'ok'; };

      await runDone(account, f.deps);
      await runDone(account, { ...f.deps, searchOffers: async () => [offer('333', 'Air Fryer 5L')] });

      expect(await m.metrics.failureStreaks(account.id)).toMatchObject({ whatsapp: true, whatsappGroups: [G[1]] });
    });

    it('migra uma única vez o grupo que estava na configuração antiga', async () => {
      const remigrate = async () => { (globalThis as { __migrated?: unknown }).__migrated = undefined; await m.db.migrate(); };
      const id = randomUUID();
      await m.db.q(`INSERT INTO accounts (id, name, plan, status) VALUES ($1, 'Legado', 'pro', 'active')`, [id]);
      await m.db.q(`INSERT INTO account_settings (account_id, key, value) VALUES ($1, 'whatsappGroupJid', $2), ($1, 'whatsappGroupName', '"Ofertas da Lu"')`,
        [id, JSON.stringify(G[0])]);

      await m.db.q(`DELETE FROM system_kv WHERE key = 'once:wa_groups_v1'`);       // como num banco que ainda não migrou
      await remigrate();
      expect(await m.groups.listWaGroups(id)).toEqual([{ jid: G[0], name: 'Ofertas da Lu' }]);

      await m.groups.removeWaGroup(id, G[0]);                                      // o cliente remove o grupo
      await m.db.q(`UPDATE account_settings SET value = $2 WHERE account_id = $1 AND key = 'whatsappGroupJid'`, [id, JSON.stringify(G[0])]);
      await remigrate();                                                           // reinício não traz de volta
      expect(await m.groups.listWaGroups(id)).toEqual([]);
    });
  });
});
