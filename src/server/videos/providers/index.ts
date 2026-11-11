// Registro dos provedores de vídeo. Para adicionar um provedor novo:
//   1. crie providers/<nome>.ts implementando VideoGenerationProvider (ver types.ts);
//   2. acrescente a definição em PROVIDERS abaixo.
// Nada mais muda: fila, estados, armazenamento, telas e avaliação usam só a interface.
// GEMINI DESATIVADO POR ENQUANTO: só o xAI Grok está ativo. Para reativar, descomente o
// import e a entrada "gemini" abaixo e mude PREMIUM_ENABLED para true em ../platform.ts.
// import { GEMINI_CAPABILITIES, GeminiVideoProvider } from './gemini';
import { GROK_CAPABILITIES, GrokVideoProvider } from './grok';
import type { ProviderConfig, ProviderDefinition, VideoGenerationProvider } from './types';

export const PROVIDERS: Record<string, ProviderDefinition> = {
  // gemini: {
  //   type: 'gemini',
  //   label: 'Google Gemini',
  //   // Vídeos premium: usado só com a chave da PLATAFORMA (ver ../platform.ts). O cliente não cadastra.
  //   clientConfigurable: false,
  //   docsUrl: 'https://aistudio.google.com/docs/omni',
  //   // A chave da plataforma (PLATFORM_GEMINI_API_KEY) precisa ser de um projeto com faturamento
  //   // ativo: o Gemini Omni Flash não existe no plano gratuito da Gemini API.
  //   keyHelp: 'Chave da Gemini API de um projeto com faturamento ativo (aistudio.google.com → Billing).',
  //   // Formatos aceitos: clássico "AIza…" e o novo "AQ.…" (com ponto)
  //   keyPattern: /^[A-Za-z0-9._-]{30,200}$/,
  //   capabilities: GEMINI_CAPABILITIES,
  //   create: (cfg) => new GeminiVideoProvider(cfg),
  // },
  xai: {
    type: 'xai',
    label: 'xAI Grok',
    clientConfigurable: true,
    docsUrl: 'https://docs.x.ai/developers/model-capabilities/video/generation',
    keyHelp: 'Crie a chave em console.x.ai → API Keys, com permissão para os endpoints de vídeo.',
    keyPattern: /^xai-[A-Za-z0-9_-]{20,}$/,
    capabilities: GROK_CAPABILITIES,
    create: (cfg) => new GrokVideoProvider(cfg),
  },
};

// Tipos que o cliente pode cadastrar com a própria chave
export const providerTypes = () =>
  Object.values(PROVIDERS).filter((p) => p.clientConfigurable).map(({ type, label, docsUrl, keyHelp, requirement, capabilities }) => ({ type, label, docsUrl, keyHelp, requirement, capabilities }));

export function getProviderDefinition(type: string): ProviderDefinition | null {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, type) ? PROVIDERS[type] : null;
}

export function createProvider(type: string, cfg: ProviderConfig): VideoGenerationProvider {
  const def = getProviderDefinition(type);
  if (!def) throw new Error(`Provedor desconhecido: ${type}`);
  return def.create(cfg);
}
