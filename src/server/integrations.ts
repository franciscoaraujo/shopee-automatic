/* eslint-disable @typescript-eslint/no-explicit-any -- respostas JSON de APIs externas, sem tipagem oficial */
// Chamadas às APIs externas: Shopee Affiliate, Telegram Bot API e Evolution API.
import { createHash } from 'node:crypto';

const SHOPEE_URL = 'https://open-api.affiliate.shopee.com.br/graphql';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type JsonRes<T = unknown> = { status: number; ok: boolean; body: T };

export async function fetchJson<T = any>(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<JsonRes<T>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* texto puro */ }
    return { status: res.status, ok: res.ok, body: body as T };
  } finally {
    clearTimeout(t);
  }
}

export function describeError(err: unknown): string {
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string } };
  const code = e.cause?.code || e.code;
  if (e.name === 'AbortError') return 'Sem resposta (tempo esgotado)';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Servidor não encontrado';
  if (code === 'ECONNREFUSED') return 'Conexão recusada';
  return e.message || 'Erro desconhecido';
}

export type Result = { ok: boolean; message: string };

/* ------------------------------------------------------------------ Shopee */
export class ShopeeError extends Error {
  constructor(message: string, public code?: number, public transient = false) { super(message); }
}

// Assinatura: SHA256(AppID + Timestamp + Payload + Secret)
export async function shopeeGql<T = any>(creds: { appId: string; secret: string }, query: string, attempts = 4): Promise<T> {
  let last: ShopeeError | null = null;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(1500 * i);
    const payload = JSON.stringify({ query });
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHash('sha256').update(`${creds.appId}${ts}${payload}${creds.secret}`, 'utf8').digest('hex');
    let r: JsonRes<{ data?: T; errors?: { message: string; extensions?: { code?: number; message?: string } }[] }>;
    try {
      r = await fetchJson(SHOPEE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `SHA256 Credential=${creds.appId}, Timestamp=${ts}, Signature=${sig}` },
        body: payload,
      }, 30000);
    } catch (err) {
      last = new ShopeeError(`Shopee indisponível: ${describeError(err)}`, undefined, true);
      continue;
    }
    const e = r.body?.errors?.[0];
    if (e) {
      const code = e.extensions?.code;
      const msg = e.extensions?.message || e.message;
      // 10000 = erro interno da Shopee (intermitente); 10030 = limite de requisições
      const transient = code === 10000 || code === 10030;
      last = new ShopeeError(`Shopee${code ? ` [${code}]` : ''}: ${msg}`, code, transient);
      if (transient) continue;
      throw last;
    }
    if (!r.ok) { last = new ShopeeError(`Shopee respondeu HTTP ${r.status}`, undefined, r.status >= 500); if (r.status >= 500) continue; throw last; }
    return r.body.data as T;
  }
  throw last ?? new ShopeeError('Falha desconhecida na Shopee');
}

export type Offer = {
  itemId: string; productName: string; productLink: string; offerLink: string; imageUrl: string;
  priceMin: string; priceMax: string; priceDiscountRate: number; commissionRate: string; commission: string;
  sales: number; ratingStar: string; shopName: string; periodEndTime: number;
};

export async function searchOffers(creds: { appId: string; secret: string }, args: { keyword?: string; sortType: number; page: number; limit: number }) {
  const a = [`sortType: ${args.sortType}`, `page: ${args.page}`, `limit: ${args.limit}`];
  if (args.keyword) a.unshift(`keyword: ${JSON.stringify(args.keyword)}`);
  const data = await shopeeGql<{ productOfferV2: { nodes: Offer[] } }>(creds, `query { productOfferV2(${a.join(', ')}) {
    nodes { itemId productName productLink offerLink imageUrl priceMin priceMax priceDiscountRate commissionRate commission sales ratingStar shopName periodEndTime }
  } }`);
  return data.productOfferV2?.nodes ?? [];
}

export async function shortLink(creds: { appId: string; secret: string }, originUrl: string, subIds: string[]) {
  const data = await shopeeGql<{ generateShortLink: { shortLink: string } }>(
    creds,
    `mutation { generateShortLink(input: { originUrl: ${JSON.stringify(originUrl)}, subIds: ${JSON.stringify(subIds)} }) { shortLink } }`
  );
  return data.generateShortLink.shortLink;
}

export async function testShopee(appId: string | null, secret: string | null): Promise<Result> {
  if (!appId || !secret) return { ok: false, message: 'Informe App ID e Secret' };
  try {
    const nodes = await searchOffers({ appId, secret }, { sortType: 2, page: 1, limit: 1 });
    return { ok: true, message: nodes[0] ? `Conectado · ex.: ${nodes[0].productName.slice(0, 60)}` : 'Conectado' };
  } catch (err) {
    return { ok: false, message: err instanceof ShopeeError ? err.message : describeError(err) };
  }
}

/* ------------------------------------------------------------------ Telegram */
export async function testTelegram(token: string | null, chatId: string | null): Promise<Result> {
  if (!token) return { ok: false, message: 'Informe o token do bot' };
  try {
    const base = `https://api.telegram.org/bot${token}`;
    const me = await fetchJson(`${base}/getMe`, {}, 10000);
    if (!me.body?.ok) return { ok: false, message: `Token recusado: ${me.body?.description || `HTTP ${me.status}`}` };
    const bot = `@${me.body.result.username}`;
    if (!chatId) return { ok: true, message: `Bot ${bot} válido · informe o canal` };
    const chat = await fetchJson(`${base}/getChat?chat_id=${encodeURIComponent(chatId)}`, {}, 10000);
    if (!chat.body?.ok) return { ok: false, message: `Canal não encontrado: ${chat.body?.description || chat.status}` };
    const c = chat.body.result;
    const title = c.title || c.username || c.id;
    if (c.id === me.body.result.id) return { ok: false, message: `${chatId} é o próprio bot — informe o canal ou grupo de destino` };
    if (c.type === 'private') return { ok: false, message: `“${title}” é uma conversa privada — use um canal ou grupo` };
    const member = await fetchJson(`${base}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${me.body.result.id}`, {}, 10000);
    const st = member.body?.result?.status;
    if (c.type === 'channel' && st !== 'administrator' && st !== 'creator') return { ok: false, message: `${bot} não é administrador de “${title}”` };
    if (member.body?.result?.can_post_messages === false) return { ok: false, message: `${bot} não tem permissão para publicar em “${title}”` };
    return { ok: true, message: `${bot} pode publicar em “${title}”` };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

export async function telegramSendPhoto(token: string, chatId: string, photo: string, caption: string) {
  const r = await fetchJson(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, photo, caption, parse_mode: 'Markdown' }),
  }, 30000);
  if (!r.body?.ok) throw new Error(r.body?.description || `HTTP ${r.status}`);
  return String(r.body.result?.message_id ?? '');
}

/* ------------------------------------------------------------------ Evolution (WhatsApp) */
function evo() {
  const url = (process.env.EVOLUTION_API_URL || 'http://localhost:8080').replace(/\/+$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY || '';
  if (!apiKey) throw new Error('EVOLUTION_API_KEY não configurada no servidor');
  return { url, headers: { apikey: apiKey, 'content-type': 'application/json' } };
}

// Uma instância por conta, com nome derivado do ID (o cliente não escolhe)
export const instanceName = (accountId: string) => `aa_${accountId.replace(/-/g, '')}`;

export type WaState = 'open' | 'connecting' | 'close' | 'missing' | 'error';

export async function waState(accountId: string): Promise<{ state: WaState; error?: string }> {
  try {
    const e = evo();
    const r = await fetchJson(`${e.url}/instance/connectionState/${instanceName(accountId)}`, { headers: e.headers }, 8000);
    if (r.status === 404) return { state: 'missing' };
    if (!r.ok) return { state: 'error', error: `Evolution respondeu HTTP ${r.status}` };
    const s = r.body?.instance?.state || r.body?.state;
    return { state: s === 'open' || s === 'connecting' ? s : 'close' };
  } catch (err) {
    return { state: 'error', error: describeError(err) };
  }
}

// Cria a instância (se preciso) e devolve o QR Code em data URL
export async function waConnect(accountId: string): Promise<{ qr: string | null; pairingCode: string | null; state: WaState }> {
  const e = evo();
  const name = instanceName(accountId);
  const st = await waState(accountId);
  if (st.state === 'open') return { qr: null, pairingCode: null, state: 'open' };
  if (st.state === 'error') throw new Error(st.error);
  if (st.state === 'missing') {
    const c = await fetchJson(`${e.url}/instance/create`, {
      method: 'POST',
      headers: e.headers,
      body: JSON.stringify({ instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true, groupsIgnore: false }),
    }, 30000);
    if (!c.ok && c.status !== 403) throw new Error(`Não foi possível criar a conexão (HTTP ${c.status})`);
    const qr = c.body?.qrcode?.base64;
    if (qr) return { qr, pairingCode: c.body?.qrcode?.pairingCode ?? null, state: 'connecting' };
  }
  const r = await fetchJson(`${e.url}/instance/connect/${name}`, { headers: e.headers }, 20000);
  if (!r.ok) throw new Error(`Evolution respondeu HTTP ${r.status}`);
  if (r.body?.instance?.state === 'open') return { qr: null, pairingCode: null, state: 'open' };
  return { qr: r.body?.base64 ?? null, pairingCode: r.body?.pairingCode ?? null, state: 'connecting' };
}

export async function waLogout(accountId: string) {
  const e = evo();
  await fetchJson(`${e.url}/instance/logout/${instanceName(accountId)}`, { method: 'DELETE', headers: e.headers }, 15000).catch(() => null);
  await fetchJson(`${e.url}/instance/delete/${instanceName(accountId)}`, { method: 'DELETE', headers: e.headers }, 15000).catch(() => null);
}

export async function waGroups(accountId: string): Promise<{ id: string; subject: string; size: number | null }[]> {
  const e = evo();
  const r = await fetchJson(`${e.url}/group/fetchAllGroups/${instanceName(accountId)}?getParticipants=false`, { headers: e.headers }, 45000);
  if (!r.ok) throw new Error(`Não foi possível listar os grupos (HTTP ${r.status})`);
  const list: any[] = Array.isArray(r.body) ? r.body : r.body?.groups || [];
  return list
    .filter((g) => g?.id && String(g.id).endsWith('@g.us'))
    .map((g) => ({ id: String(g.id), subject: String(g.subject || g.id), size: g.size ?? g.participants?.length ?? null }))
    .sort((a, b) => a.subject.localeCompare(b.subject, 'pt-BR'));
}

export async function waSendImage(accountId: string, jid: string, imageUrl: string, caption: string, fileName: string) {
  const e = evo();
  const r = await fetchJson(`${e.url}/message/sendMedia/${instanceName(accountId)}`, {
    method: 'POST',
    headers: e.headers,
    body: JSON.stringify({ number: jid, mediatype: 'image', mimetype: 'image/jpeg', media: imageUrl, fileName, caption }),
  }, 60000);
  if (!r.ok) {
    const msg = r.body?.response?.message;
    throw new Error(Array.isArray(msg) ? msg.map((m: any) => (typeof m === 'string' ? m : JSON.stringify(m))).join('; ') : msg || `HTTP ${r.status}`);
  }
  return String(r.body?.key?.id ?? '');
}
