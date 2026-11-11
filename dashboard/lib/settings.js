// Configurações editáveis pelo painel.
// - Segredos criptografados com AES-256-GCM (chave mestra fora do banco).
// - Precedência: valor salvo no painel > variável de ambiente (legado) > padrão.
// - Segredos nunca são devolvidos ao navegador (apenas "•••• 1a2b").
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SORT_OPTIONS = [
  { value: 5, label: 'Maior comissão' },
  { value: 2, label: 'Mais vendidos' },
  { value: 1, label: 'Relevância' },
  { value: 4, label: 'Menor preço' },
  { value: 3, label: 'Maior preço' },
];

const GROUPS = [
  { id: 'shopee', title: 'Shopee Affiliate Open API', description: 'Credenciais do painel de afiliados (affiliate.shopee.com.br → Open API).', test: 'shopee' },
  { id: 'telegram', title: 'Telegram', description: 'Bot criado no @BotFather. Em canais, o bot precisa ser administrador.', test: 'telegram' },
  { id: 'whatsapp', title: 'WhatsApp (Evolution API)', description: 'Instância conectada via QR Code e grupo de destino.', test: 'whatsapp' },
  { id: 'search', title: 'Busca e publicação', description: 'Como as ofertas são escolhidas a cada execução.' },
];

const FIELDS = [
  { key: 'shopeeAppId', group: 'shopee', label: 'App ID', type: 'text', env: 'SHOPEE_APP_ID', pattern: /^\d{4,20}$/, patternMsg: 'Somente números', placeholder: '18312345678' },
  { key: 'shopeeSecret', group: 'shopee', label: 'Secret', type: 'secret', env: 'SHOPEE_SECRET' },

  { key: 'telegramEnabled', group: 'telegram', label: 'Publicar no Telegram', type: 'bool', default: true },
  { key: 'telegramBotToken', group: 'telegram', label: 'Token do bot', type: 'secret', env: 'TELEGRAM_BOT_TOKEN', pattern: /^\d+:[A-Za-z0-9_-]{30,}$/, patternMsg: 'Formato esperado: 123456789:AA…' },
  { key: 'telegramChatId', group: 'telegram', label: 'Chat ID do canal/grupo', type: 'text', env: 'TELEGRAM_CHAT_ID', pattern: /^(-?\d{5,20}|@[A-Za-z0-9_]{5,32})$/, patternMsg: 'Use -100… ou @nomedocanal', placeholder: '-1001234567890 ou @meucanal' },

  { key: 'whatsappEnabled', group: 'whatsapp', label: 'Publicar no WhatsApp', type: 'bool', default: true },
  { key: 'evolutionInstance', group: 'whatsapp', label: 'Nome da instância', type: 'text', env: 'EVOLUTION_INSTANCE', default: 'shopee', pattern: /^[A-Za-z0-9_-]{1,64}$/, patternMsg: 'Letras, números, - ou _' },
  { key: 'whatsappGroupJid', group: 'whatsapp', label: 'Grupo de destino (JID)', type: 'text', env: 'WHATSAPP_GROUP_JID', pattern: /^\d[\d-]*@g\.us$/, patternMsg: 'Formato: 120363…@g.us', placeholder: '120363012345678901@g.us', picker: 'whatsappGroups' },

  { key: 'keywords', group: 'search', label: 'Palavras-chave', type: 'text', default: 'fone bluetooth, air fryer, smartwatch, organizador, kit maquiagem', help: 'Separadas por vírgula; uma por execução, em rodízio. Vazio = ofertas gerais.', wide: true },
  { key: 'sortType', group: 'search', label: 'Ordenação', type: 'select', options: SORT_OPTIONS, default: 5 },
  { key: 'minCommissionRate', group: 'search', label: 'Comissão mínima (%)', type: 'percent', min: 0, max: 1, default: 0.05 },
  { key: 'minRating', group: 'search', label: 'Avaliação mínima', type: 'number', min: 0, max: 5, step: 0.1, default: 4.5 },
  { key: 'maxPostsPerRun', group: 'search', label: 'Ofertas por execução', type: 'number', min: 1, max: 20, step: 1, default: 3 },
  { key: 'searchLimit', group: 'search', label: 'Itens por página', type: 'number', min: 1, max: 50, step: 1, default: 30 },
  { key: 'maxPage', group: 'search', label: 'Páginas em rodízio', type: 'number', min: 1, max: 20, step: 1, default: 3 },
  { key: 'dedupDays', group: 'search', label: 'Não repetir produto por (dias)', type: 'number', min: 1, max: 90, step: 1, default: 7 },
  { key: 'subIdCampaign', group: 'search', label: 'SubID da campanha', type: 'text', default: 'esteira', pattern: /^[A-Za-z0-9]{1,50}$/, patternMsg: 'Somente letras e números', help: 'Aparece nos relatórios da Shopee para rastrear a origem das vendas.' },
];
const FIELD_MAP = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

let pool;
let masterKey;
let cache = null;

// ------------------------------------------------------------ chave mestra
function loadMasterKey() {
  const envKey = (process.env.CONFIG_MASTER_KEY || '').trim();
  if (envKey) {
    if (!/^[0-9a-fA-F]{64}$/.test(envKey)) throw new Error('CONFIG_MASTER_KEY deve ter 64 caracteres hexadecimais');
    return Buffer.from(envKey, 'hex');
  }
  const dir = process.env.DATA_DIR || '/data';
  const file = path.join(dir, 'master.key');
  if (fs.existsSync(file)) {
    const hex = fs.readFileSync(file, 'utf8').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`Chave mestra corrompida em ${file}`);
    return Buffer.from(hex, 'hex');
  }
  fs.mkdirSync(dir, { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key.toString('hex'), { mode: 0o600 });
  console.log(`Chave mestra gerada em ${file} (faça backup do volume dashboard_data)`);
  return key;
}

function encrypt(plain, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv, c.getAuthTag(), ct].map((x) => (Buffer.isBuffer(x) ? x.toString('base64') : x)).join('.');
}

function decrypt(blob, aad) {
  const [v, iv, tag, ct] = String(blob).split('.');
  if (v !== 'v1') throw new Error('formato desconhecido');
  const d = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(iv, 'base64'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

// ------------------------------------------------------------ init
async function init(pgPool) {
  pool = pgPool;
  masterKey = loadMasterKey();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key        text PRIMARY KEY,
      value      text,
      encrypted  boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

// ------------------------------------------------------------ leitura
function coerce(field, raw) {
  if (raw === null || raw === undefined) return null;
  switch (field.type) {
    case 'bool':
      return raw === true || raw === 'true' || raw === '1';
    case 'number':
    case 'percent':
    case 'select': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    default:
      return String(raw);
  }
}

// Retorna { key: { value, source: 'panel'|'env'|'default'|'unset', error? } }
async function effective() {
  if (cache) return cache;
  const { rows } = await pool.query('SELECT key, value, encrypted FROM settings');
  const stored = Object.fromEntries(rows.map((r) => [r.key, r]));
  const out = {};
  for (const f of FIELDS) {
    const row = stored[f.key];
    if (row) {
      try {
        const raw = row.encrypted ? decrypt(row.value, f.key) : JSON.parse(row.value);
        out[f.key] = { value: coerce(f, raw), source: 'panel' };
        continue;
      } catch (err) {
        console.error(`Falha ao ler a configuração "${f.key}": ${err.message}`);
        out[f.key] = { value: null, source: 'unset', error: 'Não foi possível descriptografar — salve novamente' };
        continue;
      }
    }
    const envVal = f.env ? (process.env[f.env] || '').trim() : '';
    if (envVal) out[f.key] = { value: coerce(f, envVal), source: 'env' };
    else if (f.default !== undefined) out[f.key] = { value: f.default, source: 'default' };
    else out[f.key] = { value: null, source: 'unset' };
  }
  cache = out;
  return out;
}

const valuesOf = (eff) => Object.fromEntries(Object.entries(eff).map(([k, v]) => [k, v.value]));

function maskSecret(v) {
  if (!v) return null;
  const s = String(v);
  return s.length >= 12 ? `•••• ${s.slice(-4)}` : '••••';
}

function evolutionInfra() {
  return {
    url: (process.env.EVOLUTION_API_URL || 'http://evolution-api:8080').replace(/\/+$/, ''),
    apiKey: (process.env.EVOLUTION_API_KEY || '').trim(),
  };
}

function readiness(v) {
  const evo = evolutionInfra();
  const items = [
    {
      id: 'shopee', label: 'Shopee',
      ok: Boolean(v.shopeeAppId && v.shopeeSecret),
      detail: v.shopeeAppId && v.shopeeSecret ? 'Credenciais definidas' : 'Informe App ID e Secret',
    },
    {
      id: 'telegram', label: 'Telegram', enabled: v.telegramEnabled,
      ok: !v.telegramEnabled || Boolean(v.telegramBotToken && v.telegramChatId),
      detail: !v.telegramEnabled ? 'Canal desativado' : v.telegramBotToken && v.telegramChatId ? 'Pronto' : 'Informe token e chat ID',
    },
    {
      id: 'whatsapp', label: 'WhatsApp', enabled: v.whatsappEnabled,
      ok: !v.whatsappEnabled || Boolean(v.whatsappGroupJid && v.evolutionInstance && evo.apiKey),
      detail: !v.whatsappEnabled ? 'Canal desativado'
        : !evo.apiKey ? 'EVOLUTION_API_KEY ausente no servidor'
        : v.whatsappGroupJid ? 'Pronto' : 'Escolha o grupo de destino',
    },
  ];
  const anyChannel = (v.telegramEnabled && items[1].ok) || (v.whatsappEnabled && items[2].ok);
  return { ready: items.every((i) => i.ok) && anyChannel, items };
}

// Visão para o navegador: esquema + valores (segredos mascarados)
async function publicView() {
  const eff = await effective();
  const evo = evolutionInfra();
  return {
    groups: GROUPS,
    fields: FIELDS.map((f) => {
      const e = eff[f.key];
      const base = {
        key: f.key, group: f.group, label: f.label, type: f.type, help: f.help, placeholder: f.placeholder,
        options: f.options, min: f.min, max: f.max, step: f.step, wide: f.wide, picker: f.picker,
        source: e.source, error: e.error,
      };
      if (f.type === 'secret') return { ...base, isSet: Boolean(e.value), hint: maskSecret(e.value) };
      return { ...base, value: e.value };
    }),
    infra: {
      evolutionUrl: evo.url,
      evolutionApiKey: evo.apiKey ? { isSet: true, hint: maskSecret(evo.apiKey) } : { isSet: false },
    },
    readiness: readiness(valuesOf(eff)),
  };
}

// Configuração completa (com segredos) para o n8n — apenas via token interno
async function internalConfig() {
  const v = valuesOf(await effective());
  const evo = evolutionInfra();
  return { ...v, evolutionUrl: evo.url, evolutionApiKey: evo.apiKey };
}

// ------------------------------------------------------------ escrita
function validate(input = {}, clear = []) {
  const errors = {};
  const updates = {};
  for (const [key, raw] of Object.entries(input)) {
    const f = FIELD_MAP[key];
    if (!f) continue; // ignora chaves desconhecidas
    if (f.type === 'secret') {
      const s = String(raw ?? '').trim();
      if (!s) continue; // vazio = manter o valor atual
      if (s.length > 500) { errors[key] = 'Muito longo'; continue; }
      if (f.pattern && !f.pattern.test(s)) { errors[key] = f.patternMsg; continue; }
      updates[key] = s;
    } else if (f.type === 'text') {
      const s = String(raw ?? '').trim();
      if (s.length > 500) { errors[key] = 'Muito longo'; continue; }
      if (s && f.pattern && !f.pattern.test(s)) { errors[key] = f.patternMsg; continue; }
      updates[key] = s;
    } else if (f.type === 'bool') {
      if (typeof raw !== 'boolean') { errors[key] = 'Valor inválido'; continue; }
      updates[key] = raw;
    } else {
      const n = Number(raw);
      if (raw === '' || raw === null || !Number.isFinite(n)) { errors[key] = 'Informe um número'; continue; }
      if (f.type === 'select' && !f.options.some((o) => o.value === n)) { errors[key] = 'Opção inválida'; continue; }
      if (f.min !== undefined && n < f.min) { errors[key] = `Mínimo ${f.type === 'percent' ? f.min * 100 + '%' : f.min}`; continue; }
      if (f.max !== undefined && n > f.max) { errors[key] = `Máximo ${f.type === 'percent' ? f.max * 100 + '%' : f.max}`; continue; }
      if (f.step === 1 && !Number.isInteger(n)) { errors[key] = 'Use um número inteiro'; continue; }
      updates[key] = n;
    }
  }
  const toClear = (Array.isArray(clear) ? clear : []).filter((k) => FIELD_MAP[k] && !(k in updates));
  return { errors, updates, clear: toClear };
}

async function save(input, clear) {
  const v = validate(input, clear);
  if (Object.keys(v.errors).length) return { ok: false, errors: v.errors };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(v.updates)) {
      const secret = FIELD_MAP[key].type === 'secret';
      await client.query(
        `INSERT INTO settings (key, value, encrypted, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, encrypted = EXCLUDED.encrypted, updated_at = now()`,
        [key, secret ? encrypt(value, key) : JSON.stringify(value), secret]
      );
    }
    if (v.clear.length) await client.query('DELETE FROM settings WHERE key = ANY($1)', [v.clear]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    cache = null;
  }
  return { ok: true, saved: Object.keys(v.updates), cleared: v.clear };
}

// Valores salvos + alterações ainda não salvas do formulário (para "Testar conexão")
async function withOverrides(overrides = {}) {
  const base = valuesOf(await effective());
  const { updates } = validate(overrides);
  return { ...base, ...updates };
}

module.exports = { init, effective, valuesOf, publicView, internalConfig, save, withOverrides, evolutionInfra, FIELDS };
