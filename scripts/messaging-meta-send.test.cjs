const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function loadMetaSend(globals) {
  const file = 'supabase/functions/meta-send/index.ts';
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const code = source.statements
    .filter((node) => !ts.isImportDeclaration(node))
    .map((node) => node.getText(source))
    .join('\n');
  let handler;
  const box = {
    exports: {},
    Request,
    Response,
    TextEncoder,
    AbortSignal,
    console: { log() {}, error() {} },
    Deno: {
      serve(candidate) { handler = candidate; },
      env: { get: (key) => key === 'SUPABASE_URL' ? 'https://fixture.invalid' : 'fixture-service-role' },
    },
    requestMfaResponse: async () => null,
    ...globals,
  };
  vm.runInNewContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, box);
  return (request) => handler(request);
}

function queryFor(data) {
  const chain = {
    select: () => chain,
    insert: async () => ({ error: null }),
    update: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data, error: null }),
  };
  return chain;
}

test('meta-send rejects an Evolution channel before any direct provider call', async () => {
  // Given: a valid member requests a send on a managed Evolution channel.
  let providerCalls = 0;
  let secretReads = 0;
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    rpc: async () => ({ data: true, error: null }),
    from(table) {
      if (table === 'meta_conversations') {
        return queryFor({
          id: 'conversation-1',
          organization_id: 'org-1',
          channel_id: 'channel-1',
          contact_ref: '+351900000001',
          window_expires_at: null,
        });
      }
      if (table === 'messaging_channels') {
        return queryFor({
          provider: 'evolution',
          channel_type: 'whatsapp',
          archived_at: null,
          label: 'Managed WhatsApp',
          metadata: { phone_number_id: 'provider-number-1', managed_by: 'senvia_v2' },
        });
      }
      if (table === 'messaging_channel_secrets') {
        secretReads += 1;
        return queryFor({ page_access_token: 'fixture-token' });
      }
      if (table === 'meta_messages') return queryFor(null);
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  const run = loadMetaSend({
    createClient: () => admin,
    fetch: async () => {
      providerCalls += 1;
      return new Response(JSON.stringify({ messages: [{ id: 'provider-message-1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  // When: the legacy direct-send handler receives the request.
  const response = await run(new Request('https://fixture.invalid', {
    method: 'POST',
    headers: { Authorization: 'Bearer fixture-user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: 'conversation-1', text: 'fixture only' }),
  }));

  // Then: the queue-only provider is rejected before credentials or transport are reached.
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: 'Este canal é gerido pela fila segura de mensagens.',
    code: 'managed_channel_queue_required',
  });
  assert.equal(secretReads, 0);
  assert.equal(providerCalls, 0);
});
