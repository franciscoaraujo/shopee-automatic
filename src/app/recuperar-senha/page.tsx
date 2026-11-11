import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/app/(auth)/forms';
import { Logo } from '@/components/landing/chrome';

export const metadata: Metadata = { title: 'Recuperar senha', robots: { index: false } };

export default function RecuperarSenhaPage() {
  return (
    <main className="grid flex-1 place-items-center bg-surface-low px-5 py-16">
      <div className="w-full max-w-md">
        <Logo className="mb-8 justify-center" />
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
