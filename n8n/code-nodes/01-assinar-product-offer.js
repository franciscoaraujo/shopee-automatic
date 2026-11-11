// =====================================================================
// Code Node: "Assinar productOfferV2"   (Mode: Run Once for All Items)
// Monta a query GraphQL productOfferV2 e calcula a assinatura SHA256:
//   Signature = SHA256(AppID + Timestamp + Payload + Secret)
// O "Payload" é exatamente a string JSON enviada no body. Por isso o body
// sai daqui já serializado e o HTTP Request o envia em modo RAW, sem
// re-serializar (qualquer espaço diferente invalida a assinatura).
// Requer: NODE_FUNCTION_ALLOW_BUILTIN=crypto
// =====================================================================
const crypto = require('crypto');

const cfg = $('Config').first().json;

const appId = String(cfg.shopeeAppId || '').trim();
const secret = String(cfg.shopeeSecret || '').trim();
if (!appId || !secret) {
  throw new Error('Shopee App ID / Secret não configurados — preencha em http://localhost:3100 → Configurações.');
}

// sortType: 1=RELEVANCE_DESC 2=ITEM_SOLD_DESC 3=PRICE_DESC 4=PRICE_ASC 5=COMMISSION_DESC
const sortType = parseInt(cfg.sortType, 10) || 5;
const limit = Math.min(Math.max(parseInt(cfg.searchLimit, 10) || 30, 1), 50);

const staticData = $getWorkflowStaticData('global');
const keywords = String(cfg.keywords || '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);

let page;
let keyword = '';
if ($runIndex > 0 && staticData.current) {
  // Nova tentativa (erro temporário da Shopee): repete a MESMA busca, sem avançar o rodízio
  ({ page, keyword } = staticData.current);
} else {
  // Rotaciona a página a cada execução para variar as ofertas
  const maxPage = Math.max(parseInt(cfg.maxPage, 10) || 3, 1);
  staticData.page = ((staticData.page || 0) % maxPage) + 1;
  page = staticData.page;
  // Palavra-chave: aceita lista separada por vírgula e rotaciona entre elas
  if (keywords.length) {
    staticData.kwIndex = ((staticData.kwIndex ?? -1) + 1) % keywords.length;
    keyword = keywords[staticData.kwIndex];
  }
  staticData.current = { page, keyword };
}

// Argumentos GraphQL (JSON.stringify gera string literal válida em GraphQL)
const args = [`sortType: ${sortType}`, `page: ${page}`, `limit: ${limit}`];
if (keyword) args.unshift(`keyword: ${JSON.stringify(keyword)}`);

const query = `query {
  productOfferV2(${args.join(', ')}) {
    nodes {
      itemId
      productName
      productLink
      offerLink
      imageUrl
      priceMin
      priceMax
      priceDiscountRate
      commissionRate
      commission
      sales
      ratingStar
      shopName
      shopId
      periodStartTime
      periodEndTime
    }
    pageInfo {
      page
      limit
      hasNextPage
    }
  }
}`;

const payload = JSON.stringify({ query });
const timestamp = Math.floor(Date.now() / 1000);
const signature = crypto
  .createHash('sha256')
  .update(`${appId}${timestamp}${payload}${secret}`, 'utf8')
  .digest('hex');

return [
  {
    json: {
      url: 'https://open-api.affiliate.shopee.com.br/graphql',
      authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
      body: payload,
      meta: { keyword: keyword || null, page, sortType, limit, attempt: $runIndex + 1 },
    },
  },
];
