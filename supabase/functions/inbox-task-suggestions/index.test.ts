import { handleRequest } from './index.ts';

const conversationId = '33333333-3333-4333-8333-333333333333';
Deno.test('denied user conversation access never reaches service analysis', async () => {
  const requests: { path: string; authorization: string | null }[] = [];
  const controller = new AbortController();
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, signal: controller.signal, onListen() {} }, req => {
    const path = new URL(req.url).pathname;
    requests.push({ path, authorization: req.headers.get('authorization') });
    const body = path === '/auth/v1/user' ? { id: '11111111-1111-4111-8111-111111111111' } : path === '/rest/v1/rpc/meets_mfa_policy' ? true : null;
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  });
  Deno.env.set('SUPABASE_URL', `http://127.0.0.1:${server.addr.port}`);
  Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  try {
    const result = await handleRequest(new Request('http://localhost/inbox-task-suggestions', { method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: conversationId }) }));
    if (result.status !== 404) throw new Error(`Expected inaccessible conversation, got ${result.status}`);
    if (!requests.some(req => req.path === '/rest/v1/meta_conversations') || requests.some(req => req.authorization !== 'Bearer user-token')) throw new Error('Service analysis preceded user RLS gating');
  } finally { controller.abort(); await server.finished; }
});

Deno.test('service-key requests respect the authoritative channel opt-out', async () => {
  const paths: string[] = [];
  const controller = new AbortController();
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, signal: controller.signal, onListen() {} }, req => {
    const path = new URL(req.url).pathname;
    paths.push(path);
    const body = path === '/rest/v1/meta_conversations'
      ? { id: conversationId, organization_id: '11111111-1111-4111-8111-111111111111', channel_id: '22222222-2222-4222-8222-222222222222', contact_ref: '351912345678', contact_name: null }
      : { channel_type: 'whatsapp', status: 'connected', archived_at: null, metadata: { ai_tasks_enabled: false } };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  });
  Deno.env.set('SUPABASE_URL', `http://127.0.0.1:${server.addr.port}`);
  Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  try {
    const result = await handleRequest(new Request('http://localhost/inbox-task-suggestions', { method: 'POST', headers: { Authorization: 'Bearer service-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: conversationId }) }));
    const body: unknown = await result.json();
    if (result.status !== 200 || JSON.stringify(body) !== JSON.stringify({ ok: true, analyzed: 0, suggested: 0, disabled: true })) throw new Error('Disabled channel analyzed');
    if (paths.length !== 2) throw new Error('Disabled channel reached messages or AI');
  } finally { controller.abort(); await server.finished; }
});
