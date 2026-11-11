import { describe, expect, it } from 'vitest';
import { buildVideoPrompt, narrationScript } from './video-prompt';
import {
  canTransition, isReviewable, originalPriceOf, STYLES, TRANSITIONS, validateRequest, VIDEO_STATUSES,
  type GenerationOptions, type ModelCapabilities, type ProductSnapshot,
} from './videos';

describe('máquina de estados', () => {
  it('segue o fluxo feliz até a avaliação', () => {
    const path = ['PENDING', 'GENERATING', 'PROCESSING', 'GENERATED', 'PENDING_REVIEW', 'APPROVED'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });

  it('não pula etapas nem avalia antes de armazenar', () => {
    expect(canTransition('PENDING', 'PENDING_REVIEW')).toBe(false);
    expect(canTransition('GENERATING', 'APPROVED')).toBe(false);
    expect(canTransition('PROCESSING', 'APPROVED')).toBe(false);
    expect(canTransition('GENERATED', 'APPROVED')).toBe(false);
    expect(isReviewable('GENERATED')).toBe(false);
    expect(isReviewable('PENDING_REVIEW')).toBe(true);
  });

  it('FAILED é terminal e só estados em andamento falham', () => {
    expect(TRANSITIONS.FAILED).toEqual([]);
    expect(canTransition('PENDING_REVIEW', 'FAILED')).toBe(false);
    expect(canTransition('APPROVED', 'FAILED')).toBe(false);
    for (const s of ['PENDING', 'GENERATING', 'PROCESSING'] as const) expect(canTransition(s, 'FAILED')).toBe(true);
  });

  it('permite reavaliar (aprovado ⇄ rejeitado)', () => {
    expect(canTransition('APPROVED', 'REJECTED')).toBe(true);
    expect(canTransition('REJECTED', 'APPROVED')).toBe(true);
  });

  it('todo destino é um estado conhecido', () => {
    for (const to of Object.values(TRANSITIONS).flat()) expect(VIDEO_STATUSES).toContain(to);
  });
});

const caps: ModelCapabilities = {
  id: 'm', label: 'Modelo X', minDuration: 3, maxDuration: 15, aspectRatios: ['9:16', '16:9'],
  resolutions: ['720p'], defaultResolution: '720p', imageInput: true, audio: false, notes: [],
};

describe('validateRequest', () => {
  it('aceita pedido dentro dos limites', () => {
    expect(validateRequest(caps, { duration: 10, format: '9:16', narration: 'text', resolution: '720p' })).toEqual([]);
  });
  it('recusa duração fora do limite, formato e áudio não suportados', () => {
    const out = validateRequest(caps, { duration: 30, format: '1:1', narration: 'female', resolution: '4k' });
    expect(out.map((i) => i.field).sort()).toEqual(['duration', 'format', 'narration', 'resolution']);
  });
  it('recusa duração fracionada e modelo desconhecido', () => {
    expect(validateRequest(caps, { duration: 7.5, format: '9:16', narration: 'none', resolution: '720p' })[0].field).toBe('duration');
    expect(validateRequest(undefined, { duration: 10, format: '9:16', narration: 'none', resolution: '720p' })[0].field).toBe('model');
  });
});

describe('preço original', () => {
  it('calcula a partir do desconto', () => {
    expect(originalPriceOf(80, 20)).toBe(100);
    expect(originalPriceOf(80, null)).toBeNull();
    expect(originalPriceOf(80, 0)).toBeNull();
    expect(originalPriceOf(null, 20)).toBeNull();
  });
});

const product: ProductSnapshot = {
  itemId: '123', name: 'Garrafa Térmica 1L', imageUrl: 'https://x/img.jpg', price: 49.9, originalPrice: 99.8, discountRate: 50,
  category: 'cozinha', productLink: null, affiliateLink: 'https://s.shopee.com.br/x', shopName: null, description: null,
};
const opts: GenerationOptions = { style: 'promo', narration: 'female', language: 'pt-BR', voiceInstructions: 'tom animado', extraInstructions: 'fundo claro', resolution: '720p' };

describe('prompt automático', () => {
  // produto COM preço e desconto cadastrados: nada disso pode ir para o vídeo
  const prompt = buildVideoPrompt(product, opts, '9:16', 10);
  it('identifica o produto', () => {
    expect(prompt).toContain('identifique o produto "Garrafa Térmica 1L"');
    expect(prompt).toContain('vertical');
    expect(prompt).toContain('Narração em voz feminina, clara, em Português (Brasil), dizendo exatamente: "Conheça: Garrafa Térmica 1L."');
    expect(prompt).toContain('Instruções de voz: tom animado.');
    expect(prompt).toContain('Instruções adicionais:\nfundo claro');
  });
  it('não leva preço, valor, desconto nem promoção', () => {
    for (const style of Object.keys(STYLES) as (keyof typeof STYLES)[]) {
      for (const narration of ['none', 'female', 'male', 'text', 'narrated_subtitles'] as const) {
        for (const language of ['pt-BR', 'en-US', 'es-ES'] as const) {
          const p = buildVideoPrompt(product, { ...opts, style, narration, language, extraInstructions: '' }, '9:16', 10);
          // tudo, exceto a própria linha que proíbe preços
          const semRegra = p.split('\n').filter((l) => !l.startsWith('Não mostre nem mencione preços')).join('\n');
          expect(semRegra).not.toMatch(/R\$|49,90|99,80|50%|preço|desconto|promo|oferta|tempo limitado|deal|Corre/i);
        }
      }
    }
    expect(prompt).toContain('Não mostre nem mencione preços, valores, moedas, descontos, promoções');
  });
  it('proíbe inventar características e alterar o produto', () => {
    expect(prompt).toContain('Não invente características, funcionalidades ou benefícios');
    expect(prompt).toContain('Não represente o produto de maneira diferente de suas imagens de referência.');
  });
  it('sempre pede trilha sonora; "Sem narração" tira só a voz', () => {
    expect(prompt).toContain('Trilha sonora: música de fundo moderna');
    const none = buildVideoPrompt(product, { ...opts, narration: 'none' }, '9:16', 10);
    expect(none).toContain('Trilha sonora: música de fundo moderna');
    expect(none).toContain('Sem voz: nenhuma narração falada.');
  });
  it('fala curta, sem o título inteiro da Shopee', () => {
    const long = { ...product, name: 'Kit 10 Embalagens PVC Organizadora Roupa, Cama, Mesa e Banho Armário Cômoda [ENVIO IMEDIATO]' };
    expect(narrationScript(long, 'pt-BR')).toBe('Conheça: Kit 10 Embalagens PVC Organizadora Roupa.');
    expect(narrationScript(product, 'en-US')).toBe('Introducing: Garrafa Térmica 1L.');
    expect(narrationScript(product, 'es-ES')).toBe('Conoce: Garrafa Térmica 1L.');
  });
});
