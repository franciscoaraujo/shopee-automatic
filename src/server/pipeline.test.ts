import { describe, expect, it } from 'vitest';
import type { Settings } from '@/lib/settings-schema';
import type { Offer } from './integrations';
import { selectOffers } from './pipeline';

const s = { minCommissionRate: 0.05, minRating: 4.5 } as Settings;

const offer = (itemId: string, productName: string, shopName: string, commission: number): Offer => ({
  itemId, productName, shopName, productLink: `https://shopee.com.br/p/${itemId}`, offerLink: `https://s.shopee.com.br/${itemId}`,
  imageUrl: `https://cf.shopee.com.br/file/${itemId}`, priceMin: '49.90', priceMax: '49.90', priceDiscountRate: 20,
  commissionRate: '0.20', commission: String(commission), sales: 100, ratingStar: '4.8', periodEndTime: 0,
});

const none = { ids: new Set<string>(), names: new Set<string>() };
const ids = (sel: { itemId: string }[]) => sel.map((p) => p.itemId);

describe('selectOffers', () => {
  it('não seleciona o mesmo produto duas vezes quando vem com itemIds diferentes', () => {
    const nodes = [
      offer('1', 'Fritadeira Elétrica 6.5L 1700W Sem Óleo', 'Loja A', 30),
      offer('2', 'fritadeira elétrica 6.5L  1700W sem óleo', 'Loja B', 29),
      offer('3', 'Fone Bluetooth TWS', 'Loja C', 10),
    ];
    expect(ids(selectOffers(nodes, s, 3, none))).toEqual(['1', '3']);
  });

  it('não repete produto já enviado no prazo, mesmo reanunciado com outro itemId', () => {
    const nodes = [offer('9', 'Calça Jeans Skinny Masculina', 'Loja A', 30), offer('3', 'Fone Bluetooth TWS', 'Loja C', 10)];
    const sent = { ids: new Set(['1']), names: new Set(['calça jeans skinny masculina']) };
    expect(ids(selectOffers(nodes, s, 3, sent))).toEqual(['3']);
  });

  it('uma loja com as maiores comissões não ocupa todas as vagas da rodada', () => {
    const nodes = [
      offer('o1', 'Óculos de Sol Race', 'Fortuna Sunglasses', 63),
      offer('o2', 'Óculos de Sol London', 'Fortuna Sunglasses', 63),
      offer('o3', 'Óculos de Sol Hexagonal', 'Fortuna Sunglasses', 63),
      offer('v1', 'Vestido 3 Marias Longo', 'Yudis Modas', 59),
      offer('p1', 'Pijama Feminino Algodão', "Mimo's Kids", 50),
    ];
    expect(ids(selectOffers(nodes, s, 3, none))).toEqual(['o1', 'v1', 'p1']);
  });

  it('completa as vagas com a mesma loja quando não há outras', () => {
    const nodes = [offer('o1', 'Óculos A', 'Fortuna', 63), offer('o2', 'Óculos B', 'Fortuna', 62), offer('v1', 'Vestido', 'Yudis', 10)];
    expect(ids(selectOffers(nodes, s, 3, none))).toEqual(['o1', 'v1', 'o2']);
  });
});
