// Conexão do WhatsApp com confirmação de número dedicado (ticket #3), com PostgreSQL real.
// A Evolution é substituída por um dublê que existe só aqui.
// Rode com: npm run test:integration:docker
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DB = process.env.TEST_DATABASE_URL;
const suite = DB ? describe : describe.skip;
process.env.DATABASE_URL = DB;
process.env.APP_MASTER_KEY ??= 'a'.repeat(64);

type Mods = {
  db: typeof import('@/server/db');
  accounts: typeof import('@/server/accounts');
  wa: typeof import('@/server/whatsapp-connection');
};
let m: Mods;

// Dublê da Evolution: conta quantas vezes um QR Code foi pedido
function fakeEvolution() {
  const calls: string[] = [];
  return { calls, connect: async (accountId: string) => { calls.push(accountId); return { qr: 'data:image/png;base64,QR', pairingCode: null, state: 'connecting' as const }; } };
}

async function newAccount() {
  const id = randomUUID();
  await m.db.q(`INSERT INTO accounts (id, name, plan, status) VALUES ($1, 'Loja', 'pro', 'active')`, [id]);
  return id;
}

suite('Conexão do WhatsApp com número dedicado (integração)', () => {
  beforeAll(async () => {
    if (!/test/.test(DB!)) throw new Error('TEST_DATABASE_URL precisa apontar para um banco de teste');
    const { Pool } = await import('pg');
    const admin = new Pool({ connectionString: DB });
    await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await admin.end();
    m = { db: await import('@/server/db'), accounts: await import('@/server/accounts'), wa: await import('@/server/whatsapp-connection') };
    await m.db.migrate();
  });

  afterAll(async () => { await m?.db.pool().end(); });

  it('não gera QR Code sem a confirmação de número dedicado', async () => {
    const id = await newAccount();
    const evo = fakeEvolution();

    const r = await m.wa.connectWhatsApp(id, { dedicatedNumberConfirmed: false }, evo.connect);

    expect(r).toMatchObject({ qr: null, state: 'error', error: expect.stringMatching(/número dedicado/) });
    expect(evo.calls).toEqual([]);
  });

  it('com a confirmação, gera o QR Code e registra a data da confirmação na conta', async () => {
    const id = await newAccount();
    const evo = fakeEvolution();
    const before = Date.now();

    const r = await m.wa.connectWhatsApp(id, { dedicatedNumberConfirmed: true }, evo.connect);

    expect(r).toMatchObject({ qr: 'data:image/png;base64,QR', state: 'connecting' });
    expect(evo.calls).toEqual([id]);
    const confirmedAt = (await m.accounts.getAccount(id))!.whatsapp_dedicated_confirmed_at;
    expect(confirmedAt).toBeInstanceOf(Date);
    expect(confirmedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('depois de confirmar uma vez, aceita a renovação do QR Code e mantém a data da primeira confirmação', async () => {
    const id = await newAccount();
    const evo = fakeEvolution();
    await m.wa.connectWhatsApp(id, { dedicatedNumberConfirmed: true }, evo.connect);
    const first = (await m.accounts.getAccount(id))!.whatsapp_dedicated_confirmed_at!.getTime();

    const renewal = await m.wa.connectWhatsApp(id, { dedicatedNumberConfirmed: false }, evo.connect);

    expect(renewal).toMatchObject({ qr: 'data:image/png;base64,QR', state: 'connecting' });
    expect(evo.calls).toEqual([id, id]);
    expect((await m.accounts.getAccount(id))!.whatsapp_dedicated_confirmed_at!.getTime()).toBe(first);
  });
});
