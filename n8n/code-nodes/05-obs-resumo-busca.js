// =====================================================================
// Code Node: "Obs - Resumo da Busca"   (Mode: Run Once for All Items)
// Lê a resposta do productOfferV2 e monta o evento "run" para o painel.
// Fica ACIMA de "Filtrar Ofertas" no canvas: na ordem de execução v1 o
// ramo superior roda primeiro, então a busca é registrada mesmo quando
// "Filtrar Ofertas" lança erro (ex.: Invalid Signature).
// =====================================================================
const res = $input.first().json;
const meta = $('Assinar productOfferV2').first().json.meta || {};

let error = null;
if (Array.isArray(res.errors) && res.errors.length) {
  const e = res.errors[0];
  const code = e.extensions?.code ? `[${e.extensions.code}] ` : '';
  error = `${code}${e.extensions?.message || e.message || 'Erro desconhecido'}`;
}

return [
  {
    json: {
      type: 'run',
      executionId: String($execution.id),
      mode: $execution.mode,
      keyword: meta.keyword,
      page: meta.page,
      sortType: meta.sortType,
      found: (res?.data?.productOfferV2?.nodes || []).length,
      error,
    },
  },
];
