// Chamadas às APIs externas usadas pelos testes de conexão e pelo health check.
const crypto = require('crypto');

const SHOPEE_URL = 'https://open-api.affiliate.shopee.com.br/graphql';

async function fetchJson(url, opts = {}, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, ok: res.ok, body };
  } finally {
    clearTimeout(t);
  }
}

function describeError(err) {
  const code = err.cause?.code || err.code;
  if (err.name === 'AbortError' || err.message === 'timeout') return 'Sem resposta (serviço parado ou sobrecarregado)';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Host não encontrado (o container está rodando?)';
  if (code === 'ECONNREFUSED') return 'Conexão recusada (serviço iniciando ou parado)';
  return err.message;
}

const result = (ok, message, extra) => ({ ok, message, ...extra });

// ------------------------------------------------------------ Shopee
async function testShopee({ shopeeAppId, shopeeSecret }) {
  if (!shopeeAppId || !shopeeSecret) return result(false, 'Informe App ID e Secret');
  const payload = JSON.stringify({ query: 'query { productOfferV2(limit: 1) { nodes { itemId productName } } }' });
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHash('sha256').update(`${shopeeAppId}${ts}${payload}${shopeeSecret}`, 'utf8').digest('hex');
  const r = await fetchJson(SHOPEE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `SHA256 Credential=${shopeeAppId}, Timestamp=${ts}, Signature=${sig}`,
    },
    body: payload,
  }, 15000);
  const errs = r.body?.errors;
  if (Array.isArray(errs) && errs.length) {
    const e = errs[0];
    const code = e.extensions?.code ? ` [${e.extensions.code}]` : '';
    return result(false, `Shopee recusou${code}: ${e.extensions?.message || e.message}`);
  }
  if (!r.ok) return result(false, `Shopee respondeu HTTP ${r.status}`);
  const node = r.body?.data?.productOfferV2?.nodes?.[0];
  return result(true, node ? `Autenticado · ex.: ${String(node.productName).slice(0, 60)}` : 'Autenticado (nenhuma oferta retornada)');
}

// ------------------------------------------------------------ Telegram
async function testTelegram({ telegramBotToken, telegramChatId }) {
  if (!telegramBotToken) return result(false, 'Informe o token do bot');
  const base = `https://api.telegram.org/bot${telegramBotToken}`;
  const me = await fetchJson(`${base}/getMe`, {}, 10000);
  if (!me.body?.ok) return result(false, `Token recusado: ${me.body?.description || `HTTP ${me.status}`}`);
  const bot = `@${me.body.result.username}`;
  if (!telegramChatId) return result(true, `Bot ${bot} válido · informe o chat ID`);

  const chat = await fetchJson(`${base}/getChat?chat_id=${encodeURIComponent(telegramChatId)}`, {}, 10000);
  if (!chat.body?.ok) return result(false, `Bot ${bot} válido, mas o chat não foi encontrado: ${chat.body?.description || chat.status}`);
  const c = chat.body.result;
  const title = c.title || c.username || c.id;
  if (c.id === me.body.result.id) {
    return result(false, `${telegramChatId} é o próprio bot — informe o canal ou grupo onde as ofertas serão publicadas`);
  }
  if (c.type === 'private') {
    return result(false, `"${title}" é uma conversa privada — informe um canal (@canal) ou grupo (-100…)`);
  }

  const member = await fetchJson(
    `${base}/getChatMember?chat_id=${encodeURIComponent(telegramChatId)}&user_id=${me.body.result.id}`, {}, 10000
  );
  const status = member.body?.result?.status;
  if (c.type === 'channel' && status !== 'administrator' && status !== 'creator') {
    return result(false, `Bot ${bot} não é administrador do canal "${title}"`);
  }
  if (member.body?.result?.can_post_messages === false) {
    return result(false, `Bot ${bot} não tem permissão para publicar em "${title}"`);
  }
  return result(true, `Bot ${bot} pode publicar em "${title}" (${c.type})`);
}

// ------------------------------------------------------------ WhatsApp (Evolution)
async function evolutionState(evo, instance) {
  const r = await fetchJson(`${evo.url}/instance/connectionState/${encodeURIComponent(instance)}`, {
    headers: { apikey: evo.apiKey },
  });
  if (r.status === 401 || r.status === 403) return { error: 'EVOLUTION_API_KEY recusada pela Evolution API' };
  if (r.status === 404) return { error: `Instância "${instance}" não existe — crie e conecte via QR Code` };
  if (!r.ok) return { error: `Evolution API respondeu HTTP ${r.status}` };
  return { state: r.body?.instance?.state || r.body?.state || 'desconhecido' };
}

async function listGroups(evo, instance) {
  const r = await fetchJson(
    `${evo.url}/group/fetchAllGroups/${encodeURIComponent(instance)}?getParticipants=false`,
    { headers: { apikey: evo.apiKey } },
    30000
  );
  if (!r.ok) throw new Error(`Evolution API respondeu HTTP ${r.status}`);
  const list = Array.isArray(r.body) ? r.body : r.body?.groups || [];
  return list
    .filter((g) => g && g.id && String(g.id).endsWith('@g.us'))
    .map((g) => ({ id: g.id, subject: g.subject || g.id, size: g.size ?? g.participants?.length ?? null }))
    .sort((a, b) => a.subject.localeCompare(b.subject, 'pt-BR'));
}

async function testWhatsapp(cfg, evo) {
  if (!evo.apiKey) return result(false, 'EVOLUTION_API_KEY não está definida no servidor (.env)');
  if (!cfg.evolutionInstance) return result(false, 'Informe o nome da instância');
  const st = await evolutionState(evo, cfg.evolutionInstance);
  if (st.error) return result(false, st.error);
  if (st.state !== 'open') return result(false, `Instância "${cfg.evolutionInstance}" está "${st.state}" — conecte via QR Code`);
  if (!cfg.whatsappGroupJid) return result(true, 'WhatsApp conectado · escolha o grupo de destino');
  const groups = await listGroups(evo, cfg.evolutionInstance);
  const g = groups.find((x) => x.id === cfg.whatsappGroupJid);
  if (!g) return result(false, 'WhatsApp conectado, mas o número não participa desse grupo');
  return result(true, `Conectado · publicará em "${g.subject}"`);
}

module.exports = { fetchJson, describeError, testShopee, testTelegram, testWhatsapp, evolutionState, listGroups };
