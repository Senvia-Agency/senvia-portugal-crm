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

async function alternateServiceRequest(credential: string, servicePermission: boolean) {
  const paths: string[] = [];
  const controller = new AbortController();
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, signal: controller.signal, onListen() {} }, req => {
    const path = new URL(req.url).pathname;
    paths.push(path);
    if (path !== '/rest/v1/messaging_channels' && req.headers.get('authorization') !== `Bearer ${credential}`) throw new Error('Caller credential replaced before verification');
    if (path === '/auth/v1/user') return new Response(JSON.stringify({ message: 'Not a user', code: 'bad_jwt' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    if (path === '/rest/v1/inbox_task_analysis') {
      if (req.method !== 'HEAD' || new URL(req.url).searchParams.get('limit') !== '0') throw new Error('Service permission check reads private records');
      return new Response(null, { status: servicePermission ? 200 : 403 });
    }
    const body = path === '/rest/v1/meta_conversations'
      ? { id: conversationId, organization_id: '11111111-1111-4111-8111-111111111111', channel_id: '22222222-2222-4222-8222-222222222222', contact_ref: '351912345678', contact_name: null }
      : { channel_type: 'whatsapp', status: 'connected', archived_at: null, metadata: { ai_tasks_enabled: false } };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  });
  Deno.env.set('SUPABASE_URL', `http://127.0.0.1:${server.addr.port}`);
  Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'runtime-service-key');
  try {
    const response = await handleRequest(new Request('http://localhost/inbox-task-suggestions', { method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: conversationId }) }));
    return { response, paths };
  } finally { controller.abort(); await server.finished; }
}

Deno.test('accepts an alternate service JWT only after PostgREST verifies its private table privilege', async () => {
  const { response, paths } = await alternateServiceRequest('valid-alternate-service-jwt', true);
  if (response.status !== 200) throw new Error(`Verified service JWT rejected: ${response.status}`);
  if (paths.join(',') !== '/auth/v1/user,/rest/v1/inbox_task_analysis,/rest/v1/meta_conversations,/rest/v1/messaging_channels') throw new Error('Service privilege verification bypassed');
});

Deno.test('rejects forged service claims before privileged conversation reads', async () => {
  const { response, paths } = await alternateServiceRequest('forged-service-jwt', false);
  if (response.status !== 401 || paths.some(path => path === '/rest/v1/meta_conversations')) throw new Error('Forged JWT reached privileged data');
});

Deno.test('rejects anonymous credentials when the private service permission check denies access', async () => {
  const { response, paths } = await alternateServiceRequest('anonymous-jwt', false);
  if (response.status !== 401 || paths.some(path => path === '/rest/v1/meta_conversations')) throw new Error('Anonymous request reached privileged data');
});
