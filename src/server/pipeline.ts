// Uma rodada da esteira para UMA conta:
// busca → filtra → gera links → formata → publica → registra.
// Porta a lógica dos Code Nodes do n8n (versão n8n removida; ver commit 8dfacda) para o modelo multi-tenant.
import { effectiveInterval } from '@/lib/plans';
import { effectivePlan } from './plans';
import { effectiveSchedule, isWithin, nextOpening } from '@/lib/schedule';
import type { Settings } from '@/lib/settings-schema';
import type { Account } from './accounts';
import { one, q } from './db';
import { describeError, searchOffers, shortLink, telegramSendPhoto, waSendImage, waState, type Offer } from './integrations';
import { getSettings, readiness } from './settings';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const escTg = (s: string) => String(s ?? '').replace(/([_*`[])/g, '\\$1');
const cleanWa = (s: string) => String(s ?? '').replace(/[*_~`]/g, '');
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trim() + '…' : s);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const sanitize = (s: unknown) => String(s ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 50);

const HOOKS = ['🚨 ACHADO DO DIA NA SHOPEE! 🚨', '🔥 PROMOÇÃO RELÂMPAGO! 🔥', '💥 PREÇO DE ERRO? CORRE! 💥', '⚡ OFERTA IMPERDÍVEL ⚡', '🛍️ ACHADINHO SHOPEE 🛍️'];
const URGENCY = ['⏳ Estoque limitado — pode acabar a qualquer momento!', '⚠️ Preço promocional por tempo limitado!', '🏃 Últimas unidades com esse valor!', '⌛ Oferta válida enquanto durar o estoque!'];

const directImage = (img: string) => (/^https?:\/\//i.test(img) ? img.replace(/^http:/i, 'https:') : `https://down-br.img.susercontent.com/file/${img}`);

export type Selected = {
  itemId: string; productName: string; originUrl: string; imageUrl: string; price: number; discount: number;
  commissionRate: number; commission: number; sales: number; rating: number;
  productLink?: string | null; shopName?: string | null;
};

export function formatCaptions(p: Selected, link: string) {
  const oldPrice = p.discount > 0 && p.discount < 100 ? p.price / (1 - p.discount / 100) : null;
  const title = truncate(String(p.productName || 'Oferta Shopee').trim(), 120);
  const hook = pick(HOOKS);
  const urgency = pick(URGENCY);
  const social = [p.rating ? `⭐ ${p.rating.toFixed(1)}` : '', p.sales ? `🛒 +${p.sales.toLocaleString('pt-BR')} vendidos` : ''].filter(Boolean).join('  |  ');
  const off = p.discount ? `  (-${p.discount}% OFF)` : '';

  let telegram = [
    `*${escTg(hook)}*`, '', `📦 *${escTg(title)}*`, '',
    oldPrice ? `❌ De: ${escTg(brl(oldPrice))}` : null,
    `✅ *Por: ${escTg(brl(p.price))}*${off}`,
    social ? escTg(social) : null, '', escTg(urgency), '', `👉 [COMPRAR AGORA](${link})`,
  ].filter((l) => l !== null).join('\n');
  if (telegram.length > 1024) telegram = telegram.slice(0, 1020) + '…';

  const whatsapp = [
    `*${hook}*`, '', `📦 *${cleanWa(title)}*`, '',
    oldPrice ? `❌ De: ~${brl(oldPrice)}~` : null,
    `✅ *Por: ${brl(p.price)}*${off}`,
    social || null, '', urgency, '', `👉 *COMPRE AQUI:* ${link}`,
  ].filter((l) => l !== null).join('\n');

  return { telegram, whatsapp };
}

export function selectOffers(nodes: Offer[], s: Settings, maxPosts: number, alreadySent: Set<string>, nowSec = Math.floor(Date.now() / 1000)): Selected[] {
  return nodes
    .filter((p) => p?.itemId && p.imageUrl && (p.offerLink || p.productLink))
    .filter((p) => !alreadySent.has(String(p.itemId)))
    .filter((p) => !p.periodEndTime || Number(p.periodEndTime) === 0 || Number(p.periodEndTime) > nowSec)
    .filter((p) => (parseFloat(p.commissionRate) || 0) >= s.minCommissionRate)
    .filter((p) => (parseFloat(p.ratingStar) || 0) >= s.minRating)
    .sort((a, b) => (parseFloat(b.commission) || 0) - (parseFloat(a.commission) || 0))
    .slice(0, maxPosts)
    .map((p) => ({
      itemId: String(p.itemId),
      productName: p.productName,
      originUrl: p.offerLink || p.productLink,
      imageUrl: directImage(p.imageUrl),
      price: parseFloat(p.priceMin) || 0,
      discount: Number(p.priceDiscountRate) || 0,
      commissionRate: parseFloat(p.commissionRate) || 0,
      commission: parseFloat(p.commission) || 0,
      sales: Number(p.sales) || 0,
      rating: parseFloat(p.ratingStar) || 0,
      productLink: p.productLink || null,
      shopName: p.shopName || null,
    }));
}

export type RunOutcome = { status: 'skipped'; reason: string } | { status: 'done'; runId: number; found: number; published: number; failures: number; error?: string };

export async function runAccount(account: Account, trigger: 'schedule' | 'manual' = 'schedule'): Promise<RunOutcome> {
  const started = Date.now();
  const s = await getSettings(account.id);
  const plan = await effectivePlan(account);

  // Canais efetivos (respeitando o limite do plano: com 1 canal, o WhatsApp tem prioridade)
  let useWa = s.whatsappEnabled && !!s.whatsappGroupJid;
  let useTg = s.telegramEnabled && !!s.telegramBotToken && !!s.telegramChatId;
  if (useWa && useTg && plan.maxChannels < 2) useTg = false;

  // Próxima rodada pelo ciclo que o cliente escolheu (respeitando o mínimo do plano).
  // Rodada manual não mexe no agendamento.
  if (trigger === 'schedule') {
    await q(`UPDATE accounts SET next_run_at = now() + $2 * interval '1 minute' WHERE id = $1`, [account.id, effectiveInterval(plan, s.runIntervalMin)]);
  }

  // Janela de envio (regras do plano + escolha do cliente). Rodada manual é ação explícita e não é bloqueada.
  const schedule = effectiveSchedule(plan, s);
  if (trigger === 'schedule' && !isWithin(schedule)) {
    const next = nextOpening(schedule);
    // Dorme até a próxima abertura em vez de acordar a cada intervalo
    await q('UPDATE accounts SET next_run_at = $2 WHERE id = $1', [account.id, next ?? new Date(Date.now() + 86_400_000)]);
    return { status: 'skipped', reason: 'Fora do horário de envio' };
  }

  if (!s.shopeeAppId || !s.shopeeSecret) return { status: 'skipped', reason: 'Shopee não configurada' };
  if (useWa) {
    const st = await waState(account.id);
    if (st.state !== 'open') useWa = false;
  }
  if (!useWa && !useTg) {
    const r = readiness(s, null);
    return { status: 'skipped', reason: r.ready ? 'WhatsApp desconectado' : 'Nenhum canal configurado' };
  }

  // Rodízio de palavra-chave e página (estado no banco, por conta)
  const keywords = s.keywords.split(',').map((k) => k.trim()).filter(Boolean);
  const kwIndex = keywords.length ? (account.kw_index + 1) % keywords.length : -1;
  const keyword = kwIndex >= 0 ? keywords[kwIndex] : '';
  const page = (account.page % 3) + 1;
  await q('UPDATE accounts SET kw_index = $2, page = $3 WHERE id = $1', [account.id, kwIndex, page]);

  const creds = { appId: s.shopeeAppId, secret: s.shopeeSecret };
  const maxPosts = Math.min(s.maxPostsPerRun, plan.maxPerRun);

  let nodes: Offer[] = [];
  let searchError: string | null = null;
  try {
    nodes = await searchOffers(creds, { keyword, sortType: s.sortType, page, limit: 30 });
  } catch (err) {
    searchError = describeError(err);
  }

  // Deduplicação: itens enviados dentro do prazo
  const sentRows = await q<{ item_id: string }>(
    `SELECT item_id FROM sent_items WHERE account_id = $1 AND sent_at > now() - ($2 || ' days')::interval`,
    [account.id, String(s.dedupDays)]
  );
  const selected = searchError ? [] : selectOffers(nodes, s, maxPosts, new Set(sentRows.map((r) => r.item_id)));

  const run = await one<{ id: number }>(
    `INSERT INTO runs (account_id, trigger, keyword, page, sort_type, found, selected, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [account.id, trigger, keyword || null, page, s.sortType, nodes.length, selected.length, searchError]
  );
  const runId = run!.id;

  let published = 0;
  let failures = 0;
  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  for (const [i, p] of selected.entries()) {
    let link = p.originUrl;
    try {
      link = await shortLink(creds, p.originUrl, [s.subIdCampaign, 'autoachados', dateTag, p.itemId].map(sanitize).filter(Boolean).slice(0, 5));
    } catch {
      // sem link curto, usa o offerLink (já é link de afiliado)
    }
    const cap = formatCaptions(p, link);
    let anyOk = false;

    const record = (channel: string, ok: boolean, error: string | null, messageId: string | null) =>
      q(
        `INSERT INTO deliveries (account_id, run_id, channel, item_id, product_name, price, commission_rate, commission, affiliate_link, image_url, success, error, message_id, discount_rate, product_link, shop_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [account.id, runId, channel, p.itemId, p.productName, p.price, p.commissionRate, p.commission, link, p.imageUrl, ok, error, messageId,
         p.discount || null, p.productLink ?? null, p.shopName ?? null]
      );

    if (useWa) {
      try {
        const id = await waSendImage(account.id, s.whatsappGroupJid!, p.imageUrl, cap.whatsapp, `oferta-${p.itemId}.jpg`);
        await record('whatsapp', true, null, id);
        anyOk = true;
      } catch (err) {
        await record('whatsapp', false, describeError(err), null);
        failures++;
      }
    }
    if (useTg) {
      try {
        const id = await telegramSendPhoto(s.telegramBotToken!, s.telegramChatId!, p.imageUrl, cap.telegram);
        await record('telegram', true, null, id);
        anyOk = true;
      } catch (err) {
        await record('telegram', false, describeError(err), null);
        failures++;
      }
    }
    if (anyOk) {
      published++;
      await q(
        `INSERT INTO sent_items (account_id, item_id) VALUES ($1, $2) ON CONFLICT (account_id, item_id) DO UPDATE SET sent_at = now()`,
        [account.id, p.itemId]
      );
    }
    // Espaça as mensagens para não parecer spam
    if (i < selected.length - 1) await sleep(useWa ? 8000 : 3000);
  }

  await q('UPDATE runs SET duration_ms = $2 WHERE id = $1', [runId, Date.now() - started]);
  return { status: 'done', runId, found: nodes.length, published, failures, error: searchError ?? undefined };
}
