/* Shell: autenticação, navegação (#/painel, #/config), tema e logout. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let mode = 'login'; // 'setup' | 'login'
  let currentView = null;
  let lastHash = location.hash;

  async function post(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-requested-with': 'obs' },
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }

  // ------------------------------------------------------------ acesso
  function showAuth(nextMode, message) {
    mode = nextMode;
    window.ObsDashboard.stop();
    $('app').hidden = true;
    $('auth-screen').hidden = false;
    const setup = mode === 'setup';
    $('auth-intro').textContent = setup
      ? 'Primeiro acesso: crie a conta de administrador. Ela protege o painel e as credenciais.'
      : 'Entre para ver o painel e gerenciar as configurações.';
    $('auth-code-field').hidden = !setup;
    $('auth-pass-help').hidden = !setup;
    $('auth-submit').textContent = setup ? 'Criar conta e entrar' : 'Entrar';
    const form = $('auth-form');
    form.password.value = '';
    form.password.autocomplete = setup ? 'new-password' : 'current-password';
    const err = $('auth-error');
    err.hidden = !message;
    err.textContent = message || '';
    (setup ? form.code : form.username.value ? form.password : form.username).focus();
  }

  $('auth-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const btn = $('auth-submit');
    const err = $('auth-error');
    btn.disabled = true;
    err.hidden = true;
    try {
      const body = { username: form.username.value, password: form.password.value };
      if (mode === 'setup') body.code = form.code.value;
      await post(mode === 'setup' ? 'api/auth/setup' : 'api/auth/login', body);
      form.password.value = '';
      form.code.value = '';
      await boot();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  window.addEventListener('obs:unauthorized', () => {
    if (!$('auth-screen').hidden) return;
    showAuth('login', 'Sua sessão expirou. Entre novamente.');
  });

  $('logout').addEventListener('click', async () => {
    if (window.ObsSettings.hasUnsaved() && !confirm('Há alterações não salvas. Sair mesmo assim?')) return;
    window.ObsSettings.discard();
    await post('api/auth/logout').catch(() => {});
    showAuth('login');
  });

  // ------------------------------------------------------------ navegação
  function viewFromHash() {
    return location.hash === '#/config' ? 'config' : 'painel';
  }

  async function updateBanner() {
    try {
      const r = await window.ObsSettings.readiness();
      applyReadiness(r);
    } catch { /* silencioso: o painel continua funcionando */ }
  }
  function applyReadiness(r) {
    $('config-badge').hidden = r.ready;
    $('setup-banner').hidden = r.ready;
    const pending = r.items.filter((i) => !i.ok).map((i) => `${i.label}: ${i.detail.toLowerCase()}`);
    if (!pending.length && !r.ready) pending.push('ative e configure ao menos um canal');
    $('setup-banner-text').textContent = ` ${pending.join(' · ')}. `;
  }
  window.addEventListener('obs:readiness', (ev) => applyReadiness(ev.detail));

  function route() {
    const next = viewFromHash();
    if (currentView === 'config' && next !== 'config' && window.ObsSettings.hasUnsaved()) {
      if (!confirm('Há alterações não salvas nas configurações. Descartar?')) {
        history.replaceState(null, '', lastHash || '#/config');
        return;
      }
      window.ObsSettings.discard();
    }
    lastHash = location.hash;
    if (next === currentView) return;
    currentView = next;

    document.querySelectorAll('.tab').forEach((t) => {
      const active = t.dataset.view === next;
      t.classList.toggle('active', active);
      if (active) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    $('view-painel').hidden = next !== 'painel';
    $('view-config').hidden = next !== 'config';

    if (next === 'painel') {
      window.ObsDashboard.start();
      updateBanner();
      document.title = 'Painel · Esteira Shopee';
    } else {
      window.ObsDashboard.stop();
      $('updated').textContent = 'Credenciais e parâmetros da esteira';
      window.ObsSettings.load();
      document.title = 'Configurações · Esteira Shopee';
    }
  }
  window.addEventListener('hashchange', route);

  // ------------------------------------------------------------ tema
  $('theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme') ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('obs-theme', next);
    window.ObsDashboard.redraw();
  });

  // ------------------------------------------------------------ início
  async function boot() {
    let status;
    try {
      const r = await fetch('api/auth/status', { credentials: 'same-origin', headers: { accept: 'application/json' } });
      status = await r.json();
    } catch {
      document.body.textContent = 'Não foi possível conectar ao painel.';
      return;
    }
    if (status.needsSetup) return showAuth('setup');
    if (!status.authenticated) return showAuth('login');

    $('auth-screen').hidden = true;
    $('app').hidden = false;
    $('whoami').textContent = status.username;
    currentView = null;
    if (!location.hash) history.replaceState(null, '', '#/painel');
    route();
  }

  boot();
})();
