const { test } = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const vm = require('node:vm');
const bundle = esbuild.buildSync({ entryPoints: ['src/features/workplace/feed/useCommentDraft.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'] }).outputFiles[0].text;
function load(storage) {
  const module = { exports: {} }; const states = [];
  vm.runInNewContext(bundle, { module, exports: module.exports, Error, window: { localStorage: storage }, require: name => {
    assert.equal(name, 'react');
    return { useState: initial => { const value = typeof initial === 'function' ? initial() : initial; const index = states.push(value) - 1; return [value, next => { states[index] = next; }]; } };
  } });
  return { use: module.exports.useCommentDraft, states };
}
function storage() { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; }
test('unsent comment recovers only for its user organization and post', () => {
  const store = storage(); load(store).use('u:o', 'post1').change('Responder amanhã');
  assert.equal(load(store).use('u:o', 'post1').text, 'Responder amanhã');
  assert.equal(load(store).use('u:o', 'post2').text, '');
  assert.equal(load(store).use('u:other', 'post1').text, '');
  assert.equal(load(store).use('other:o', 'post1').text, '');
});
test('failed draft persistence retains typed comment and exposes visible error', () => {
  const store = storage(); store.setItem = () => { throw new Error('quota'); };
  const hook = load(store); hook.use('u:o', 'post').change('Não perder');
  assert.equal(hook.states[1], 'Não perder');
  assert.match(hook.states[2], /não foi guardado/);
});
test('published comment clears only its own recovered draft', () => {
  const store = storage(); load(store).use('u:o', 'p1').change('Primeiro'); load(store).use('u:o', 'p2').change('Segundo');
  load(store).use('u:o', 'p1').published();
  assert.equal(load(store).use('u:o', 'p1').text, '');
  assert.equal(load(store).use('u:o', 'p2').text, 'Segundo');
});
