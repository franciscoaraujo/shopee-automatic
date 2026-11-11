import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ResendVerification } from '@/app/(auth)/forms';
import { Icon } from '@/components/icons';
import { Logo } from '@/components/landing/chrome';

export const metadata: Metadata = { title: 'Confirme seu e-mail', robots: { index: false } };

async function Content({ searchParams }: { searchParams: PageProps<'/verifique-email'>['searchParams'] }) {
  const sp = await searchParams;
  const email = typeof sp.email === 'string' ? sp.email.slice(0, 200) : '';
  return (
    <div className="space-y-6 rounded-xl bg-surface-lowest p-6 shadow-e1 sm:p-8">
      <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary"><Icon name="mail" size={30} /></span>
      <div>
        <h1 className="text-headline-s">Confirme seu e-mail</h1>
        <p className="mt-2 text-body-l text-on-surface-variant">
          Sua conta foi criada. Enviamos um link de confirmação para {email ? <b className="text-on-surface">{email}</b> : 'o seu e-mail'}.
          Clique nele para ativar a conta. Você será levado para o login.
        </p>
      </div>
      <ol className="space-y-2 text-body-m text-on-surface-variant">
        <li className="flex gap-2"><Icon name="check" size={18} className="mt-px text-primary" /> O link vale por 48 horas.</li>
        <li className="flex gap-2"><Icon name="check" size={18} className="mt-px text-primary" /> Não chegou? Confira a caixa de spam ou promoções.</li>
        <li className="flex gap-2"><Icon name="check" size={18} className="mt-px text-primary" /> Seu teste grátis de 7 dias já está contando.</li>
      </ol>
      {email && <ResendVerification email={email} />}
      <p className="border-t border-outline-variant/70 pt-5 text-body-m text-on-surface-variant">
        Já confirmou? <Link href={`/entrar${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="text-primary underline underline-offset-2">Ir para o login</Link>
      </p>
    </div>
  );
}

export default function VerifiqueEmailPage({ searchParams }: PageProps<'/verifique-email'>) {
  return (
    <main className="grid flex-1 place-items-center bg-surface-low px-5 py-16">
      <div className="w-full max-w-md">
        <Logo className="mb-8 justify-center" />
        <Suspense fallback={<div className="h-96 rounded-xl bg-surface-lowest shadow-e1" />}>
          <Content searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
