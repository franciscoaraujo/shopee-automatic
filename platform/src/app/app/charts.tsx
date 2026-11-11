'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@/components/icons';
import { Button } from '@/components/md';
import { SERIES, type ChannelKey } from '@/lib/channels';
import { runNowAction } from './actions';

type Key = ChannelKey;

type Point = { bucket: string; whatsapp: number; telegram: number; failures: number };

function niceMax(v: number) {
  if (v <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return Math.ceil((m * step) / 4) * 4;
  return Math.ceil(v);
}

const fmtBucket = (iso: string, unit: 'hour' | 'day', long = false) => {
  const [d, t] = iso.split('T');
  const [, m, day] = d.split('-');
  if (unit === 'hour') return long ? `${day}/${m} ${t.slice(0, 2)}h` : `${t.slice(0, 2)}h`;
  return `${day}/${m}`;
};

export function SeriesChart({ data, unit, keys }: { data: Point[]; unit: 'hour' | 'day'; keys: Key[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 720, H = 220, PL = 32, PR = 8, PT = 12, PB = 26;
  const totals = data.map((p) => keys.reduce((s, k) => s + p[k], 0));
  const max = niceMax(Math.max(1, ...totals));
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const bw = (W - PL - PR) / data.length;
  const y = (v: number) => PT + (H - PT - PB) * (1 - v / max);
  const labelEvery = Math.ceil(data.length / 8);

  return (
    <figure>
      <figcaption className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        {keys.length > 1 && keys.map((k) => (
          <span key={k} className="inline-flex items-center gap-2 text-body-m text-on-surface-variant">
            <span className="size-3 rounded-[3px]" style={{ background: SERIES[k].color }} aria-hidden /> {SERIES[k].label}
          </span>
        ))}
        <button type="button" onClick={() => setTable((t) => !t)} className="state-layer ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-label-l text-primary">
          <Icon name={table ? 'bar_chart' : 'table_view'} size={18} /> {table ? 'Ver gráfico' : 'Ver tabela'}
        </button>
      </figcaption>

      {table ? (
        <div className="max-h-72 overflow-auto rounded-md border border-outline-variant/70">
          <table className="w-full text-left text-body-m">
            <thead className="sticky top-0 bg-surface-low text-label-m text-on-surface-variant">
              <tr><th className="px-3 py-2">Período</th>{keys.map((k) => <th key={k} className="px-3 py-2 text-right">{SERIES[k].label}</th>)}<th className="px-3 py-2 text-right">Falhas</th></tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/50 tabular-nums">
              {[...data].reverse().map((p) => (
                <tr key={p.bucket}><td className="px-3 py-1.5">{fmtBucket(p.bucket, unit, true)}</td>{keys.map((k) => <td key={k} className="px-3 py-1.5 text-right">{p[k]}</td>)}<td className="px-3 py-1.5 text-right">{p.failures}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ofertas enviadas com sucesso por período" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke="var(--md-outline-variant)" strokeWidth={1} strokeDasharray={t === 0 ? undefined : '2 4'} />
                <text x={PL - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-on-surface-variant text-[10px] tabular-nums">{t}</text>
              </g>
            ))}
            {data.map((p, i) => {
              const x = PL + i * bw;
              const w = Math.max(2, Math.min(28, bw - 4));
              const cx = x + (bw - w) / 2;
              let acc = 0;
              const segs = keys.filter((k) => p[k] > 0);
              return (
                <g key={p.bucket}>
                  {hover === i && <rect x={x} y={PT} width={bw} height={H - PT - PB} fill="var(--md-on-surface)" opacity={0.05} />}
                  {segs.map((k, si) => {
                    const y0 = y(acc), y1 = y(acc + p[k]);
                    acc += p[k];
                    const top = si === segs.length - 1;
                    const h = Math.max(0, y0 - y1 - (top ? 0 : 2)); // 2px de respiro entre segmentos
                    const r = top ? Math.min(4, h, w / 2) : 0;
                    return (
                      <path key={k} fill={SERIES[k].color}
                        d={`M${cx},${y0} V${y1 + (top ? 0 : 2) + r} ${r ? `Q${cx},${y1} ${cx + r},${y1}` : ''} H${cx + w - r} ${r ? `Q${cx + w},${y1} ${cx + w},${y1 + r}` : ''} V${y0} Z`} />
                    );
                  })}
                  {i % labelEvery === 0 && (
                    <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="fill-on-surface-variant text-[10px]">{fmtBucket(p.bucket, unit)}</text>
                  )}
                  <rect x={x} y={PT} width={bw} height={H - PT - PB} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1} />
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-sm bg-inverse-surface px-3 py-2 text-body-s text-inverse-on-surface shadow-e2"
              style={{ left: `clamp(0px, calc(${((PL + hover * bw + bw / 2) / W) * 100}% - 72px), calc(100% - 150px))` }}
              role="status"
            >
              <p className="mb-1 text-label-m">{fmtBucket(data[hover].bucket, unit, true)}</p>
              {keys.map((k) => (
                <p key={k} className="flex items-center justify-between gap-4 tabular-nums">
                  <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: SERIES[k].color }} />{SERIES[k].label}</span>
                  {data[hover][k]}
                </p>
              ))}
              {data[hover].failures > 0 && <p className="mt-1 flex justify-between gap-4 tabular-nums text-inverse-primary"><span>Falhas</span>{data[hover].failures}</p>}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

export function RunNow({ disabled }: { disabled?: boolean }) {
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button type="button" variant="tonal" icon="play_arrow" disabled={disabled || pending} onClick={() => start(async () => setMsg(await runNowAction()))}>
        {pending ? 'Enviando…' : 'Rodar agora'}
      </Button>
      {msg && <p className={`text-body-s ${msg.ok ? 'text-success' : 'text-error'}`} role="status">{msg.message}</p>}
    </div>
  );
}
