// Painel de observabilidade da esteira Shopee -> Telegram + WhatsApp
// - POST /api/ingest   : eventos enviados pelo n8n (header x-ingest-token)
// - GET  /api/summary  : KPIs, série temporal, palavras-chave, ofertas, erros
// - GET  /api/health   : verificações ao vivo dos serviços
// - GET  /api/executions : últimas execuções via API pública do n8n (opcional)
// - /api/auth/*        : configuração inicial, login, logout, troca de senha
// - /api/settings*     : credenciais e parâmetros (criptografados no banco)
// - GET  /api/internal/config : configuração completa para o n8n (token interno)
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool, Client } = require('pg');
const settings = require('./lib/settings');
const auth = require('./lib/auth');
const integrations = require('./lib/integrations');

const { fetchJson, describeError } = integrations;
const env = (k, d = '') => (process.env[k] ?? d).toString().trim();

const PORT = parseInt(env('PORT', '3100'), 10);
const TZ = env('TZ', 'America/Sao_Paulo');
const INGEST_TOKEN = env('DASHBOARD_INGEST_TOKEN');

const PG = {
  host: env('PGHOST', 'postgres'),
  port: parseInt(env('PGPORT', '5432'), 10),
  user: env('PGUSER', 'evolution'),
  password: env('PGPASSWORD'),
};
const OBS_DB = env('OBS_DATABASE', 'observability');

const N8N_URL = env('N8N_INTERNAL_URL', 'http://n8n:5678');
const N8N_API_KEY = env('N8N_API_KEY');
const N8N_WORKFLOW_ID = env('N8N_WORKFLOW_ID');
const REDIS_HOST = env('REDIS_HOST', 'redis');
const REDIS_PORT = parseInt(env('REDIS_PORT', '6379'), 10);
const STALE_MINUTES = parseInt(env('SHOPEE_STALE_MINUTES', '90'), 10);

const RANGES = {
  '24h': { interval: '24 hours', unit: 'hour', buckets: 24 },
  '7d': { interval: '7 days', unit: 'day', buckets: 7 },
  '30d': { interval: '30 days', unit: 'day', buckets: 30 },
};

let pool;

// ---------------------------------------------------------------- banco
async function initDb() {
  // Cria o banco de observabilidade no mesmo Postgres (funciona com volume existente)
  for (let attempt = 1; ; attempt++) {
    const admin = new Client({ ...PG, database: 'postgres' });
    try {
      await admin.connect();
      const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [OBS_DB]);
      if (!rowCount) {
        if (!/^[a-z_][a-z0-9_]*$/.test(OBS_DB)) throw new Error('OBS_DATABASE inválido');
        await admin.query(`CREATE DATABASE ${OBS_DB}`);
        console.log(`Banco "${OBS_DB}" criado`);
      }
      await admin.end();
      break;
    } catch (err) {
      await admin.end().catch(() => {});
      if (attempt >= 30) throw err;
      console.log(`Aguardando Postgres (${attempt}/30): ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  pool = new Pool({ ...PG, database: OBS_DB, max: 5 });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS runs (
      execution_id text PRIMARY KEY,
      mode         text,
      keyword      text,
      page         int,
      sort_type    int,
      found        int NOT NULL DEFAULT 0,
      error        text,
      created_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS runs_created_at_idx ON runs (created_at);

    CREATE TABLE IF NOT EXISTS deliveries (
      id              bigserial PRIMARY KEY,
      execution_id    text,
      channel         text NOT NULL,
      item_id         text NOT NULL,
      product_name    text,
      price           numeric,
      commission_rate numeric,
      commission      numeric,
      affiliate_link  text,
      image_url       text,
      success         boolean NOT NULL,
      error           text,
      message_id      text,
      created_at      timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS deliveries_created_at_idx ON deliveries (created_at);
    CREATE INDEX IF NOT EXISTS deliveries_item_idx ON deliveries (item_id);
  `);
}

// ---------------------------------------------------------------- ingestão
const str = (v, max = 500) => (v === undefined || v === null || v === '' ? null : String(v).slice(0, max));
const num = (v) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? null : Number(v));

async function ingest(evt) {
  if (evt.type === 'run') {
    await pool.query(
      `INSERT INTO runs (execution_id, mode, keyword, page, sort_type, found, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (execution_id) DO UPDATE SET
         keyword = EXCLUDED.keyword, page = EXCLUDED.page, sort_type = EXCLUDED.sort_type,
         found = EXCLUDED.found, error = EXCLUDED.error`,
      [
        str(evt.executionId, 64) || crypto.randomUUID(),
        str(evt.mode, 32),
        str(evt.keyword, 120),
        num(evt.page),
        num(evt.sortType),
        num(evt.found) || 0,
        str(evt.error, 1000),
      ]
    );
    return 1;
  }

  if (evt.type === 'deliveries') {
    const events = Array.isArray(evt.events) ? evt.events.slice(0, 200) : [];
    for (const e of events) {
      const channel = e.channel === 'telegram' || e.channel === 'whatsapp' ? e.channel : null;
      if (!channel || !e.itemId) continue;
      await pool.query(
        `INSERT INTO deliveries (execution_id, channel, item_id, product_name, price, commission_rate,
           commission, affiliate_link, image_url, success, error, message_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          str(evt.executionId, 64),
          channel,
          str(e.itemId, 64),
          str(e.productName, 300),
          num(e.price),
          num(e.commissionRate),
          num(e.commission),
          str(e.affiliateLink, 500),
          str(e.imageUrl, 500),
          e.success === true,
          str(e.error, 1000),
          str(e.messageId, 128),
        ]
      );
    }
    return events.length;
  }

  throw Object.assign(new Error('type deve ser "run" ou "deliveries"'), { status: 400 });
}

// ---------------------------------------------------------------- consultas
async function summary(rangeKey) {
  const r = RANGES[rangeKey] || RANGES['24h'];
  const q = (sql, params) => pool.query(sql, params).then((x) => x.rows);

  const [kpiRows, prevRows, runRows, series, keywords, offers, errors] = await Promise.all([
    q(
      `SELECT
         count(DISTINCT item_id) FILTER (WHERE success)                         AS published,
         count(*) FILTER (WHERE success AND channel = 'telegram')               AS tg_ok,
         count(*) FILTER (WHERE channel = 'telegram')                           AS tg_total,
         count(*) FILTER (WHERE success AND channel = 'whatsapp')               AS wa_ok,
         count(*) FILTER (WHERE channel = 'whatsapp')                           AS wa_total,
         count(*) FILTER (WHERE NOT success)                                    AS failures
       FROM deliveries WHERE created_at > now() - $1::interval`,
      [r.interval]
    ),
    q(
      `WITH pub AS (
         SELECT item_id, max(commission) AS commission,
                bool_or(created_at > now() - $1::interval) AS current
         FROM deliveries
         WHERE success AND created_at > now() - 2 * $1::interval
         GROUP BY item_id, (created_at > now() - $1::interval)
       )
       SELECT
         count(*) FILTER (WHERE current)                         AS published_cur,
         count(*) FILTER (WHERE NOT current)                     AS published_prev,
         coalesce(sum(commission) FILTER (WHERE current), 0)     AS commission_cur,
         coalesce(sum(commission) FILTER (WHERE NOT current), 0) AS commission_prev
       FROM pub`,
      [r.interval]
    ),
    q(
      `SELECT count(*) AS runs,
              count(*) FILTER (WHERE error IS NOT NULL) AS run_errors,
              coalesce(sum(found), 0) AS found,
              max(created_at) AS last_run_at
       FROM runs WHERE created_at > now() - $1::interval`,
      [r.interval]
    ),
    q(
      `SELECT to_char(b, 'YYYY-MM-DD"T"HH24:MI') AS bucket,
              count(d.id) FILTER (WHERE d.channel = 'telegram' AND d.success) AS telegram,
              count(d.id) FILTER (WHERE d.channel = 'whatsapp' AND d.success) AS whatsapp,
              count(d.id) FILTER (WHERE NOT d.success)                        AS failures
       FROM generate_series(
              date_trunc($2::text, now() AT TIME ZONE $3::text) - ($4::int - 1) * ('1 ' || $2::text)::interval,
              date_trunc($2::text, now() AT TIME ZONE $3::text),
              ('1 ' || $2::text)::interval) AS b
       LEFT JOIN deliveries d
         ON d.created_at > now() - $1::interval
        AND date_trunc($2::text, d.created_at AT TIME ZONE $3::text) = b
       GROUP BY b ORDER BY b`,
      [r.interval, r.unit, TZ, r.buckets]
    ),
    q(
      `SELECT keyword, count(*) AS published, coalesce(sum(commission), 0) AS commission
       FROM (
         SELECT DISTINCT ON (d.item_id) d.item_id,
                coalesce(r.keyword, '(sem palavra-chave)') AS keyword, d.commission
         FROM deliveries d LEFT JOIN runs r ON r.execution_id = d.execution_id
         WHERE d.success AND d.created_at > now() - $1::interval
         ORDER BY d.item_id, d.created_at DESC
       ) x
       GROUP BY keyword ORDER BY published DESC, keyword LIMIT 8`,
      [r.interval]
    ),
    q(
      `SELECT d.item_id, max(d.product_name) AS product_name, max(d.price) AS price,
              max(d.commission_rate) AS commission_rate, max(d.commission) AS commission,
              max(d.affiliate_link) AS affiliate_link, max(d.image_url) AS image_url,
              max(d.created_at) AS sent_at, max(r.keyword) AS keyword,
              bool_or(d.success) FILTER (WHERE d.channel = 'telegram') AS telegram,
              bool_or(d.success) FILTER (WHERE d.channel = 'whatsapp') AS whatsapp
       FROM deliveries d LEFT JOIN runs r ON r.execution_id = d.execution_id
       WHERE d.created_at > now() - $1::interval
       GROUP BY d.item_id ORDER BY sent_at DESC LIMIT 12`,
      [r.interval]
    ),
    q(
      `SELECT * FROM (
         SELECT created_at, channel AS source, error AS message, product_name AS context
         FROM deliveries WHERE NOT success AND created_at > now() - $1::interval
         UNION ALL
         SELECT created_at, 'shopee' AS source, error AS message, keyword AS context
         FROM runs WHERE error IS NOT NULL AND created_at > now() - $1::interval
       ) e ORDER BY created_at DESC LIMIT 25`,
      [r.interval]
    ),
  ]);

  const k = kpiRows[0];
  const p = prevRows[0];
  const ru = runRows[0];
  const n = (v) => Number(v) || 0;

  return {
    range: rangeKey in RANGES ? rangeKey : '24h',
    unit: r.unit,
    generatedAt: new Date().toISOString(),
    kpis: {
      published: n(k.published),
      publishedPrev: n(p.published_prev),
      commission: n(p.commission_cur),
      commissionPrev: n(p.commission_prev),
      failures: n(k.failures),
      channels: {
        telegram: { ok: n(k.tg_ok), total: n(k.tg_total) },
        whatsapp: { ok: n(k.wa_ok), total: n(k.wa_total) },
      },
      runs: n(ru.runs),
      runErrors: n(ru.run_errors),
      found: n(ru.found),
      lastRunAt: ru.last_run_at,
    },
    series: series.map((s) => ({
      bucket: s.bucket,
      telegram: n(s.telegram),
      whatsapp: n(s.whatsapp),
      failures: n(s.failures),
    })),
    keywords: keywords.map((x) => ({ keyword: x.keyword, published: n(x.published), commission: n(x.commission) })),
    offers: offers.map((o) => ({
      itemId: o.item_id,
      productName: o.product_name,
      price: num(o.price),
      commissionRate: num(o.commission_rate),
      commission: num(o.commission),
      affiliateLink: o.affiliate_link,
      imageUrl: o.image_url,
      keyword: o.keyword,
      sentAt: o.sent_at,
      telegram: o.telegram,
      whatsapp: o.whatsapp,
    })),
    errors,
  };
}

// ---------------------------------------------------------------- health
function redisPing() {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: REDIS_HOST, port: REDIS_PORT });
    const fail = (e) => { sock.destroy(); reject(e); };
    sock.setTimeout(3000, () => fail(new Error('timeout')));
    sock.on('error', fail);
    sock.on('connect', () => sock.write('PING\r\n'));
    sock.on('data', (d) => {
      sock.end();
      const s = d.toString();
      s.startsWith('+PONG') ? resolve() : reject(new Error(s.trim()));
    });
  });
}

const S = (status, label, detail) => ({ status, label, detail });

const checks = {
  async n8n() {
    const r = await fetchJson(`${N8N_URL}/healthz`);
    return r.ok ? S('good', 'Online', 'Healthcheck respondeu ok') : S('critical', 'Com falha', `HTTP ${r.status}`);
  },
  async whatsapp() {
    const cfg = settings.valuesOf(await settings.effective());
    if (!cfg.whatsappEnabled) return S('unknown', 'Desativado', 'Canal desligado em Configurações');
    const evo = settings.evolutionInfra();
    if (!evo.apiKey) return S('unknown', 'Não configurado', 'EVOLUTION_API_KEY ausente no servidor');
    const st = await integrations.evolutionState(evo, cfg.evolutionInstance);
    if (st.error) return S('critical', 'Com falha', st.error);
    if (st.state === 'open') return S('good', 'Conectado', `Instância ${cfg.evolutionInstance}`);
    if (st.state === 'connecting') return S('warning', 'Conectando', 'Aguardando leitura do QR Code');
    return S('critical', 'Desconectado', `Estado: ${st.state} — reconecte via QR Code`);
  },
  async telegram() {
    const cfg = settings.valuesOf(await settings.effective());
    if (!cfg.telegramEnabled) return S('unknown', 'Desativado', 'Canal desligado em Configurações');
    if (!cfg.telegramBotToken) return S('unknown', 'Não configurado', 'Informe o token em Configurações');
    const r = await fetchJson(`https://api.telegram.org/bot${cfg.telegramBotToken}/getMe`);
    if (r.ok && r.body?.ok) return S('good', 'Online', `@${r.body.result.username}`);
    return S('critical', 'Com falha', r.body?.description || `HTTP ${r.status}`);
  },
  async postgres() {
    const t0 = Date.now();
    await pool.query('SELECT 1');
    return S('good', 'Online', `Latência ${Date.now() - t0} ms`);
  },
  async redis() {
    const t0 = Date.now();
    await redisPing();
    return S('good', 'Online', `PING ${Date.now() - t0} ms`);
  },
  async shopee() {
    const cfg = settings.valuesOf(await settings.effective());
    if (!cfg.shopeeAppId || !cfg.shopeeSecret) return S('unknown', 'Não configurado', 'Informe App ID e Secret em Configurações');
    const { rows } = await pool.query('SELECT created_at, error, found FROM runs ORDER BY created_at DESC LIMIT 1');
    if (!rows.length) return S('unknown', 'Sem dados', 'Nenhuma busca registrada ainda');
    const last = rows[0];
    const ageMin = Math.round((Date.now() - new Date(last.created_at).getTime()) / 60000);
    if (last.error) return S('critical', 'Com erro', last.error);
    if (ageMin > STALE_MINUTES) return S('warning', 'Sem buscas recentes', `Última há ${ageMin} min`);
    return S('good', 'Respondendo', `Última busca há ${ageMin} min · ${last.found} produtos`);
  },
};

const TTL = { telegram: 60000 };
const healthCache = new Map();

async function health() {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, fn]) => {
      const hit = healthCache.get(name);
      const ttl = TTL[name] || 15000;
      if (hit && Date.now() - hit.at < ttl) return [name, hit.value];
      let value;
      try {
        value = await fn();
      } catch (err) {
        value = S('critical', 'Inacessível', describeError(err));
      }
      value.checkedAt = new Date().toISOString();
      healthCache.set(name, { at: Date.now(), value });
      return [name, value];
    })
  );
  return Object.fromEntries(entries);
}

async function executions() {
  if (!N8N_API_KEY) return { enabled: false, items: [] };
  const params = new URLSearchParams({ limit: '20' });
  if (N8N_WORKFLOW_ID) params.set('workflowId', N8N_WORKFLOW_ID);
  const r = await fetchJson(`${N8N_URL}/api/v1/executions?${params}`, {
    headers: { 'X-N8N-API-KEY': N8N_API_KEY, accept: 'application/json' },
  });
  if (!r.ok) return { enabled: true, error: `API do n8n respondeu HTTP ${r.status}`, items: [] };
  const items = (r.body?.data || []).map((e) => ({
    id: e.id,
    status: e.status || (e.finished ? 'success' : 'error'),
    mode: e.mode,
    startedAt: e.startedAt,
    stoppedAt: e.stoppedAt,
    durationMs: e.startedAt && e.stoppedAt ? new Date(e.stoppedAt) - new Date(e.startedAt) : null,
  }));
  return { enabled: true, items };
}

// ---------------------------------------------------------------- HTTP
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'content-type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload muito grande'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  try {
    return JSON.parse((await readBody(req, 64 * 1024)) || '{}');
  } catch (e) {
    throw Object.assign(new Error(e.status ? e.message : 'JSON inválido'), { status: e.status || 400 });
  }
}

const hasToken = (req) => Boolean(INGEST_TOKEN) && safeEqual(req.headers['x-ingest-token'] || '', INGEST_TOKEN);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const m = req.method;
  try {
    if (p === '/healthz') return send(res, 200, { ok: true });

    // ---------- máquina-a-máquina (n8n), token interno ----------
    if (p === '/api/ingest') {
      if (m !== 'POST') return send(res, 405, { error: 'Use POST' });
      if (!hasToken(req)) return send(res, 401, { error: 'Token de ingestão inválido' });
      const count = await ingest(await readJson(req));
      return send(res, 200, { ok: true, stored: count });
    }
    if (p === '/api/internal/config') {
      if (!hasToken(req)) return send(res, 401, { error: 'Token interno inválido' });
      return send(res, 200, await settings.internalConfig());
    }

    if (p.startsWith('/api/')) {
      // Proteção CSRF: toda escrita exige header customizado (bloqueado cross-origin sem CORS)
      if (m !== 'GET' && req.headers['x-requested-with'] !== 'obs') {
        return send(res, 403, { error: 'Requisição recusada' });
      }

      // ---------- autenticação ----------
      if (p === '/api/auth/status' && m === 'GET') {
        const needsSetup = await auth.needsSetup();
        if (needsSetup) auth.getSetupCode(); // garante que o código esteja no log
        const user = needsSetup ? null : await auth.currentUser(req);
        return send(res, 200, { needsSetup, authenticated: Boolean(user), username: user?.username || null });
      }
      if (p === '/api/auth/setup' && m === 'POST') {
        const r = await auth.setup(await readJson(req));
        if (r.error) return send(res, r.status, { error: r.error });
        const token = await auth.createSession(r.userId);
        return send(res, 200, { ok: true }, { 'set-cookie': auth.sessionCookie(token) });
      }
      if (p === '/api/auth/login' && m === 'POST') {
        const r = await auth.login(req, await readJson(req));
        if (r.error) return send(res, r.status, { error: r.error });
        const token = await auth.createSession(r.userId);
        return send(res, 200, { ok: true }, { 'set-cookie': auth.sessionCookie(token) });
      }
      if (p === '/api/auth/logout' && m === 'POST') {
        await auth.logout(req);
        return send(res, 200, { ok: true }, { 'set-cookie': auth.clearCookie() });
      }

      // ---------- daqui em diante exige sessão ----------
      const user = await auth.currentUser(req);
      if (!user) return send(res, 401, { error: 'Faça login para continuar' });

      if (p === '/api/auth/password' && m === 'POST') {
        const r = await auth.changePassword(user, req, await readJson(req));
        return r.error ? send(res, r.status, { error: r.error }) : send(res, 200, { ok: true });
      }

      if (p === '/api/summary' && m === 'GET') return send(res, 200, await summary(url.searchParams.get('range') || '24h'));
      if (p === '/api/health' && m === 'GET') return send(res, 200, await health());
      if (p === '/api/executions' && m === 'GET') return send(res, 200, await executions());

      if (p === '/api/settings' && m === 'GET') return send(res, 200, await settings.publicView());
      if (p === '/api/settings' && m === 'PUT') {
        const body = await readJson(req);
        const r = await settings.save(body.values || {}, body.clear || []);
        if (!r.ok) return send(res, 422, { error: 'Revise os campos destacados', fields: r.errors });
        healthCache.clear();
        console.log(`Configurações alteradas por ${user.username}: ${[...r.saved, ...r.cleared].join(', ') || 'nada'}`);
        return send(res, 200, { ...r, view: await settings.publicView() });
      }

      const test = p.match(/^\/api\/settings\/test\/(shopee|telegram|whatsapp)$/);
      if (test && m === 'POST') {
        const body = await readJson(req);
        const cfg = await settings.withOverrides(body.values || {});
        try {
          const target = test[1];
          const r =
            target === 'shopee' ? await integrations.testShopee(cfg)
            : target === 'telegram' ? await integrations.testTelegram(cfg)
            : await integrations.testWhatsapp(cfg, settings.evolutionInfra());
          return send(res, 200, r);
        } catch (err) {
          return send(res, 200, { ok: false, message: describeError(err) });
        }
      }

      if (p === '/api/settings/whatsapp/groups' && m === 'GET') {
        const evo = settings.evolutionInfra();
        if (!evo.apiKey) return send(res, 400, { error: 'EVOLUTION_API_KEY não está definida no servidor' });
        const cfg = settings.valuesOf(await settings.effective());
        const instance = (url.searchParams.get('instance') || cfg.evolutionInstance || '').trim();
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(instance)) return send(res, 400, { error: 'Nome de instância inválido' });
        try {
          const st = await integrations.evolutionState(evo, instance);
          if (st.error) return send(res, 400, { error: st.error });
          if (st.state !== 'open') return send(res, 400, { error: `Instância "${instance}" não está conectada (${st.state})` });
          return send(res, 200, { groups: await integrations.listGroups(evo, instance) });
        } catch (err) {
          return send(res, 502, { error: describeError(err) });
        }
      }

      return send(res, 404, { error: 'Rota não encontrada' });
    }

    // ---------- arquivos estáticos (sem dados; a interface pede login) ----------
    const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return send(res, 404, 'Não encontrado');
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    if (!err.status) console.error(err);
    send(res, err.status || 500, { error: err.status ? err.message : 'Erro interno' });
  }
});

async function main() {
  await initDb();
  await settings.init(pool);
  await auth.init(pool);

  if (process.argv.includes('--reset-admin')) {
    await auth.resetAdmin();
    console.log('Administrador removido. Veja o novo código de configuração com: docker logs obs-dashboard');
    await pool.end();
    return;
  }

  if (await auth.needsSetup()) auth.getSetupCode();
  if (!INGEST_TOKEN) console.warn('ATENÇÃO: DASHBOARD_INGEST_TOKEN vazio — o n8n não conseguirá ler a configuração nem enviar eventos.');
  server.listen(PORT, () => console.log(`Painel em http://0.0.0.0:${PORT}`));
}

main().catch((err) => {
  console.error('Falha ao iniciar:', err);
  process.exit(1);
});
