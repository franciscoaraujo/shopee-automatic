// =====================================================================
// Code Node: "Obs - Normalizar Entregas"   (Mode: Run Once for All Items)
// Recebe a saída de "Telegram - sendPhoto" OU "WhatsApp - Evolution
// sendMedia" (executa uma vez para cada ramo) e monta um evento
// "deliveries" com sucesso/erro de cada oferta.
// Os nós de envio usam On Error = Continue, então falhas chegam aqui
// como itens com o campo "error" em vez de interromper o workflow.
// =====================================================================
const prev = typeof $prevNode !== 'undefined' && $prevNode ? $prevNode.name : '';
const responses = $input.all();
const offers = $('Formatar Copy').all();

// Canal pelo nó anterior; se indisponível, pelo formato da resposta
let channel = /telegram/i.test(prev) ? 'telegram' : /whatsapp|evolution/i.test(prev) ? 'whatsapp' : null;
if (!channel) {
  const sample = responses.find((r) => r.json && !r.json.error)?.json || {};
  channel = 'ok' in sample || 'result' in sample ? 'telegram' : 'whatsapp';
}

const errorText = (r) => {
  if (r.error) {
    if (typeof r.error === 'string') return r.error;
    return r.error.description || r.error.message || JSON.stringify(r.error).slice(0, 500);
  }
  if (channel === 'telegram' && r.ok === false) return r.description || 'Telegram retornou ok=false';
  if (channel === 'whatsapp' && !r.key) return r.message ? JSON.stringify(r.message).slice(0, 500) : 'Evolution API não retornou key';
  return null;
};

const events = responses.map((item, i) => {
  const r = item.json || {};
  const o = offers[i]?.json || {};
  const error = errorText(r);
  return {
    channel,
    itemId: o.itemId,
    productName: o.productName,
    price: o.price,
    commissionRate: o.commissionRate,
    commission: o.commission,
    affiliateLink: o.affiliateLink,
    imageUrl: o.imageUrl,
    success: !error,
    error,
    messageId: channel === 'telegram' ? r.result?.message_id : r.key?.id,
  };
});

return [{ json: { type: 'deliveries', executionId: String($execution.id), events } }];
