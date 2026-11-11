import { describe, expect, it } from 'vitest';
import { buildVideoPrompt, narrationScript } from './video-prompt';
import {
  canTransition, isReviewable, originalPriceOf, TRANSITIONS, validateRequest, VIDEO_STATUSES,
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
  const prompt = buildVideoPrompt(product, opts, '9:16', 10);
  it('usa os dados do produto', () => {
    expect(prompt).toContain('"Garrafa Térmica 1L"');
    expect(prompt).toContain('vertical');
    expect(prompt).toMatch(/R\$\s?49,90/);
    expect(prompt).toMatch(/R\$\s?99,80 \(50% de desconto\)/);
    expect(prompt).toContain('Narração em voz feminina, clara e animada, em Português (Brasil), dizendo exatamente: "Olha esse achado: Garrafa Térmica 1L! De R$');
    expect(prompt).toContain('Instruções de voz: tom animado.');
    expect(prompt).toContain('Instruções adicionais:\nfundo claro');
  });
  it('sempre pede trilha sonora; "Sem narração" tira só a voz', () => {
    expect(prompt).toContain('Trilha sonora: música de fundo animada');
    const none = buildVideoPrompt(product, { ...opts, narration: 'none' }, '9:16', 10);
    expect(none).toContain('Trilha sonora: música de fundo animada');
    expect(none).toContain('Sem voz: nenhuma narração falada.');
  });
  it('fala pronta curta, sem o título inteiro da Shopee', () => {
    const long = { ...product, name: 'Kit 10 Embalagens PVC Organizadora Roupa, Cama, Mesa e Banho Armário Cômoda [ENVIO IMEDIATO]' };
    expect(narrationScript(long, 'pt-BR')).toMatch(/^Olha esse achado: Kit 10 Embalagens PVC Organizadora Roupa! De R\$\s?99,80 por apenas R\$\s?49,90\. Corre, que é por tempo limitado!$/);
    expect(narrationScript({ ...product, originalPrice: null }, 'en-US')).toMatch(/^Check out this deal: Garrafa Térmica 1L! Only R\$\s?49,90\. Grab it while it lasts!$/);
  });
  it('proíbe inventar características e alterar o produto', () => {
    expect(prompt).toContain('Não invente características, funcionalidades ou benefícios');
    expect(prompt).toContain('Não represente o produto de maneira diferente de suas imagens de referência.');
  });
  it('omite o preço original quando não há desconto', () => {
    const p = buildVideoPrompt({ ...product, originalPrice: null, discountRate: null }, { ...opts, narration: 'none', extraInstructions: '' }, '16:9', 8);
    expect(p).not.toContain('Preço original');
    expect(p).toContain('horizontal');
    expect(p).toContain('Sem voz: nenhuma narração falada.');
    expect(p).not.toContain('Instruções adicionais');
  });
});
