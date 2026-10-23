const { test } = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const vm = require('node:vm');
const bundle = esbuild.buildSync({ entryPoints: ['src/features/workplace/feed/useFeedIntent.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'] }).outputFiles[0].text;
function load(storage) {
  const module = { exports: {} };
  vm.runInNewContext(bundle, { module, exports: module.exports, Error, crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' }, window: { localStorage: storage }, require: () => ({ useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] }) });
  return module.exports.useFeedIntent;
}
function storage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; }
test('unconfirmed publication keeps the same ID and payload after reload', () => {
  const store = storage(); const attempt = load(store)('scope:publish').prepare('Texto original', 'publication');
  const recovered = load(store)('scope:publish');
  assert.equal(recovered.prepare('Texto alterado', 'announcement').id, attempt.id);
  assert.equal(recovered.pending.body, 'Texto original');
  assert.equal(recovered.pending.kind, 'publication');
});
test('failure to preserve an attempt stops the action before returning an ID', () => {
  const store = storage(); store.setItem = () => { throw new Error('quota'); };
  assert.throws(() => load(store)('scope:publish').prepare('Não perder', 'publication'), /quota/);
});
test('confirmed attempt clears only its scoped identity', () => {
  const store = storage(); load(store)('first').prepare('Primeiro', 'comment'); load(store)('second').prepare('Segundo', 'comment');
  load(store)('first').clear();
  assert.equal(load(store)('first').pending, null);
  assert.equal(load(store)('second').pending.body, 'Segundo');
});
