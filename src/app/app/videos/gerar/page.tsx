import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { requireSession } from '@/server/session';
import { PLATFORM_PROVIDER_ID, platformModel, platformStatus, premiumQuota } from '@/server/videos/platform';
import { getProviderDefinition } from '@/server/videos/providers';
import { getProducts, listCategories, listProducts, listProviders } from '@/server/videos/repo';
import { GenerateForm, type ProviderOption } from './generate-form';

export const metadata: Metadata = { title: 'Gerar vídeos' };

async function Content({ searchParams }: { searchParams: PageProps<'/app/videos/gerar'>['searchParams'] }) {
  await connection();
  const sp = await searchParams;
  const { account } = await requireSession();
  const pre = (Array.isArray(sp.produto) ? sp.produto : sp.produto ? [sp.produto] : []).map(String).slice(0, 10);
  const [providers, categories, initial, preselected, premium, quota] = await Promise.all([
    listProviders(account.id), listCategories(account.id), listProducts(account.id, { page: 1 }), getProducts(account.id, pre),
    platformStatus(), premiumQuota(account.id),
  ]);

  const options: ProviderOption[] = [];
  // Premium: IA da plataforma (custo incluído no plano)
  const pm = platformModel();
  if (pm) {
    options.push({
      id: PLATFORM_PROVIDER_ID, tier: 'premium', name: 'Premium', typeLabel: 'Google Gemini', isDefault: true,
      defaultModel: pm.id, models: [pm], defaultResolution: pm.defaultResolution,
      unavailable: !premium.ok ? premium.message : quota.limit === 0 ? 'Seu plano não inclui vídeos premium.' : quota.remaining === 0 ? `Cota do mês esgotada (${quota.used} de ${quota.limit}).` : null,
      quota,
    });
  }
  // Econômico: chave do próprio cliente (ativa, validada e com modelos de vídeo)
  // (chaves Gemini antigas de cliente ficam de fora: premium agora é da plataforma)
  const usable = providers.filter((x) => x.enabled && x.status === 'ok' && x.models.length && getProviderDefinition(x.type)?.clientConfigurable);
  for (const p of usable) {
    options.push({
      id: p.id, tier: 'economic', name: p.name, typeLabel: p.typeLabel, isDefault: p.isDefault, defaultModel: p.defaultModel, models: p.models,
      defaultResolution: typeof p.settings.defaultResolution === 'string' ? p.settings.defaultResolution : null, unavailable: null, quota: null,
    });
  }
  const needsKey = usable.length === 0;
  return <GenerateForm providers={options} needsKey={needsKey} categories={categories} initial={initial} preselected={preselected} />;
}

export default function GeneratePage({ searchParams }: PageProps<'/app/videos/gerar'>) {
  return (
    <Suspense fallback={<p className="py-12 text-body-l text-on-surface-variant">Carregando…</p>}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
