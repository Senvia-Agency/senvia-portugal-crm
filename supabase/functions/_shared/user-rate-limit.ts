// Identity must already have been authenticated; never use a request-body user id.
export async function userRateLimit(client: any, userId: string, action: string, headers: Record<string, string>): Promise<Response | null> {
  try {
    const { data, error } = await client.rpc('user_action_rate_limit', { _user_id: userId, _action: action });
    if (error || typeof data?.allowed !== 'boolean') throw new Error('Limiter unavailable');
    if (data.allowed) return null;
    const retry = Math.max(1, Math.min(60, Number(data.retry_after) || 60));
    return new Response(JSON.stringify({ error: 'Máximo de 5 pedidos por minuto. Aguarda antes de tentar novamente.', retry_after: retry }), {
      status: 429, headers: { ...headers, 'Content-Type': 'application/json', 'Retry-After': String(retry), 'Access-Control-Expose-Headers': 'Retry-After' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Serviço temporariamente indisponível. Tenta novamente dentro de um minuto.' }), {
      status: 503, headers: { ...headers, 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }
}

// Exclude read/poll endpoints: applying 5/min to synchronization would break inboxes.
export const LIMITED_USER_ACTIONS = new Set([
  'create-checkout', 'customer-portal', 'buy-extra-seats', 'generate-prospects',
  'cancel-invoice', 'create-credit-note', 'generate-receipt', 'issue-invoice', 'issue-invoice-receipt',
  'send-access-email', 'send-invoice-email', 'send-proposal-email', 'send-template-email',
  'stripe-sale-checkout', 'stripe-product-sync', 'update-invoicexpress-item',
]);
