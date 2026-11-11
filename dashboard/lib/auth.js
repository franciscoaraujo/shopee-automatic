// Autenticação do painel: conta de administrador única, senha com scrypt,
// sessões em cookie HttpOnly e código de configuração inicial de uso único
// (impresso no log do container) para que ninguém "tome" o painel antes do dono.
const crypto = require('crypto');

const SESSION_DAYS = 7;
const COOKIE = 'obs_session';
const COOKIE_SECURE = /^(1|true|yes)$/i.test(process.env.COOKIE_SECURE || '');
const MIN_PASSWORD = 10;

let pool;
let setupCode = null;
const attempts = new Map(); // ip -> { count, until }

async function init(pgPool) {
  pool = pgPool;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id            serial PRIMARY KEY,
      username      text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY,
      user_id    int NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    );
  `);
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
}

// ------------------------------------------------------------ senha
function scrypt(password, salt) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)))
  );
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(password, Buffer.from(salt, 'base64'));
  const expected = Buffer.from(hash, 'base64');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres`;
  if (password.length > 200) return 'Senha muito longa';
  return null;
}

// ------------------------------------------------------------ setup inicial
async function needsSetup() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM admin_users');
  return rows[0].n === 0;
}

function getSetupCode() {
  if (!setupCode) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    setupCode = Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
    setupCode = `${setupCode.slice(0, 4)}-${setupCode.slice(4)}`;
    console.log('\n==============================================================');
    console.log('  Painel ainda sem administrador. Código de configuração:');
    console.log(`      ${setupCode}`);
    console.log('  Abra o painel e use este código para criar sua conta.');
    console.log('==============================================================\n');
  }
  return setupCode;
}

async function setup({ code, username, password }) {
  if (!(await needsSetup())) return { error: 'Administrador já configurado', status: 409 };
  const expected = getSetupCode();
  const given = String(code || '').trim().toUpperCase();
  if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return { error: 'Código de configuração inválido (veja: docker logs obs-dashboard)', status: 403 };
  }
  const user = String(username || '').trim();
  if (!/^[A-Za-z0-9._@-]{3,64}$/.test(user)) return { error: 'Usuário: 3 a 64 caracteres (letras, números, . _ @ -)', status: 400 };
  const problem = passwordProblem(password);
  if (problem) return { error: problem, status: 400 };
  const { rows } = await pool.query(
    'INSERT INTO admin_users (username, password_hash) VALUES ($1, $2) RETURNING id',
    [user, await hashPassword(password)]
  );
  setupCode = null;
  return { userId: rows[0].id };
}

// ------------------------------------------------------------ login / sessão
function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}
function isLocked(ip) {
  const a = attempts.get(ip);
  return a && a.until && a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 60000) : 0;
}
function registerFailure(ip) {
  const a = attempts.get(ip) || { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= 5) { a.until = Date.now() + 15 * 60 * 1000; a.count = 0; }
  attempts.set(ip, a);
}

async function login(req, { username, password }) {
  const ip = clientIp(req);
  const locked = isLocked(ip);
  if (locked) return { error: `Muitas tentativas. Tente novamente em ${locked} min.`, status: 429 };
  const { rows } = await pool.query('SELECT id, password_hash FROM admin_users WHERE username = $1', [String(username || '').trim()]);
  // verifica mesmo sem usuário, para não revelar quais usuários existem pelo tempo de resposta
  const ok = await verifyPassword(String(password || ''), rows[0]?.password_hash || 'scrypt$AAAA$AAAA').catch(() => false);
  if (!rows.length || !ok) {
    registerFailure(ip);
    return { error: 'Usuário ou senha incorretos', status: 401 };
  }
  attempts.delete(ip);
  return { userId: rows[0].id };
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`,
    [sha256(token), userId]
  );
  return token;
}

function sessionCookie(token) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${SESSION_DAYS * 86400}`];
  if (COOKIE_SECURE) parts.push('Secure');
  return parts.join('; ');
}
function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${COOKIE_SECURE ? '; Secure' : ''}`;
}

function tokenFromReq(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

async function currentUser(req) {
  const token = tokenFromReq(req);
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.username FROM sessions s JOIN admin_users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)]
  );
  return rows[0] || null;
}

async function logout(req) {
  const token = tokenFromReq(req);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

async function changePassword(user, req, { current, next }) {
  const { rows } = await pool.query('SELECT password_hash FROM admin_users WHERE id = $1', [user.id]);
  if (!rows.length || !(await verifyPassword(String(current || ''), rows[0].password_hash))) {
    return { error: 'Senha atual incorreta', status: 403 };
  }
  const problem = passwordProblem(next);
  if (problem) return { error: problem, status: 400 };
  await pool.query('UPDATE admin_users SET password_hash = $1 WHERE id = $2', [await hashPassword(next), user.id]);
  // encerra as outras sessões, mantém a atual
  await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [user.id, sha256(tokenFromReq(req) || '')]);
  return { ok: true };
}

// CLI: docker exec obs-dashboard node server.js --reset-admin
async function resetAdmin() {
  await pool.query('DELETE FROM admin_users'); // sessões caem em cascata
}

module.exports = {
  init, needsSetup, setup, login, createSession, sessionCookie, clearCookie,
  currentUser, logout, changePassword, resetAdmin, getSetupCode,
};
