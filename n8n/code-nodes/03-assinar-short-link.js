// =====================================================================
// Code Node: "Assinar generateShortLink"   (Mode: Run Once for All Items)
// Para cada produto, monta a mutation generateShortLink com SubIDs de
// rastreio e assina com SHA256(AppID + Timestamp + Payload + Secret).
// SubIDs: até 5 valores, apenas letras e números.
// =====================================================================
const crypto = require('crypto');

const cfg = $('Config').first().json;
const appId = String(cfg.shopeeAppId || '').trim();
const secret = String(cfg.shopeeSecret || '').trim();

const sanitize = (s) => String(s ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 50);

const now = new Date();
const dateTag = now.toISOString().slice(0, 10).replace(/-/g, ''); // AAAAMMDD

return $input.all().map((item) => {
  const p = item.json;
  const originUrl = p.offerLink || p.productLink;

  // sub1=campanha | sub2=canal | sub3=data | sub4=itemId
  const subIds = [cfg.subIdCampaign || 'esteira', 'multicanal', dateTag, p.itemId]
    .map(sanitize)
    .filter(Boolean)
    .slice(0, 5);

  const query = `mutation {
  generateShortLink(input: { originUrl: ${JSON.stringify(originUrl)}, subIds: ${JSON.stringify(subIds)} }) {
    shortLink
  }
}`;

  const payload = JSON.stringify({ query });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash('sha256')
    .update(`${appId}${timestamp}${payload}${secret}`, 'utf8')
    .digest('hex');

  return {
    json: {
      ...p,
      originUrl,
      subIds,
      url: 'https://open-api.affiliate.shopee.com.br/graphql',
      authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
      body: payload,
    },
  };
});
