// Registro dos provedores de vídeo. Para adicionar um provedor novo:
//   1. crie providers/<nome>.ts implementando VideoGenerationProvider (ver types.ts);
//   2. acrescente a definição em PROVIDERS abaixo.
// Nada mais muda: fila, estados, armazenamento, telas e avaliação usam só a interface.
import { GEMINI_CAPABILITIES, GeminiVideoProvider } from './gemini';
import { GROK_CAPABILITIES, GrokVideoProvider } from './grok';
import type { ProviderConfig, ProviderDefinition, VideoGenerationProvider } from './types';

export const PROVIDERS: Record<string, ProviderDefinition> = {
  gemini: {
    type: 'gemini',
    label: 'Google Gemini',
    docsUrl: 'https://aistudio.google.com/docs/omni',
    keyHelp: 'Crie a chave em aistudio.google.com → Get API key. A geração de vídeo exige um projeto com faturamento ativo.',
    keyPattern: /^[A-Za-z0-9_-]{30,60}$/,
    capabilities: GEMINI_CAPABILITIES,
    create: (cfg) => new GeminiVideoProvider(cfg),
  },
  xai: {
    type: 'xai',
    label: 'xAI Grok',
    docsUrl: 'https://docs.x.ai/developers/model-capabilities/video/generation',
    keyHelp: 'Crie a chave em console.x.ai → API Keys, com permissão para os endpoints de vídeo.',
    keyPattern: /^xai-[A-Za-z0-9_-]{20,}$/,
    capabilities: GROK_CAPABILITIES,
    create: (cfg) => new GrokVideoProvider(cfg),
  },
};

export const providerTypes = () => Object.values(PROVIDERS).map(({ type, label, docsUrl, keyHelp, capabilities }) => ({ type, label, docsUrl, keyHelp, capabilities }));

export function getProviderDefinition(type: string): ProviderDefinition | null {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, type) ? PROVIDERS[type] : null;
}

export function createProvider(type: string, cfg: ProviderConfig): VideoGenerationProvider {
  const def = getProviderDefinition(type);
  if (!def) throw new Error(`Provedor desconhecido: ${type}`);
  return def.create(cfg);
}
