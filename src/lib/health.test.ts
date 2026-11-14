import { describe, expect, it } from 'vitest';
import { isFailingStreak } from './health';

// Resultados do mais recente para o mais antigo (true = deu certo)
describe('isFailingStreak', () => {
  it('falha isolada não vira aviso', () => {
    expect(isFailingStreak([false, true, true])).toBe(false);
  });

  it('três falhas seguidas viram aviso', () => {
    expect(isFailingStreak([false, false, false, true])).toBe(true);
  });

  it('um sucesso recente encerra o aviso', () => {
    expect(isFailingStreak([true, false, false, false])).toBe(false);
  });

  it('com menos de três tentativas ainda não há aviso', () => {
    expect(isFailingStreak([false, false])).toBe(false);
  });
});
