// Quando uma falha vira aviso para o cliente. Falhas isoladas (instabilidade momentânea da Shopee,
// da Evolution etc.) não aparecem no painel: o sistema tenta de novo sozinho. Só uma sequência de
// falhas seguidas, sem nenhum sucesso no meio, vira aviso.
export const FAILURE_STREAK = 3;

// recentOk: resultados do mais recente para o mais antigo (true = deu certo)
export const isFailingStreak = (recentOk: boolean[], n = FAILURE_STREAK) =>
  recentOk.length >= n && recentOk.slice(0, n).every((ok) => !ok);
