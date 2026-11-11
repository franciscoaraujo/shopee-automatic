/* Área de configurações: formulário gerado a partir do esquema do servidor.
 * Segredos nunca chegam ao navegador; campo de segredo vazio = manter o atual. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let view = null;        // resposta de GET /api/settings
  let dirty = {};         // key -> novo valor
  let clears = new Set(); // segredos a remover
  let fieldErrors = {};

  const SOURCE_TEXT = {
    panel: 'Salvo no painel',
    env: 'Vindo do .env',
    default: 'Padrão',
    unset: 'Não configurado',
  };
  const STATUS_ICON = { good: '✓', warning: '!', critical: '✕', unknown: '?' };

  function el(tag, props, children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'checked' || k === 'value' || k === 'disabled') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children || [])) {
      if (c === null || c === undefined || c === false) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  }
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  const icon = (status) => el('span', { class: `status-icon ${status}`, 'aria-hidden': 'true', text: STATUS_ICON[status] });

  async function api(method, url, body) {
    const r = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-requested-with': 'obs' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) {
      window.dispatchEvent(new Event('obs:unauthorized'));
      throw new Error('Sessão expirada');
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { data, status: r.status });
    return data;
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, 3500);
  }

  // ------------------------------------------------------------ estado
  const original = (f) => (f.type === 'secret' ? '' : f.value);
  function setDirty(f, value) {
    const same = f.type === 'secret' ? value === '' : value === original(f);
    if (same) delete dirty[f.key];
    else dirty[f.key] = value;
    delete fieldErrors[f.key];
    updateSaveBar();
  }
  function hasUnsaved() {
    return Object.keys(dirty).length > 0 || clears.size > 0;
  }
  function updateSaveBar() {
    const n = Object.keys(dirty).length + clears.size;
    $('save-bar').hidden = n === 0;
    $('save-status').textContent = n === 1 ? '1 alteração não salva' : `${n} alterações não salvas`;
  }

  // ------------------------------------------------------------ campos
  function sourceBadge(f) {
    let src = f.source;
    if (clears.has(f.key)) src = 'unset';
    return el('span', { class: `source-badge ${src}`, text: clears.has(f.key) ? 'Será removido' : SOURCE_TEXT[src] || src });
  }

  function renderField(f) {
    const id = `f-${f.key}`;
    const wrap = el('div', { class: `field${f.wide ? ' wide' : ''}${fieldErrors[f.key] ? ' has-error' : ''}` });

    if (f.type === 'bool') {
      const cb = el('input', { type: 'checkbox', id, role: 'switch', checked: f.key in dirty ? dirty[f.key] : Boolean(f.value) });
      cb.addEventListener('change', () => setDirty(f, cb.checked));
      wrap.classList.add('switch-field');
      wrap.append(el('label', { class: 'switch', for: id }, [cb, el('span', { class: 'switch-track', 'aria-hidden': 'true' }), el('span', { text: f.label })]));
      return wrap;
    }

    const head = el('div', { class: 'field-head' }, [
      el('label', { class: 'field-label', for: id, text: f.label }),
      f.type === 'select' || f.type === 'number' || f.type === 'percent' ? null : sourceBadge(f),
    ]);
    wrap.appendChild(head);

    let input;
    if (f.type === 'select') {
      input = el('select', { id }, f.options.map((o) => el('option', { value: String(o.value), text: o.label })));
      input.value = String(f.key in dirty ? dirty[f.key] : f.value);
      input.addEventListener('change', () => setDirty(f, Number(input.value)));
    } else if (f.type === 'number' || f.type === 'percent') {
      const pct = f.type === 'percent';
      const cur = f.key in dirty ? dirty[f.key] : f.value;
      input = el('input', {
        id, type: 'number', inputmode: 'decimal',
        min: pct ? f.min * 100 : f.min, max: pct ? f.max * 100 : f.max, step: pct ? 0.5 : f.step || 'any',
        value: cur === null || cur === undefined ? '' : String(pct ? +(cur * 100).toFixed(2) : cur),
      });
      input.addEventListener('input', () => {
        const raw = input.value.trim();
        if (raw === '') { dirty[f.key] = ''; updateSaveBar(); return; }
        const n = Number(raw);
        setDirty(f, pct ? +(n / 100).toFixed(4) : n);
      });
    } else if (f.type === 'secret') {
      input = el('input', {
        id, type: 'password', autocomplete: 'off', spellcheck: 'false',
        placeholder: f.isSet ? `${f.hint} — digite para substituir` : 'Não configurado',
        value: dirty[f.key] || '',
      });
      input.addEventListener('input', () => setDirty(f, input.value.trim()));
    } else {
      input = el('input', { id, type: 'text', spellcheck: 'false', placeholder: f.placeholder || '', value: f.key in dirty ? dirty[f.key] : f.value ?? '' });
      input.addEventListener('input', () => setDirty(f, input.value.trim()));
    }

    const row = el('div', { class: 'input-row' }, [input]);
    if (f.type === 'secret') {
      const show = el('button', { type: 'button', class: 'ghost-btn small', text: 'Mostrar', 'aria-controls': id });
      show.addEventListener('click', () => {
        const hidden = input.type === 'password';
        input.type = hidden ? 'text' : 'password';
        show.textContent = hidden ? 'Ocultar' : 'Mostrar';
      });
      row.appendChild(show);
      if ((f.source === 'panel' && f.isSet) || f.error) {
        const rm = el('button', { type: 'button', class: 'ghost-btn small danger', text: clears.has(f.key) ? 'Desfazer' : 'Remover' });
        rm.addEventListener('click', () => {
          clears.has(f.key) ? clears.delete(f.key) : clears.add(f.key);
          render();
          updateSaveBar();
        });
        row.appendChild(rm);
      }
    }
    if (f.picker === 'whatsappGroups') {
      const pick = el('button', { type: 'button', class: 'ghost-btn small', text: 'Buscar grupos' });
      pick.addEventListener('click', () => loadGroups(f, input, wrap, pick));
      row.appendChild(pick);
    }
    wrap.appendChild(row);

    if (f.help) wrap.appendChild(el('span', { class: 'field-help', text: f.help }));
    if (f.error) wrap.appendChild(el('span', { class: 'field-error', text: f.error }));
    if (fieldErrors[f.key]) wrap.appendChild(el('span', { class: 'field-error', role: 'alert', text: fieldErrors[f.key] }));
    return wrap;
  }

  async function loadGroups(f, input, wrap, btn) {
    btn.disabled = true;
    btn.textContent = 'Buscando…';
    const old = wrap.querySelector('.group-picker');
    if (old) old.remove();
    try {
      const instField = view.fields.find((x) => x.key === 'evolutionInstance');
      const instance = dirty.evolutionInstance ?? instField?.value ?? '';
      const { groups } = await api('GET', `api/settings/whatsapp/groups?instance=${encodeURIComponent(instance)}`);
      const sel = el('select', { class: 'group-picker', 'aria-label': 'Grupos do WhatsApp' }, [
        el('option', { value: '', text: groups.length ? `Escolha um dos ${groups.length} grupos…` : 'Nenhum grupo encontrado' }),
        ...groups.map((g) => el('option', { value: g.id, text: g.size ? `${g.subject} (${g.size} membros)` : g.subject })),
      ]);
      sel.addEventListener('change', () => {
        if (!sel.value) return;
        input.value = sel.value;
        setDirty(f, sel.value);
      });
      wrap.insertBefore(sel, wrap.children[2] || null);
      sel.focus();
    } catch (err) {
      wrap.appendChild(el('span', { class: 'field-error group-picker', role: 'alert', text: err.message }));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Buscar grupos';
    }
  }

  // ------------------------------------------------------------ teste de conexão
  async function runTest(group, out, btn) {
    btn.disabled = true;
    clear(out).append(el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Testando…');
    try {
      // envia só o que foi alterado neste grupo (valores ainda não salvos)
      const values = {};
      for (const f of view.fields) if (f.group === group.id && f.key in dirty) values[f.key] = dirty[f.key];
      if (group.id === 'whatsapp' && 'evolutionInstance' in dirty) values.evolutionInstance = dirty.evolutionInstance;
      const r = await api('POST', `api/settings/test/${group.test}`, { values });
      clear(out).append(icon(r.ok ? 'good' : 'critical'), el('span', { text: r.message }));
    } catch (err) {
      clear(out).append(icon('critical'), el('span', { text: err.message }));
    } finally {
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------ render
  function renderReadiness(r) {
    const root = clear($('readiness'));
    root.append(
      el('div', { class: 'readiness-head' }, [
        icon(r.ready ? 'good' : 'warning'),
        el('div', null, [
          el('strong', { text: r.ready ? 'Pronto para publicar' : 'Configuração incompleta' }),
          el('div', { class: 'muted small', text: r.ready
            ? 'O n8n lê estas configurações a cada execução — não é preciso reiniciar nada.'
            : 'Complete os itens abaixo para a esteira publicar ofertas.' }),
        ]),
      ]),
      el('ul', { class: 'readiness-list' }, r.items.map((i) =>
        el('li', null, [
          icon(i.enabled === false ? 'unknown' : i.ok ? 'good' : 'critical'),
          el('span', { class: 'readiness-label', text: i.label }),
          el('span', { class: 'muted small', text: i.detail }),
        ])
      ))
    );
  }

  function render() {
    renderReadiness(view.readiness);
    const root = clear($('settings-groups'));
    for (const g of view.groups) {
      const fields = view.fields.filter((f) => f.group === g.id);
      const card = el('section', { class: `card settings-card${g.id === 'search' ? ' wide' : ''}`, 'aria-labelledby': `g-${g.id}` }, [
        el('div', { class: 'card-head' }, [
          el('div', null, [el('h3', { id: `g-${g.id}`, text: g.title }), el('p', { class: 'muted small', text: g.description })]),
        ]),
        el('div', { class: 'fields' }, fields.map(renderField)),
      ]);
      if (g.test) {
        const out = el('span', { class: 'test-result', role: 'status' });
        const btn = el('button', { type: 'button', class: 'ghost-btn', text: 'Testar conexão' });
        btn.addEventListener('click', () => runTest(g, out, btn));
        card.appendChild(el('div', { class: 'group-foot' }, [btn, out]));
      }
      root.appendChild(card);
    }

    const infra = clear($('infra'));
    infra.append(
      el('dt', { text: 'URL da Evolution API' }), el('dd', { class: 'mono', text: view.infra.evolutionUrl }),
      el('dt', { text: 'API key da Evolution' }),
      el('dd', null, view.infra.evolutionApiKey.isSet
        ? [icon('good'), ` Definida (${view.infra.evolutionApiKey.hint})`]
        : [icon('critical'), ' Não definida — preencha EVOLUTION_API_KEY no .env'])
    );
    window.dispatchEvent(new CustomEvent('obs:readiness', { detail: view.readiness }));
  }

  async function load() {
    const status = $('save-status');
    try {
      view = await api('GET', 'api/settings');
      dirty = {};
      clears = new Set();
      fieldErrors = {};
      render();
      updateSaveBar();
    } catch (err) {
      clear($('settings-groups')).appendChild(el('div', { class: 'card empty', text: `Não foi possível carregar: ${err.message}` }));
      status.textContent = '';
    }
  }

  async function save(ev) {
    ev.preventDefault();
    const btn = $('save');
    btn.disabled = true;
    // número apagado no formulário = erro de validação no servidor
    const values = { ...dirty };
    try {
      const r = await api('PUT', 'api/settings', { values, clear: [...clears] });
      view = r.view;
      dirty = {};
      clears = new Set();
      fieldErrors = {};
      render();
      updateSaveBar();
      toast('Configurações salvas');
    } catch (err) {
      if (err.status === 422 && err.data?.fields) {
        fieldErrors = err.data.fields;
        render();
        $('save-status').textContent = 'Revise os campos destacados';
        const first = document.querySelector('.field.has-error input, .field.has-error select');
        if (first) first.focus();
      } else {
        $('save-status').textContent = `Erro ao salvar: ${err.message}`;
      }
    } finally {
      btn.disabled = false;
    }
  }

  $('settings-form').addEventListener('submit', save);
  $('discard').addEventListener('click', () => {
    dirty = {};
    clears = new Set();
    fieldErrors = {};
    render();
    updateSaveBar();
  });

  $('password-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const out = clear($('password-result'));
    try {
      await api('POST', 'api/auth/password', { current: form.current.value, next: form.next.value });
      form.reset();
      out.append(icon('good'), el('span', { text: 'Senha alterada' }));
    } catch (err) {
      out.append(icon('critical'), el('span', { text: err.message }));
    }
  });

  window.addEventListener('beforeunload', (ev) => {
    if (hasUnsaved()) { ev.preventDefault(); ev.returnValue = ''; }
  });

  window.ObsSettings = {
    load,
    hasUnsaved,
    discard() { dirty = {}; clears = new Set(); updateSaveBar(); },
    // usado pelo painel para o aviso de configuração incompleta
    async readiness() { return (await api('GET', 'api/settings')).readiness; },
  };
})();
