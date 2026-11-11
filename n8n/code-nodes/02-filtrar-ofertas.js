// =====================================================================
// Code Node: "Filtrar Ofertas"   (Mode: Run Once for All Items)
// Valida a resposta do productOfferV2, remove produtos já enviados
// (deduplicação persistente via workflow static data), aplica filtros
// de comissão/avaliação e devolve 1 item por produto selecionado.
// =====================================================================
const cfg = $('Config').first().json;
const res = $input.first().json;

if (Array.isArray(res.errors) && res.errors.length) {
  const e = res.errors[0];
  const code = e.extensions?.code ? ` [${e.extensions.code}]` : '';
  throw new Error(`Shopee productOfferV2 falhou${code}: ${e.extensions?.message || e.message}`);
}

const nodes = res?.data?.productOfferV2?.nodes || [];
if (!nodes.length) return [];

const minCommission = parseFloat(cfg.minCommissionRate) || 0; // ex.: 0.08 = 8%
const minRating = parseFloat(cfg.minRating) || 0;             // ex.: 4.5
const maxPosts = parseInt(cfg.maxPostsPerRun, 10) || 3;
const dedupDays = parseInt(cfg.dedupDays, 10) || 7;

// ----- deduplicação (itemId -> epoch do envio) -----
const staticData = $getWorkflowStaticData('global');
staticData.sent = staticData.sent || {};
const now = Date.now();
const ttl = dedupDays * 24 * 60 * 60 * 1000;
for (const [id, ts] of Object.entries(staticData.sent)) {
  if (now - ts > ttl) delete staticData.sent[id];
}

const nowSec = Math.floor(now / 1000);

const selected = nodes
  .filter((p) => p && p.itemId && p.imageUrl && (p.offerLink || p.productLink))
  .filter((p) => !staticData.sent[String(p.itemId)])
  .filter((p) => !p.periodEndTime || Number(p.periodEndTime) === 0 || Number(p.periodEndTime) > nowSec)
  .filter((p) => (parseFloat(p.commissionRate) || 0) >= minCommission)
  .filter((p) => (parseFloat(p.ratingStar) || 0) >= minRating)
  .sort((a, b) => (parseFloat(b.commission) || 0) - (parseFloat(a.commission) || 0))
  .slice(0, maxPosts);

return selected.map((p) => ({
  json: {
    itemId: String(p.itemId),
    productName: p.productName,
    productLink: p.productLink,
    offerLink: p.offerLink,
    imageUrl: p.imageUrl,
    priceMin: parseFloat(p.priceMin) || 0,
    priceMax: parseFloat(p.priceMax) || 0,
    priceDiscountRate: parseInt(p.priceDiscountRate, 10) || 0,
    commissionRate: parseFloat(p.commissionRate) || 0,
    commission: parseFloat(p.commission) || 0,
    sales: parseInt(p.sales, 10) || 0,
    ratingStar: parseFloat(p.ratingStar) || 0,
    shopName: p.shopName,
  },
}));
