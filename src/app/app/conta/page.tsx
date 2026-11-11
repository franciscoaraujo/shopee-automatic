import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { logout } from '@/app/(auth)/actions';
import { Icon } from '@/components/icons';
import { buttonClass } from '@/components/md';
import { ACCOUNT_STATUSES, formatPrice } from '@/lib/plans';
import { accountBilling, listPlans } from '@/server/plans';
import { waLink } from '@/lib/site';
import { trialDaysLeft } from '@/server/accounts';
import { requireSession } from '@/server/session';
import { PasswordForm } from './password-form';

export const metadata: Metadata = { title: 'Conta' };
const d = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'America/Sao_Paulo' });

async function Content() {
  await connection();
  const { account, user } = await requireSession();
  const [billing, forSale] = await Promise.all([accountBilling(account), listPlans()]);
  const plan = billing.plan;
  // O plano atual aparece mesmo que tenha saído de venda
  const plans = forSale.some((p) => p.id === plan.id) ? forSale : [plan, ...forSale];
  const status = ACCOUNT_STATUSES.find((s) => s.value === account.status)?.label ?? account.status;
  const days = trialDaysLeft(account);

  return (
    <main className="mx-auto max-w-4xl px-5 py-8 md:py-12">
      <h1 className="text-display-s">Conta</h1>

      <section className="mt-8 rounded-xl border border-outline-variant/70 bg-surface-lowest p-6 md:p-8">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1">
            <p className="text-label-l text-on-surface-variant">Plano atual</p>
            <p className="mt-1 font-display text-3xl font-semibold">
              {plan.name}{' '}
              <span className="text-title-m font-normal text-on-surface-variant">
                · {billing.priceCents < billing.baseCents && <s className="mr-1">R$ {formatPrice(billing.baseCents)}</s>}R$ {billing.price}/mês
              </span>
            </p>
            {billing.reason && <p className="mt-1 text-body-m text-tertiary">{billing.reason}</p>}
            <p className="mt-2 text-body-m text-on-surface-variant">
              Situação: <b className="text-on-surface">{status}</b>
              {account.status === 'trial' && account.trial_ends_at && <> · teste até {d.format(new Date(account.trial_ends_at))} ({days} {days === 1 ? 'dia' : 'dias'})</>}
            </p>
          </div>
          <a href={waLink(`Olá! Quero ${account.status === 'active' ? 'mudar de plano' : 'assinar o AutoAchados'} (conta ${user.email}).`)} target="_blank" rel="noopener noreferrer" className={buttonClass(account.status === 'active' ? 'outlined' : 'filled')}>
            <Icon name="chat" size={20} /> {account.status === 'active' ? 'Mudar de plano' : 'Assinar agora'}
          </a>
        </div>

        <div className={`mt-8 grid gap-3 ${plans.length >= 4 ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-3'}`}>
          {plans.map((p) => (
            <div key={p.id} className={`rounded-lg border p-4 ${p.id === plan.id ? 'border-primary bg-primary/5' : 'border-outline-variant/70'}`}>
              <p className="flex items-center justify-between text-title-m">{p.name} {p.id === plan.id && <span className="text-label-m text-primary">atual</span>}</p>
              <p className="text-body-m text-on-surface-variant">
                {p.id === plan.id ? `R$ ${billing.price}/mês` : p.offer && p.offer.priceCents < p.priceCents ? <><s>R$ {p.price}</s> R$ {p.offer.price}/mês</> : `R$ ${p.price}/mês`}
              </p>
              <ul className="mt-3 space-y-1 text-body-s text-on-surface-variant">
                {p.items.slice(0, 3).map((i) => <li key={i} className="flex gap-1.5"><Icon name="check" size={16} className="text-primary" />{i}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 text-body-s text-on-surface-variant">A assinatura é ativada pelo suporte após o pagamento (Pix ou cartão).</p>
      </section>

      <section className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-outline-variant/70 bg-surface-lowest p-6 md:p-8">
          <h2 className="text-title-l">Seus dados</h2>
          <dl className="mt-4 space-y-3 text-body-l">
            <div><dt className="text-label-m text-on-surface-variant">Nome</dt><dd>{user.name}</dd></div>
            <div><dt className="text-label-m text-on-surface-variant">E-mail</dt><dd>{user.email}</dd></div>
            <div><dt className="text-label-m text-on-surface-variant">Cliente desde</dt><dd>{d.format(new Date(account.created_at))}</dd></div>
          </dl>
          <form action={logout} className="mt-6">
            <button type="submit" className={buttonClass('outlined')}><Icon name="logout" size={20} /> Sair</button>
          </form>
        </div>
        <div className="rounded-xl border border-outline-variant/70 bg-surface-lowest p-6 md:p-8">
          <h2 className="text-title-l">Trocar senha</h2>
          <p className="mt-1 text-body-m text-on-surface-variant">Encerra as outras sessões abertas.</p>
          <PasswordForm />
        </div>
      </section>
    </main>
  );
}

export default function ContaPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl px-5 py-12 text-body-l text-on-surface-variant">Carregando…</div>}>
      <Content />
    </Suspense>
  );
}
