const { test } = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const vm = require('node:vm');
const result = esbuild.buildSync({ entryPoints: ['src/features/workplace/feed/feed-storage.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const moduleBox = { exports: {} };
vm.runInNewContext(result.outputFiles[0].text, { module: moduleBox, exports: moduleBox.exports });
const api = moduleBox.exports;
function storage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }
test('local Feed draft recovers without leaking across users or organizations', () => {
  const store = storage(); const key = api.feedStorageKey('user', 'org');
  api.writeFeed(store, key, { ...api.emptyFeed(), draft: 'uma ideia para amanhã' });
  assert.equal(api.readFeed(store, key).draft, 'uma ideia para amanhã');
  assert.equal(api.readFeed(store, api.feedStorageKey('other', 'org')).draft, '');
  assert.equal(api.readFeed(store, api.feedStorageKey('user', 'other')).draft, '');
});
test('invalid stored data is rejected and never overwritten during recovery', () => {
  const store = storage(); store.setItem('key', '{broken');
  assert.throws(() => api.readFeed(store, 'key'));
  assert.equal(store.getItem('key'), '{broken');
});
test('quota failure is surfaced instead of accepted as saved publication', () => {
  assert.throws(() => api.writeFeed({ setItem: () => { throw new Error('quota'); } }, 'key', api.emptyFeed()), /quota/);
});
test('publication reactions and comments survive reload as one local record', () => {
  const store = storage(); const author = { id: 'u', name: 'Pessoa de teste' };
  const post = { id: 'p', author, text: 'Atualização local', kind: 'announcement', pinned: true, createdAt: '2026-10-23T10:00:00.000Z', reactions: ['u'], comments: [{ id: 'c', author, text: 'Anotado', createdAt: '2026-10-23T10:01:00.000Z' }] };
  api.writeFeed(store, 'scope', { ...api.emptyFeed(), posts: [post] });
  const recovered = api.readFeed(store, 'scope');
  assert.equal(recovered.posts[0].comments[0].text, 'Anotado');
  assert.equal(recovered.posts[0].reactions[0], 'u');
  assert.equal(recovered.posts[0].pinned, true);
});
