import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';
function fixture() {
  const requests = [], background = [];
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../functions/_shared/inbox-task-dispatch.ts', import.meta.url),'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Reflect, Date, Number, Error, AbortSignal, console,
    Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://fixture.invalid' : 'fixture-key' } },
    EdgeRuntime: { waitUntil: task => background.push(task) },
    require: () => ({ isLeadVerificationMessage: text => text === 'verification code fixture' }),
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true }; },
  });
  return { api: exports, requests, background };
}
test('native text schedules authenticated analysis without blocking webhook response', async () => {
  const f = fixture();
  f.api.scheduleInboxTaskSuggestions('conv', 'Consegues enviar a proposta?');
  assert.equal(f.background.length, 1);
  await f.background[0];
  assert.equal(f.requests[0].url, 'https://fixture.invalid/functions/v1/inbox-task-suggestions');
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { conversation_id: 'conv' });
});
test('noise, verification codes and replayed history do not schedule AI', () => {
  const f = fixture();
  f.api.scheduleInboxTaskSuggestions('conv', 'ok');
  f.api.scheduleInboxTaskSuggestions('conv', 'verification code fixture');
  f.api.scheduleInboxTaskSuggestions('conv', 'Consegues enviar a proposta?', new Date(Date.now()-11*60_000));
  assert.equal(f.requests.length, 0);
});
