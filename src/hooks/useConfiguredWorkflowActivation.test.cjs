const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const NodeModule = require('node:module');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '../..');
const bundle = buildSync({
  absWorkingDir: root,
  alias: { '@': path.join(root, 'src') },
  bundle: true,
  define: {
    'import.meta.env.VITE_SUPABASE_URL': '"https://example.supabase.co"',
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '"test-key"',
  },
  entryPoints: ['src/lib/configured-workflow-activation-client.ts'],
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  write: false,
}).outputFiles[0].text;
const loaded = new NodeModule(path.join(root, '.workflow-activation.test.cjs'));
loaded.filename = path.join(root, '.workflow-activation.test.cjs');
loaded.paths = NodeModule._nodeModulePaths(root);
loaded._compile(bundle, loaded.filename);
const activation = loaded.exports;

const FLOW_ID = '11111111-1111-4111-8111-111111111111';
const PREVIEW_ID = '22222222-2222-4222-8222-222222222222';
const UPDATED_AT = '2026-11-04T10:00:00.000Z';

test('activation timeout returns unknown without retrying', async () => {
  const original = AbortSignal.timeout;
  AbortSignal.timeout = () => AbortSignal.abort();
  let calls = 0;
  try {
    const result = await activation.activateConfiguredWorkflow({
      endpoint: 'https://example.supabase.co/functions/v1/configured-workflow-activation',
      flowId: FLOW_ID, previewId: PREVIEW_ID, snapshotDigest: 'a'.repeat(64),
      expiresAt: UPDATED_AT, accessToken: 'token',
      fetcher: async (_url, init) => { calls++; if (init.signal?.aborted) throw new Error('timeout'); return new Promise(() => {}); },
    });
    assert.equal(result.kind, 'unknown');
    assert.equal(calls, 1);
  } finally { AbortSignal.timeout = original; }
});

test('prepare sends the exact flow snapshot and parses the server proof', async () => {
  let request;
  const result = await activation.prepareConfiguredWorkflowActivation({
    endpoint: 'https://example.supabase.co/functions/v1/configured-workflow-activation',
    flowId: FLOW_ID,
    version: 3,
    updatedAt: UPDATED_AT,
    accessToken: 'session-token',
    fetcher: async (_url, init) => {
      request = init;
      return new Response(JSON.stringify({
        action: 'prepared',
        flow: { id: FLOW_ID, name: 'Cobranças', status: 'draft', version: 3, updated_at: UPDATED_AT },
        preview: {
          scanned_records: 12,
          eligible_records: 4,
          eligible_stages: 7,
          observed_local_date: '2026-11-04',
          time_zone: 'Europe/Lisbon',
          stages: [{ stage_id: 'stage_email', node_id: 'email', eligible_records: 4 }],
        },
        confirmation: { preview_id: PREVIEW_ID, snapshot_digest: 'a'.repeat(64), expires_at: '2026-11-04T10:05:00.000Z' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(request.body), {
    action: 'prepare',
    flow_id: FLOW_ID,
    expected_version: 3,
    expected_updated_at: UPDATED_AT,
  });
  assert.equal(request.headers.Authorization, 'Bearer session-token');
  assert.equal(result.proof.previewId, PREVIEW_ID);
  assert.equal(result.preview.eligible_records, 4);
});

test('prepare turns the MFA reason code into an actionable message', async () => {
  const result = await activation.prepareConfiguredWorkflowActivation({
    endpoint: 'https://example.supabase.co/functions/v1/configured-workflow-activation',
    flowId: FLOW_ID,
    version: 3,
    updatedAt: UPDATED_AT,
    accessToken: 'session-token',
    fetcher: async () => new Response(JSON.stringify({ error: 'Forbidden', reason_code: 'mfa_required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  assert.deepEqual(result, { ok: false, message: 'Confirme a autenticação de dois fatores antes de ativar.' });
});

test('activate sends only the short-lived proof and digest', async () => {
  let body;
  const result = await activation.activateConfiguredWorkflow({
    endpoint: 'https://example.supabase.co/functions/v1/configured-workflow-activation',
    accessToken: 'session-token',
    flowId: FLOW_ID,
    previewId: PREVIEW_ID,
    snapshotDigest: 'b'.repeat(64),
    expiresAt: '2026-11-04T10:05:00.000Z',
    fetcher: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        action: 'activated',
        flow: { id: FLOW_ID, name: 'Cobranças', status: 'active', version: 4, updated_at: UPDATED_AT },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(body, {
    action: 'activate',
    flow_id: FLOW_ID,
    preview_id: PREVIEW_ID,
    snapshot_digest: 'b'.repeat(64),
  });
});
