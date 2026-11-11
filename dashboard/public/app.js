/* Painel de observabilidade — esteira Shopee -> Telegram + WhatsApp
 * Sem dependências. Todo texto vindo da API é inserido via textContent. */
(function () {
  'use strict';

  const REFRESH_MS = 30000;
  const SERIES = [
    { key: 'telegram', name: 'Telegram', color: 'var(--series-1)' },
    { key: 'whatsapp', name: 'WhatsApp', color: 'var(--series-2)' },
  ];
  const STATUS_ICON = { good: '✓', warning: '!', serious: '!', critical: '✕', unknown: '?' };
  const STATUS_TEXT = { good: 'Saudável', warning: 'Atenção', serious: 'Degradado', critical: 'Crítico', unknown: 'Sem dados' };
  const HEALTH_NAMES = {
    n8n: 'n8n',
    shopee: 'API Shopee',
    whatsapp: 'WhatsApp (Evolution)',
    telegram: 'Bot do Telegram',
    postgres: 'PostgreSQL',
    redis: 'Redis',
  };

  let range = localStorage.getItem('obs-range') || '24h';
  let lastSummary = null;
  let timer = null;

  // ------------------------------------------------------------ utilitários
  const $ = (id) => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, props, children) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'style') Object.assign(n.style, v);
        else n.setAttribute(k, v);
      }
    }
    for (const c of [].concat(children || [])) {
      if (c === null || c === undefined || c === false) continue;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return n;
  }
  function svg(tag, attrs, style) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    if (style) Object.assign(n.style, style);
    return n;
  }
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

  const fmtInt = (v) => {
    const n = Number(v) || 0;
    return Math.abs(n) >= 10000
      ? new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
      : new Intl.NumberFormat('pt-BR').format(n);
  };
  const fmtBRL = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
  const fmtPct = (v, d = 1) =>
    new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: d, minimumFractionDigits: 0 }).format(v);
  const fmtTime = (iso) =>
    iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  function fmtAgo(iso) {
    if (!iso) return '—';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'agora';
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
    return `há ${Math.floor(s / 86400)} d`;
  }
  const fmtDuration = (ms) => (ms === null || ms === undefined ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
  function safeUrl(u) {
    try {
      const x = new URL(u);
      return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null;
    } catch { return null; }
  }
  const statusIcon = (status) =>
    el('span', { class: `status-icon ${status}`, 'aria-hidden': 'true', text: STATUS_ICON[status] || '?' });

  // ------------------------------------------------------------ tooltip
  const tip = $('tooltip');
  function showTip(x, y, title, rows) {
    clear(tip);
    tip.appendChild(el('div', { class: 'tt-title', text: title }));
    for (const r of rows) {
      tip.appendChild(
        el('div', { class: 'tt-row' }, [
          r.color ? el('span', { class: 'key-line', style: { background: r.color } }) : el('span', { class: 'key-line' }),
          el('strong', { text: r.value }),
          el('span', { text: r.label }),
        ])
      );
    }
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + 14, top = y - h - 10;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top < 8) top = y + 14;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  const hideTip = () => { tip.hidden = true; };

  // ------------------------------------------------------------ tabela genérica
  function table(columns, rows, emptyText) {
    if (!rows.length) return el('div', { class: 'empty', text: emptyText || 'Sem dados no período' });
    return el('table', null, [
      el('thead', null, el('tr', null, columns.map((c) => el('th', { class: c.num ? 'num' : null, scope: 'col', text: c.label })))),
      el('tbody', null, rows.map((r) =>
        el('tr', null, columns.map((c) => {
          const v = c.render(r);
          return el('td', { class: c.num ? 'num' : null }, v instanceof Node ? v : String(v ?? '—'));
        }))
      )),
    ]);
  }

  // ------------------------------------------------------------ saúde
  function renderHealth(h) {
    const root = clear($('health'));
    for (const key of Object.keys(HEALTH_NAMES)) {
      const s = h?.[key] || { status: 'unknown', label: 'Sem dados', detail: '' };
      root.appendChild(
        el('div', { class: 'card health-card', title: s.checkedAt ? `Verificado ${fmtAgo(s.checkedAt)}` : null }, [
          statusIcon(s.status),
          el('div', null, [
            el('div', { class: 'health-name', text: HEALTH_NAMES[key] }),
            el('div', { class: 'health-label', text: s.label }),
            s.detail ? el('div', { class: 'health-detail', text: s.detail }) : null,
          ]),
        ])
      );
    }
  }

  // ------------------------------------------------------------ KPIs
  function delta(cur, prev, formatter) {
    if (!prev && !cur) return el('span', { class: 'delta flat', text: 'sem variação' });
    if (!prev) return el('span', { class: 'delta up', text: '▲ novo no período' });
    const d = (cur - prev) / prev;
    if (Math.abs(d) < 0.005) return el('span', { class: 'delta flat', text: '— estável' });
    const up = d > 0;
    return el('span', { class: `delta ${up ? 'up' : 'down'}` },
      `${up ? '▲' : '▼'} ${fmtPct(Math.abs(d), 0)} (antes: ${formatter(prev)})`);
  }
  const PERIOD_LABEL = { '24h': 'vs 24 h anteriores', '7d': 'vs 7 dias anteriores', '30d': 'vs 30 dias anteriores' };

  function renderKpis(s) {
    const k = s.kpis;
    const hero = clear($('kpi-hero'));
    hero.append(
      el('div', { class: 'tile-label', text: 'Ofertas publicadas' }),
      el('div', { class: 'tile-value', text: fmtInt(k.published) }),
      el('div', { class: 'tile-foot' }, [delta(k.published, k.publishedPrev, fmtInt), ` ${PERIOD_LABEL[s.range]}`])
    );

    const tg = k.channels.telegram, wa = k.channels.whatsapp;
    const ok = tg.ok + wa.ok, total = tg.total + wa.total;
    const tiles = [
      {
        label: 'Comissão potencial estimada',
        value: fmtBRL(k.commission),
        foot: [delta(k.commission, k.commissionPrev, fmtBRL), ' · se cada oferta vender 1 unidade'],
      },
      {
        label: 'Taxa de entrega',
        value: total ? fmtPct(ok / total) : '—',
        foot: [`${fmtInt(ok)} de ${fmtInt(total)} envios · ${fmtInt(k.failures)} falha${k.failures === 1 ? '' : 's'}`],
      },
      {
        label: 'Execuções registradas',
        value: fmtInt(k.runs),
        foot: [`${fmtInt(k.runErrors)} com erro · última ${fmtAgo(k.lastRunAt)}`],
      },
      {
        label: 'Produtos analisados',
        value: fmtInt(k.found),
        foot: [k.found ? `${fmtPct(k.published / k.found)} viraram publicação` : 'Nenhuma busca no período'],
      },
    ];
    const root = clear($('kpi-tiles'));
    for (const t of tiles) {
      root.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'tile-label', text: t.label }),
        el('div', { class: 'tile-value', text: t.value }),
        el('div', { class: 'tile-foot' }, t.foot),
      ]));
    }
  }

  // ------------------------------------------------------------ gráfico de linhas
  function bucketLabel(bucket, unit, long) {
    const [d, t] = bucket.split('T');
    const [y, m, day] = d.split('-');
    if (unit === 'hour') return long ? `${day}/${m} às ${t.slice(0, 2)}h` : `${t.slice(0, 2)}h`;
    return long ? `${day}/${m}/${y}` : `${day}/${m}`;
  }
  // Topo do eixo = 4 passos inteiros "redondos" (contagens nunca têm fração)
  function niceMax(v, ticks) {
    const raw = Math.max(1, v / ticks);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (m * mag >= raw) return Math.max(1, m * mag) * ticks;
    return 10 * mag * ticks;
  }

  function renderSeries(s) {
    const unit = s.unit;
    $('series-title').textContent = unit === 'hour' ? 'Envios com sucesso por hora' : 'Envios com sucesso por dia';

    const legend = clear($('series-legend'));
    for (const se of SERIES) {
      legend.appendChild(el('span', { class: 'legend-item' }, [
        el('span', { class: 'key-line', style: { background: se.color } }), se.name,
      ]));
    }

    const data = s.series;
    const root = clear($('series-chart'));
    const W = Math.max(root.clientWidth, 320);
    const M = { top: 12, right: 96, bottom: 28, left: 40 };
    const PH = 220;
    const H = PH + M.top + M.bottom;
    const PW = W - M.left - M.right;
    const n = data.length;
    const maxV = Math.max(0, ...data.flatMap((d) => SERIES.map((se) => d[se.key])));
    const ticks = 4;
    const yMax = niceMax(maxV, ticks);
    const step = n > 1 ? PW / (n - 1) : 0;
    const x = (i) => M.left + i * step;
    const y = (v) => M.top + PH - (v / yMax) * PH;

    const total = data.reduce((a, d) => a + d.telegram + d.whatsapp, 0);
    const root$ = svg('svg', {
      viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', tabindex: '0',
      'aria-label': `Envios com sucesso por ${unit === 'hour' ? 'hora' : 'dia'}: ${total} no período. Use as setas para navegar.`,
    });

    // grade + eixo Y
    for (let i = 0; i <= ticks; i++) {
      const v = (yMax / ticks) * i;
      const yy = Math.round(y(v)) + 0.5;
      root$.appendChild(svg('line', { x1: M.left, x2: M.left + PW, y1: yy, y2: yy, class: i === 0 ? 'baseline' : 'gridline' }));
      const t = svg('text', { x: M.left - 8, y: yy + 4, 'text-anchor': 'end', class: 'axis-text' });
      t.textContent = fmtInt(v);
      root$.appendChild(t);
    }
    // eixo X
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(PW / 52))));
    data.forEach((d, i) => {
      if ((n - 1 - i) % every !== 0) return; // garante o rótulo do bucket mais recente
      const t = svg('text', { x: x(i), y: M.top + PH + 18, 'text-anchor': 'middle', class: 'axis-text' });
      t.textContent = bucketLabel(d.bucket, unit, false);
      root$.appendChild(t);
    });

    // linhas
    for (const se of SERIES) {
      const dAttr = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[se.key]).toFixed(1)}`).join(' ');
      root$.appendChild(svg('path', { d: dAttr, fill: 'none', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, { stroke: se.color }));
    }
    // marcadores finais com anel na cor da superfície + rótulos diretos (se não colidirem)
    const last = data[n - 1];
    const ends = SERIES.map((se) => ({ se, v: last[se.key], yy: y(last[se.key]) }));
    for (const e of ends) {
      root$.appendChild(svg('circle', { cx: x(n - 1), cy: e.yy, r: 4, 'stroke-width': 2 }, { fill: e.se.color, stroke: 'var(--surface-1)' }));
    }
    if (Math.abs(ends[0].yy - ends[1].yy) >= 16) {
      for (const e of ends) {
        const t = svg('text', { x: x(n - 1) + 10, y: e.yy + 4, class: 'end-label' });
        t.textContent = `${e.se.name} ${fmtInt(e.v)}`;
        root$.appendChild(t);
      }
    }

    // camada de hover: crosshair + pontos destacados
    const cross = svg('line', { y1: M.top, y2: M.top + PH, class: 'crosshair', visibility: 'hidden' });
    const hoverDots = SERIES.map((se) => svg('circle', { r: 4, 'stroke-width': 2, visibility: 'hidden' }, { fill: se.color, stroke: 'var(--surface-1)' }));
    root$.appendChild(cross);
    hoverDots.forEach((c) => root$.appendChild(c));
    const hit = svg('rect', { x: M.left - step / 2, y: M.top, width: PW + step, height: PH, fill: 'transparent' });
    root$.appendChild(hit);

    let idx = -1;
    function focusIndex(i, clientX, clientY) {
      idx = Math.max(0, Math.min(n - 1, i));
      const d = data[idx];
      const cx = x(idx);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      SERIES.forEach((se, k) => {
        hoverDots[k].setAttribute('cx', cx);
        hoverDots[k].setAttribute('cy', y(d[se.key]));
        hoverDots[k].setAttribute('visibility', 'visible');
      });
      const rows = SERIES.map((se) => ({ color: se.color, value: fmtInt(d[se.key]), label: se.name }));
      rows.push({ value: fmtInt(d.failures), label: 'falhas de envio' });
      if (clientX === undefined) {
        const r = root$.getBoundingClientRect();
        clientX = r.left + (cx / W) * r.width;
        clientY = r.top + (M.top / H) * r.height + 20;
      }
      showTip(clientX, clientY, bucketLabel(d.bucket, unit, true), rows);
    }
    function blur() {
      idx = -1;
      cross.setAttribute('visibility', 'hidden');
      hoverDots.forEach((c) => c.setAttribute('visibility', 'hidden'));
      hideTip();
    }
    hit.addEventListener('pointermove', (ev) => {
      const r = root$.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      focusIndex(step ? Math.round((px - M.left) / step) : 0, ev.clientX, ev.clientY);
    });
    hit.addEventListener('pointerleave', blur);
    root$.addEventListener('focus', () => focusIndex(n - 1));
    root$.addEventListener('blur', blur);
    root$.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowLeft') { focusIndex(idx - 1); ev.preventDefault(); }
      if (ev.key === 'ArrowRight') { focusIndex(idx + 1); ev.preventDefault(); }
      if (ev.key === 'Escape') blur();
    });

    root.appendChild(root$);

    // visão em tabela
    clear($('series-table')).appendChild(table(
      [
        { label: unit === 'hour' ? 'Hora' : 'Dia', render: (d) => bucketLabel(d.bucket, unit, true) },
        { label: 'Telegram', num: true, render: (d) => fmtInt(d.telegram) },
        { label: 'WhatsApp', num: true, render: (d) => fmtInt(d.whatsapp) },
        { label: 'Falhas', num: true, render: (d) => fmtInt(d.failures) },
      ],
      data.slice().reverse()
    ));
  }

  // ------------------------------------------------------------ canais (medidores)
  function renderChannels(s) {
    const root = clear($('channels'));
    SERIES.forEach((se) => {
      const c = s.kpis.channels[se.key];
      const rate = c.total ? c.ok / c.total : null;
      const status = rate === null ? 'unknown' : rate >= 0.95 ? 'good' : rate >= 0.8 ? 'warning' : 'critical';
      root.appendChild(el('div', { class: `meter ${status}` }, [
        el('div', { class: 'meter-head' }, [
          el('span', { class: 'meter-name' }, [el('span', { class: 'key-dot', style: { background: se.color } }), se.name]),
          el('span', { class: 'meter-value', text: rate === null ? '—' : fmtPct(rate) }),
        ]),
        el('div', {
          class: 'meter-track', role: 'meter', 'aria-label': `Taxa de entrega ${se.name}`,
          'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': rate === null ? '0' : String(Math.round(rate * 100)),
        }, el('div', { class: 'meter-fill', style: { width: `${rate === null ? 0 : rate * 100}%` } })),
        el('div', { class: 'meter-foot' }, [
          el('span', { class: 'status-tag' }, [statusIcon(status), STATUS_TEXT[status]]),
          el('span', { class: 'num', text: c.total ? `${fmtInt(c.ok)} de ${fmtInt(c.total)} envios` : 'Nenhum envio no período' }),
        ]),
      ]));
    });
  }

  // ------------------------------------------------------------ palavras-chave (barras horizontais)
  function renderKeywords(s) {
    const data = s.keywords;
    const root = clear($('keywords-chart'));
    if (!data.length) {
      root.appendChild(el('div', { class: 'empty', text: 'Nenhuma oferta publicada no período' }));
    } else {
      const max = Math.max(...data.map((d) => d.published));
      for (const d of data) {
        const row = el('div', {
          class: 'hbar-row', tabindex: '0',
          'aria-label': `${d.keyword}: ${d.published} ofertas, comissão potencial ${fmtBRL(d.commission)}`,
        }, [
          el('span', { class: 'hbar-label', text: d.keyword, title: d.keyword }),
          el('span', { class: 'hbar-track' }, [
            el('span', { class: 'hbar', style: { width: `calc((100% - 4ch) * ${d.published / max})` } }),
            el('span', { class: 'hbar-value', text: fmtInt(d.published) }),
          ]),
        ]);
        const show = (ev) => {
          const r = row.getBoundingClientRect();
          showTip(ev && ev.clientX !== undefined ? ev.clientX : r.left + r.width / 2, ev && ev.clientY !== undefined ? ev.clientY : r.top, d.keyword, [
            { color: 'var(--series-1)', value: fmtInt(d.published), label: 'ofertas publicadas' },
            { value: fmtBRL(d.commission), label: 'comissão potencial' },
          ]);
        };
        row.addEventListener('pointermove', show);
        row.addEventListener('pointerleave', hideTip);
        row.addEventListener('focus', () => show());
        row.addEventListener('blur', hideTip);
        root.appendChild(row);
      }
    }
    clear($('keywords-table')).appendChild(table(
      [
        { label: 'Palavra-chave', render: (d) => d.keyword },
        { label: 'Ofertas', num: true, render: (d) => fmtInt(d.published) },
        { label: 'Comissão potencial', num: true, render: (d) => fmtBRL(d.commission) },
      ],
      data
    ));
  }

  // ------------------------------------------------------------ tabelas
  function channelCell(v) {
    if (v === null || v === undefined) return el('span', { class: 'status-tag' }, [statusIcon('unknown'), 'Não enviado']);
    return v
      ? el('span', { class: 'status-tag' }, [statusIcon('good'), 'Entregue'])
      : el('span', { class: 'status-tag' }, [statusIcon('critical'), 'Falhou']);
  }

  function renderOffers(s) {
    clear($('offers')).appendChild(table(
      [
        {
          label: 'Produto',
          render: (o) => {
            const img = safeUrl(o.imageUrl);
            const link = safeUrl(o.affiliateLink);
            const name = link
              ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer', class: 'product-name', text: o.productName || o.itemId })
              : el('span', { class: 'product-name', text: o.productName || o.itemId });
            return el('div', { class: 'product' }, [
              img ? el('img', { class: 'thumb', src: img, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: 'thumb' }),
              el('div', null, [name, el('div', { class: 'product-sub', text: `${o.keyword || 'sem palavra-chave'} · ${fmtAgo(o.sentAt)}` })]),
            ]);
          },
        },
        { label: 'Preço', num: true, render: (o) => (o.price === null ? '—' : fmtBRL(o.price)) },
        { label: 'Comissão', num: true, render: (o) => (o.commissionRate === null ? '—' : fmtPct(o.commissionRate)) },
        { label: 'Ganho/venda', num: true, render: (o) => (o.commission === null ? '—' : fmtBRL(o.commission)) },
        { label: 'Telegram', render: (o) => channelCell(o.telegram) },
        { label: 'WhatsApp', render: (o) => channelCell(o.whatsapp) },
      ],
      s.offers,
      'Nenhuma oferta enviada no período'
    ));
  }

  const SOURCE = {
    telegram: { name: 'Telegram', color: 'var(--series-1)' },
    whatsapp: { name: 'WhatsApp', color: 'var(--series-2)' },
    shopee: { name: 'API Shopee', color: null },
  };
  function renderErrors(s) {
    clear($('errors')).appendChild(table(
      [
        { label: 'Quando', render: (e) => el('span', { class: 'num', text: fmtTime(e.created_at) }) },
        {
          label: 'Origem',
          render: (e) => {
            const src = SOURCE[e.source] || { name: e.source };
            return el('span', { class: 'source' }, [
              src.color ? el('span', { class: 'key-dot', style: { background: src.color } }) : null, src.name,
            ]);
          },
        },
        {
          label: 'Mensagem',
          render: (e) => el('div', null, [
            el('div', { class: 'err-msg', text: e.message || 'Erro sem mensagem' }),
            e.context ? el('div', { class: 'product-sub', text: e.context }) : null,
          ]),
        },
      ],
      s.errors,
      'Nenhum erro no período ✓'
    ));
  }

  const EXEC_STATUS = {
    success: ['good', 'Sucesso'], error: ['critical', 'Erro'], crashed: ['critical', 'Travou'],
    running: ['warning', 'Executando'], waiting: ['warning', 'Aguardando'], canceled: ['unknown', 'Cancelada'],
  };
  function renderExecutions(x) {
    const root = clear($('executions'));
    if (!x || !x.enabled) {
      root.appendChild(el('div', { class: 'empty' }, [
        'Defina N8N_API_KEY no .env para listar as execuções ',
        el('br'),
        '(n8n → Settings → n8n API → Create an API key).',
      ]));
      return;
    }
    if (x.error) {
      root.appendChild(el('div', { class: 'empty', text: x.error }));
      return;
    }
    root.appendChild(table(
      [
        { label: '#', render: (e) => el('span', { class: 'num', text: e.id }) },
        {
          label: 'Status',
          render: (e) => {
            const [st, label] = EXEC_STATUS[e.status] || ['unknown', e.status || '—'];
            return el('span', { class: 'status-tag' }, [statusIcon(st), label]);
          },
        },
        { label: 'Modo', render: (e) => (e.mode === 'trigger' ? 'agendado' : e.mode === 'manual' ? 'manual' : e.mode || '—') },
        { label: 'Início', render: (e) => el('span', { class: 'num', text: fmtTime(e.startedAt) }) },
        { label: 'Duração', num: true, render: (e) => fmtDuration(e.durationMs) },
      ],
      x.items,
      'Nenhuma execução encontrada'
    ));
  }

  // ------------------------------------------------------------ ciclo de atualização
  async function getJson(url) {
    const r = await fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
    if (r.status === 401) {
      window.dispatchEvent(new Event('obs:unauthorized'));
      throw new Error('Sessão expirada');
    }
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
    return r.json();
  }

  function renderAll(summary) {
    renderKpis(summary);
    renderSeries(summary);
    renderChannels(summary);
    renderKeywords(summary);
    renderOffers(summary);
    renderErrors(summary);
  }

  let running = false;

  async function refresh() {
    clearTimeout(timer);
    if (!running) return;
    const main = $('main');
    main.classList.add('is-loading'); // mantém o frame anterior em opacidade reduzida
    try {
      // cada bloco renderiza assim que chega: um serviço lento no health check
      // (ex.: container parado) não segura o resto do painel
      const healthP = getJson('api/health').then(renderHealth).catch(() => {});
      const execP = getJson('api/executions')
        .catch((e) => ({ enabled: true, error: e.message, items: [] }))
        .then(renderExecutions);
      const summary = await getJson(`api/summary?range=${encodeURIComponent(range)}`);
      lastSummary = summary;
      renderAll(summary);
      main.classList.remove('is-loading');
      await Promise.all([healthP, execP]);
      $('updated').textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR')} · atualização automática a cada 30 s`;
    } catch (err) {
      $('updated').textContent = `Falha ao atualizar: ${err.message} — nova tentativa em 30 s`;
    } finally {
      main.classList.remove('is-loading');
      if (running) timer = setTimeout(refresh, REFRESH_MS);
    }
  }

  // filtros
  document.querySelectorAll('.chip[data-range]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.range === range));
    b.addEventListener('click', () => {
      range = b.dataset.range;
      localStorage.setItem('obs-range', range);
      document.querySelectorAll('.chip[data-range]').forEach((o) => o.setAttribute('aria-checked', String(o === b)));
      refresh();
    });
  });

  // alternância gráfico / tabela
  document.querySelectorAll('[data-table-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.tableToggle;
      const tbl = $(`${key}-table`);
      const chart = $(`${key}-chart`);
      const showTable = tbl.hidden;
      tbl.hidden = !showTable;
      chart.hidden = showTable;
      const legend = $(`${key}-legend`);
      if (legend) legend.hidden = showTable;
      btn.textContent = showTable ? 'Ver gráfico' : 'Ver tabela';
    });
  });

  // redimensionamento: redesenha só o gráfico de linhas
  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => running && lastSummary && renderSeries(lastSummary), 150);
  });

  // Controlado por shell.js (login e navegação entre abas)
  window.ObsDashboard = {
    start() {
      running = true;
      refresh();
    },
    stop() {
      running = false;
      clearTimeout(timer);
      hideTip();
    },
    redraw() {
      if (lastSummary) renderSeries(lastSummary);
    },
  };
})();
