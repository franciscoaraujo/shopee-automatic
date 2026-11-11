import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { requireSession } from '@/server/session';
import { getProducts, listCategories, listProducts, listProviders } from '@/server/videos/repo';
import { GenerateForm, type ProviderOption } from './generate-form';

export const metadata: Metadata = { title: 'Gerar vídeos' };

async function Content({ searchParams }: { searchParams: PageProps<'/app/videos/gerar'>['searchParams'] }) {
  await connection();
  const sp = await searchParams;
  const { account } = await requireSession();
  const pre = (Array.isArray(sp.produto) ? sp.produto : sp.produto ? [sp.produto] : []).map(String).slice(0, 10);
  const [providers, categories, initial, preselected] = await Promise.all([
    listProviders(account.id), listCategories(account.id), listProducts(account.id, { page: 1 }), getProducts(account.id, pre),
  ]);
  // Só provedores prontos: ativos, com conexão validada e ao menos um modelo de vídeo
  const ready: ProviderOption[] = providers
    .filter((p) => p.enabled && p.status === 'ok' && p.models.length)
    .map((p) => ({
      id: p.id, name: p.name, typeLabel: p.typeLabel, isDefault: p.isDefault, defaultModel: p.defaultModel, models: p.models,
      defaultResolution: typeof p.settings.defaultResolution === 'string' ? p.settings.defaultResolution : null,
    }));
  return <GenerateForm providers={ready} categories={categories} initial={initial} preselected={preselected} />;
}

export default function GeneratePage({ searchParams }: PageProps<'/app/videos/gerar'>) {
  return (
    <Suspense fallback={<p className="py-12 text-body-l text-on-surface-variant">Carregando…</p>}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
