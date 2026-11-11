// Chamadas REAIS às APIs dos provedores (rede). Desligado por padrão.
//   TEST_REAL_PROVIDERS=1 npm run test:integration
// Com chave inválida: confere que o endpoint existe e que a recusa é tratada sem vazar a chave.
// Com TEST_GEMINI_API_KEY / TEST_XAI_API_KEY: valida a conexão e lista os modelos de vídeo.
// (Não gera vídeo: geração custa créditos. Para isso, use a tela Gerar vídeos.)
import { describe, expect, it } from 'vitest';
import { GeminiVideoProvider } from '@/server/videos/providers/gemini';
import { GrokVideoProvider } from '@/server/videos/providers/grok';

const on = process.env.TEST_REAL_PROVIDERS === '1';
const suite = on ? describe : describe.skip;

suite('APIs reais dos provedores', () => {
  it('Gemini recusa chave inválida com mensagem tratada', async () => {
    const bad = 'AIzaSyINVALIDINVALIDINVALIDINVALID000';
    const r = await new GeminiVideoProvider({ apiKey: bad, settings: {} }).validateConnection();
    console.log('Gemini (chave inválida):', r.message);
    expect(r.ok).toBe(false);
    expect(r.message).not.toContain(bad);
  });

  it('xAI recusa chave inválida com mensagem tratada', async () => {
    const bad = 'xai-INVALIDINVALIDINVALIDINVALIDINVALID';
    const r = await new GrokVideoProvider({ apiKey: bad, settings: {} }).validateConnection();
    console.log('xAI (chave inválida):', r.message);
    expect(r.ok).toBe(false);
    expect(r.message).not.toContain(bad);
  });

  (process.env.TEST_GEMINI_API_KEY ? it : it.skip)('Gemini: chave real lista modelos de vídeo', async () => {
    const r = await new GeminiVideoProvider({ apiKey: process.env.TEST_GEMINI_API_KEY!, settings: {} }).validateConnection();
    console.log('Gemini (chave real):', r.message, r.models.map((m) => m.id));
    expect(r.message).toBeTruthy();
  });

  (process.env.TEST_XAI_API_KEY ? it : it.skip)('xAI: chave real lista modelos de vídeo', async () => {
    const r = await new GrokVideoProvider({ apiKey: process.env.TEST_XAI_API_KEY!, settings: {} }).validateConnection();
    console.log('xAI (chave real):', r.message, r.models.map((m) => m.id));
    expect(r.ok).toBe(true);
  });
});
