const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const NodeModule = require('node:module');
const { buildSync } = require('esbuild');

global.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};

const root = path.resolve(__dirname, '../..');
const bundle = buildSync({
  absWorkingDir: root,
  bundle: true,
  entryPoints: ['src/hooks/useConfiguredWorkflowManual.ts'],
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  write: false,
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://test.supabase.co'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('test-publishable-key'),
  },
}).outputFiles[0].text;
const loaded = new NodeModule(path.join(root, '.configured-workflow-manual.test.cjs'));
loaded.filename = path.join(root, '.configured-workflow-manual.test.cjs');
loaded.paths = NodeModule._nodeModulePaths(root);
loaded._compile(bundle, loaded.filename);
const client = loaded.exports;

test('manual execution timeout reports unknown without retrying', async () => {
  const original = AbortSignal.timeout;
  AbortSignal.timeout = () => AbortSignal.abort();
  let calls = 0;
  try {
    const result = await client.runConfiguredWorkflowManual({
      endpoint: 'https://example.supabase.co/functions/v1/automation-engine',
      flowId: '11111111-1111-4111-8111-111111111111',
      confirmationId: '22222222-2222-4222-8222-222222222222', accessToken: 'token',
      fetcher: async (_url, init) => { calls++; if (init.signal?.aborted) throw new Error('timeout'); return new Promise(() => {}); },
    });
    assert.equal(result.kind, 'unknown');
    assert.equal(calls, 1);
  } finally { AbortSignal.timeout = original; }
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('prepare requests a one-time proof once without leaking it into logs', async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, init });
    return jsonResponse({
      confirmation_id: 'e8f53421-51f2-4d39-bc77-7df2708b1cf8',
      expires_at: '2030-01-02T03:04:05.000Z',
    });
  };

  const result = await client.prepareConfiguredWorkflowManual({
    endpoint: 'https://test.supabase.co/functions/v1/automation-engine',
    flowId: '039271ed-09c4-4c75-81fe-9b4422f91875',
    accessToken: 'secret-user-token',
    fetcher,
  });

  assert.deepEqual(result, {
    ok: true,
    confirmationId: 'e8f53421-51f2-4d39-bc77-7df2708b1cf8',
    expiresAt: '2030-01-02T03:04:05.000Z',
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://test.supabase.co/functions/v1/automation-engine');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer secret-user-token');
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    action: 'prepare_configured_manual',
    flow_id: '039271ed-09c4-4c75-81fe-9b4422f91875',
  });
});

test('run consumes the proof once and parses the execution summary', async () => {
  let calls = 0;
  const result = await client.runConfiguredWorkflowManual({
    endpoint: 'https://test.supabase.co/functions/v1/automation-engine',
    flowId: '039271ed-09c4-4c75-81fe-9b4422f91875',
    confirmationId: 'e8f53421-51f2-4d39-bc77-7df2708b1cf8',
    accessToken: 'secret-user-token',
    fetcher: async (_url, init) => {
      calls += 1;
      assert.deepEqual(JSON.parse(init.body), {
        action: 'run_configured_manual',
        flow_id: '039271ed-09c4-4c75-81fe-9b4422f91875',
        confirmation_id: 'e8f53421-51f2-4d39-bc77-7df2708b1cf8',
      });
      return jsonResponse({ scanned: 7, started: 2, skipped: 5, errors: [] });
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    ok: true,
    summary: { scanned: 7, started: 2, skipped: 5, errors: [] },
  });
});

test('a rejected run is known while a lost run response is explicitly unknown', async () => {
  const base = {
    endpoint: 'https://test.supabase.co/functions/v1/automation-engine',
    flowId: '039271ed-09c4-4c75-81fe-9b4422f91875',
    confirmationId: 'e8f53421-51f2-4d39-bc77-7df2708b1cf8',
    accessToken: 'secret-user-token',
  };

  const rejected = await client.runConfiguredWorkflowManual({
    ...base,
    fetcher: async () => jsonResponse({ error: 'Confirmação manual inválida' }),
  });
  const unknown = await client.runConfiguredWorkflowManual({
    ...base,
    fetcher: async () => { throw new TypeError('connection lost'); },
  });

  assert.deepEqual(rejected, {
    ok: false,
    kind: 'rejected',
    message: 'Confirmação manual inválida',
  });
  assert.deepEqual(unknown, {
    ok: false,
    kind: 'unknown',
    message: 'Não foi possível confirmar o resultado. Consulte as execuções antes de tentar novamente.',
  });

  const serverFailure = await client.runConfiguredWorkflowManual({
    ...base,
    fetcher: async () => jsonResponse({ error: 'stage start failed' }, 500),
  });
  assert.deepEqual(serverFailure, {
    ok: false,
    kind: 'unknown',
    message: 'Não foi possível confirmar o resultado. Consulte as execuções antes de tentar novamente.',
  });
});

test('prepare failures are safe failures and never become an unknown execution', async () => {
  const result = await client.prepareConfiguredWorkflowManual({
    endpoint: 'https://test.supabase.co/functions/v1/automation-engine',
    flowId: '039271ed-09c4-4c75-81fe-9b4422f91875',
    accessToken: 'secret-user-token',
    fetcher: async () => { throw new TypeError('offline'); },
  });

  assert.deepEqual(result, {
    ok: false,
    message: 'Não foi possível preparar a confirmação. Tente novamente.',
  });
});

test('expired proofs are detected locally before any run request', () => {
  assert.equal(client.isConfiguredManualProofExpired('2029-12-31T23:59:59.000Z', Date.parse('2030-01-01T00:00:00.000Z')), true);
  assert.equal(client.isConfiguredManualProofExpired('2030-01-01T00:00:01.000Z', Date.parse('2030-01-01T00:00:00.000Z')), false);
  assert.equal(client.isConfiguredManualProofExpired('invalid', Date.now()), true);
});
