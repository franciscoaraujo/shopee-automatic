// =====================================================================
// Code Node: "Formatar Copy"   (Mode: Run Once for All Items)
// Junta o produto (nó "Assinar generateShortLink") com a resposta da
// mutation (pela mesma posição), formata BRL, monta as legendas do
// Telegram (Markdown) e WhatsApp e extrai a URL direta da imagem.
// Marca o itemId como enviado para não repetir a oferta.
// =====================================================================
const products = $('Assinar generateShortLink').all();
const responses = $input.all();
const staticData = $getWorkflowStaticData('global');
staticData.sent = staticData.sent || {};

const brl = (v) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);

// Escape do Markdown legado do Telegram (_ * ` [)
const escTg = (s) => String(s ?? '').replace(/([_*`\[])/g, '\\$1');
// WhatsApp não tem escape: remove caracteres de formatação do título
const cleanWa = (s) => String(s ?? '').replace(/[*_~`]/g, '');

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1).trim() + '…' : s);

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const hooks = [
  '🚨 ACHADO DO DIA NA SHOPEE! 🚨',
  '🔥 PROMOÇÃO RELÂMPAGO! 🔥',
  '💥 PREÇO DE ERRO? CORRE! 💥',
  '⚡ OFERTA IMPERDÍVEL ⚡',
  '🛍️ ACHADINHO SHOPEE 🛍️',
];
const scarcity = [
  '⏳ Estoque limitado — pode acabar a qualquer momento!',
  '⚠️ Preço promocional por tempo limitado!',
  '🏃 Últimas unidades com esse valor!',
  '⌛ Oferta válida enquanto durar o estoque!',
];

// Extrai a URL direta da imagem (Shopee às vezes retorna só o hash do arquivo)
const directImage = (img) => {
  if (!img) return null;
  const s = String(img).trim();
  if (/^https?:\/\//i.test(s)) return s.replace(/^http:/i, 'https:');
  return `https://down-br.img.susercontent.com/file/${s}`;
};

const out = [];

responses.forEach((resItem, i) => {
  const p = products[i]?.json;
  if (!p) return;

  const r = resItem.json;
  if (Array.isArray(r.errors) && r.errors.length) {
    const e = r.errors[0];
    console.log(`generateShortLink falhou para ${p.itemId}: ${e.extensions?.message || e.message}`);
    return; // pula o produto, não interrompe os outros
  }

  const link = r?.data?.generateShortLink?.shortLink || p.offerLink || p.productLink;

  const price = p.priceMin;
  const discount = p.priceDiscountRate;
  const oldPrice = discount > 0 && discount < 100 ? price / (1 - discount / 100) : null;

  const title = truncate(String(p.productName || 'Oferta Shopee').trim(), 120);
  const hook = pick(hooks);
  const urgency = pick(scarcity);
  const rating = p.ratingStar ? `⭐ ${p.ratingStar.toFixed(1)}` : '';
  const sold = p.sales ? `🛒 +${p.sales.toLocaleString('pt-BR')} vendidos` : '';
  const social = [rating, sold].filter(Boolean).join('  |  ');

  // ---------- Telegram (parse_mode: Markdown, máx. 1024 chars) ----------
  const tgLines = [
    `*${escTg(hook)}*`,
    '',
    `📦 *${escTg(title)}*`,
    '',
    oldPrice ? `❌ De: ${escTg(brl(oldPrice))}` : null, // Markdown legado não tem riscado
    `✅ *Por: ${escTg(brl(price))}*${discount ? `  (-${discount}% OFF)` : ''}`,
    social ? escTg(social) : null,
    '',
    escTg(urgency),
    '',
    `👉 [COMPRAR AGORA](${link})`,
  ].filter((l) => l !== null);
  let telegramCaption = tgLines.join('\n');
  if (telegramCaption.length > 1024) telegramCaption = telegramCaption.slice(0, 1020) + '…';

  // ---------- WhatsApp (*negrito*, ~riscado~) ----------
  const waLines = [
    `*${hook}*`,
    '',
    `📦 *${cleanWa(title)}*`,
    '',
    oldPrice ? `❌ De: ~${brl(oldPrice)}~` : null,
    `✅ *Por: ${brl(price)}*${discount ? `  (-${discount}% OFF)` : ''}`,
    social || null,
    '',
    urgency,
    '',
    `👉 *COMPRE AQUI:* ${link}`,
  ].filter((l) => l !== null);
  const whatsappCaption = waLines.join('\n');

  staticData.sent[p.itemId] = Date.now();

  out.push({
    json: {
      itemId: p.itemId,
      productName: p.productName,
      price,
      priceFormatted: brl(price),
      oldPriceFormatted: oldPrice ? brl(oldPrice) : null,
      discount,
      commissionRate: p.commissionRate,
      commission: p.commission,
      estimatedCommission: brl(p.commission),
      affiliateLink: link,
      imageUrl: directImage(p.imageUrl),
      telegramCaption,
      whatsappCaption,
    },
  });
});

return out;
