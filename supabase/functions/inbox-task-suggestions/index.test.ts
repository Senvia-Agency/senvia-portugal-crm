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

Deno.test('configured local provider analyzes only one message and never calls Google', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let localCalls = 0, finalized = 0;
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, signal: controller.signal, onListen() {} }, req => {
    const path = new URL(req.url).pathname;
    const body = path === '/rest/v1/meta_conversations' ? { id: conversationId, organization_id: '11111111-1111-4111-8111-111111111111', channel_id: '22222222-2222-4222-8222-222222222222', contact_ref: '351912345678', contact_name: null }
      : path === '/rest/v1/messaging_channels' ? { channel_type: 'whatsapp', status: 'connected', archived_at: null, metadata: { ai_tasks_enabled: true } }
      : path === '/rest/v1/meta_messages' ? (new URL(req.url).searchParams.get('direction') === 'eq.outgoing' ? [] : [1, 2]).map(number => ({ id: `${number}1111111-1111-4111-8111-111111111111`, content: 'Podes enviar o orçamento amanhã?', direction: 'incoming', is_deleted: false, created_at: new Date().toISOString(), sent_at: null }))
      : path === '/rest/v1/rpc/claim_inbox_task_analysis' ? '44444444-4444-4444-8444-444444444444'
      : path === '/rest/v1/rpc/finish_inbox_task_analysis' ? true : null;
    if (path === '/rest/v1/rpc/finish_inbox_task_analysis') finalized++;
    return new Response(req.method === 'HEAD' ? null : JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/0' } });
  });
  const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'INBOX_TASK_AI_PROVIDER', 'OLLAMA_TASK_GATEWAY_URL', 'OLLAMA_TASK_GATEWAY_KEY'] as const;
  const previous = names.map(name => Deno.env.get(name));
  Deno.env.set('SUPABASE_URL', `http://127.0.0.1:${server.addr.port}`); Deno.env.set('SUPABASE_ANON_KEY', 'anon'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  Deno.env.set('INBOX_TASK_AI_PROVIDER', 'ollama'); Deno.env.set('OLLAMA_TASK_GATEWAY_URL', 'https://mcp.senvia.pt/senvia-tasks/v1/classify'); Deno.env.set('OLLAMA_TASK_GATEWAY_KEY', 'gateway-key');
  globalThis.fetch = (input, init) => {
    if (String(input).includes('googleapis.com')) throw new Error('Local provider called Google');
    if (String(input) === 'https://mcp.senvia.pt/senvia-tasks/v1/classify') { localCalls++; return Promise.resolve(Response.json({ tarefa: true, titulo: 'Enviar orçamento', confianca: .9, prazo_texto: 'amanhã', prazo_explicito: true })); }
    return originalFetch(input, init);
  };
  try {
    const result = await handleRequest(new Request('http://localhost/inbox-task-suggestions', { method: 'POST', headers: { Authorization: 'Bearer service-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: conversationId }) }));
    const body: unknown = await result.json();
    if (result.status !== 200 || localCalls !== 1 || finalized !== 1 || JSON.stringify(body) !== JSON.stringify({ ok: true, analyzed: 1, suggested: 1, has_more: true })) throw new Error(`Local analysis failed: ${result.status}, calls=${localCalls}, finalized=${finalized}`);
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, index) => { const value = previous[index]; if (value === undefined) Deno.env.delete(name); else Deno.env.set(name, value); });
    controller.abort(); await server.finished;
  }
});

Deno.test('incoming request is not hidden by outgoing messages and subsequent analysis includes commercial messages', async () => {
  const original = globalThis.fetch, controller = new AbortController();
  const claims = new Set<string>(), senders: string[] = [];
  const now = new Date().toISOString();
  const received = [{ id: '77777777-7777-4777-8777-777777777777', content: 'Podes enviar o contrato amanhã?', direction: 'incoming', is_deleted: false, created_at: now, sent_at: now }];
  const sent = [1, 2, 3, 4, 5, 6].map(number => ({ id: `${number}1111111-1111-4111-8111-111111111111`, content: 'Já encontrei o documento enviado.', direction: 'outgoing', is_deleted: false, created_at: now, sent_at: now }));
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, signal: controller.signal, onListen() {} }, async req => {
    const url = new URL(req.url), path = url.pathname;
    let body: unknown = null;
    if (path === '/rest/v1/meta_conversations') body = { id: conversationId, organization_id: '11111111-1111-4111-8111-111111111111', channel_id: '22222222-2222-4222-8222-222222222222', contact_ref: '351912345678', contact_name: null };
    else if (path === '/rest/v1/messaging_channels') body = { channel_type: 'whatsapp', status: 'connected', archived_at: null, metadata: { ai_tasks_enabled: true } };
    else if (path === '/rest/v1/meta_messages') body = url.searchParams.get('direction') === 'eq.incoming' ? received : sent;
    else if (path === '/rest/v1/rpc/claim_inbox_task_analysis') { const value = await req.json(); const id: unknown = value.p_message_id; if (typeof id !== 'string') throw new Error('Invalid claim'); body = claims.has(id) ? null : '44444444-4444-4444-8444-444444444444'; claims.add(id); }
    else if (path === '/rest/v1/rpc/finish_inbox_task_analysis') body = false;
    return new Response(req.method === 'HEAD' ? null : JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/0' } });
  });
  const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'INBOX_TASK_AI_PROVIDER', 'OLLAMA_TASK_GATEWAY_URL', 'OLLAMA_TASK_GATEWAY_KEY'] as const;
  const previous = names.map(name => Deno.env.get(name));
  Deno.env.set('SUPABASE_URL', `http://127.0.0.1:${server.addr.port}`); Deno.env.set('SUPABASE_ANON_KEY', 'anon'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-key'); Deno.env.set('INBOX_TASK_AI_PROVIDER', 'ollama'); Deno.env.set('OLLAMA_TASK_GATEWAY_URL', 'https://mcp.senvia.pt/senvia-tasks/v1/classify'); Deno.env.set('OLLAMA_TASK_GATEWAY_KEY', 'gateway-key');
  globalThis.fetch = (input, init) => {
    if (String(input) === 'https://mcp.senvia.pt/senvia-tasks/v1/classify') { const body = JSON.parse(String(init?.body)); senders.push(body.sender); return Promise.resolve(Response.json({ tarefa: false, titulo: '', confianca: 0, prazo_texto: null, prazo_explicito: false })); }
    return original(input, init);
  };
  try {
    for (let step = 0; step < 2; step++) {
      const response = await handleRequest(new Request('http://localhost/inbox-task-suggestions', { method: 'POST', headers: { Authorization: 'Bearer service-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: conversationId }) }));
      const result = await response.json();
      if (response.status !== 200 || result.analyzed !== 1 || result.has_more !== true) throw new Error('Missing bounded continuation');
      if (senders[step] !== (step === 0 ? 'CLIENTE' : 'COMERCIAL')) throw new Error('One direction monopolized analysis');
    }
  } finally { globalThis.fetch = original; names.forEach((name, index) => { const value = previous[index]; if (value === undefined) Deno.env.delete(name); else Deno.env.set(name, value); }); controller.abort(); await server.finished; }
});
