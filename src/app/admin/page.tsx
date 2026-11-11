import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Logo } from '@/components/landing/chrome';
import { Icon } from '@/components/icons';
import { buttonClass } from '@/components/md';
import { adminConfigured, isAdmin } from '@/lib/admin-auth';
import { listAccounts, platformTotals } from '@/server/admin';
import { formatPrice } from '@/lib/plans';
import { listPlans } from '@/server/plans';
import { workerHealth } from '@/server/metrics';
import { adminLogout, confirmEmailAction, extendTrialAction } from './actions';
import { AdminLoginForm, DeleteAccount, PlanSelect, ResetPassword, StatusSelect } from './client';

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

const dt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const dd = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
const fmtPhone = (d: string | null) => {
  if (!d) return '—';
  const n = d.replace(/^55/, '');
  return n.length === 11 ? `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}` : `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
};

function Shell({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex-1 bg-surface-low">
      <header className="border-b border-outline-variant bg-surface">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-5">
          <Logo />
          <span className="rounded-sm bg-inverse-surface px-2 py-0.5 text-label-m text-inverse-on-surface">Admin</span>
          <div className="ml-auto">{right}</div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-5 py-10">{children}</main>
    </div>
  );
}

async function Content() {
  await connection();
  if (!adminConfigured()) {
    return (
      <Shell>
        <div className="mx-auto max-w-lg rounded-xl bg-surface-lowest p-8 shadow-e1">
          <h1 className="text-headline-s">Área administrativa desativada</h1>
          <p className="mt-3 text-body-l text-on-surface-variant">Defina <code className="rounded-xs bg-surface-container px-1.5 font-mono text-body-m">ADMIN_PASSWORD</code> (mínimo de 8 caracteres) e reinicie.</p>
        </div>
      </Shell>
    );
  }
  if (!(await isAdmin())) return <Shell><AdminLoginForm /></Shell>;

  const [accounts, totals, worker, allPlans] = await Promise.all([listAccounts(), platformTotals(), workerHealth(), listPlans({ all: true })]);
  const planOptions = allPlans.map((p) => ({ id: p.id, name: p.visible === false ? `${p.name} (oculto)` : p.name }));

  return (
    <Shell right={<form action={adminLogout}><button className={buttonClass('text')}><Icon name="logout" size={20} /> Sair</button></form>}>
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-display-s">Clientes</h1>
          <p className={`mt-1 inline-flex items-center gap-1.5 text-body-m ${worker.ok ? 'text-success' : 'text-error'}`}>
            <Icon name={worker.ok ? 'check_circle_fill' : 'error_fill'} size={18} />
            Worker {worker.ok ? 'ativo' : worker.lastSeen ? `parado desde ${dt.format(new Date(worker.lastSeen))}` : 'nunca iniciou'}
          </p>
        </div>
        <a href="/admin/clientes.csv" className={buttonClass('tonal')}><Icon name="download" size={20} /> Exportar CSV</a>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['Clientes', totals.accounts],
          ['Ativos (pagantes)', totals.active],
          ['Em teste', totals.trial],
          ['Teste expirado', totals.trialExpired],
          ['Receita mensal (ativos)', `R$ ${formatPrice(Math.round(totals.mrr * 100))}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-surface-lowest p-5">
            <p className="text-label-m text-on-surface-variant">{k}</p>
            <p className="mt-1 font-display text-3xl font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>

      {accounts.length === 0 ? (
        <div className="mt-8 rounded-xl bg-surface-lowest p-12 text-center text-body-l text-on-surface-variant">Nenhum cliente ainda. As contas criadas em /cadastro aparecem aqui.</div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-xl bg-surface-lowest">
          <table className="w-full min-w-[1100px] text-left text-body-m">
            <thead className="border-b border-outline-variant text-label-m text-on-surface-variant">
              <tr>{['Cliente', 'Contato', 'Situação', 'Plano', 'Teste até', 'Uso (7 dias)', 'Última rodada', 'Ações'].map((h) => <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/70 align-top">
              {accounts.map((a) => {
                const expired = a.trial_expired;
                return (
                  <tr key={a.id} className="hover:bg-surface-low">
                    <td className="px-4 py-3">
                      <p className="text-title-s">{a.name}</p>
                      <p className="text-body-s text-on-surface-variant">desde {dt.format(new Date(a.created_at))}</p>
                      {a.source && <p className="font-mono text-body-s text-on-surface-variant">{a.source}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <a className="block text-primary hover:underline" href={`mailto:${a.email}`}>{a.email}</a>
                      {!a.email_verified && (
                        <form action={confirmEmailAction} className="mt-1 flex items-center gap-2">
                          <input type="hidden" name="id" value={a.id} />
                          <span className="rounded-xs bg-tertiary/10 px-1.5 text-label-s text-tertiary">e-mail não confirmado</span>
                          <button className="text-label-m text-primary hover:underline">Confirmar</button>
                        </form>
                      )}
                      {a.whatsapp && <a className="block whitespace-nowrap text-on-surface-variant hover:underline" href={`https://wa.me/${a.whatsapp}`} target="_blank" rel="noopener noreferrer">{fmtPhone(a.whatsapp)}</a>}
                    </td>
                    <td className="px-4 py-3"><StatusSelect id={a.id} value={a.status} /></td>
                    <td className="px-4 py-3">
                      <PlanSelect id={a.id} value={a.plan} plans={planOptions} />
                      {a.custom_price && <p className="mt-1 text-body-s text-tertiary" title={a.custom_price.reason ?? undefined}>R$ {a.custom_price.price}{a.custom_price.reason ? ` · ${a.custom_price.reason}` : ''}</p>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {a.trial_ends_at ? <span className={expired ? 'text-error' : ''}>{dd.format(new Date(a.trial_ends_at))}{expired && ' (expirado)'}</span> : '—'}
                      {a.status === 'trial' && (
                        <form action={extendTrialAction} className="mt-1">
                          <input type="hidden" name="id" value={a.id} />
                          <button className="text-label-m text-primary hover:underline">+7 dias</button>
                        </form>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {a.published_7d} ofertas{a.failures_7d > 0 && <span className="block text-body-s text-error">{a.failures_7d} falhas</span>}
                      {!a.has_shopee && <span className="block text-body-s text-on-surface-variant">Shopee não configurada</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-on-surface-variant">{a.last_run_at ? dt.format(new Date(a.last_run_at)) : 'nunca'}</td>
                    <td className="px-4 py-3"><ResetPassword id={a.id} /><br /><DeleteAccount id={a.id} email={a.email} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="p-10 text-body-l text-on-surface-variant">Carregando…</div>}>
      <Content />
    </Suspense>
  );
}
