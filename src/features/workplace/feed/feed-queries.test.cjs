const { test } = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const vm = require('node:vm');
const bundle = esbuild.buildSync({ entryPoints: ['src/features/workplace/feed/feed-queries.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@/integrations/supabase/client'] }).outputFiles[0].text;
function load(data) {
  const calls = [];
  const supabase = { from(table) {
    const call = { table, eq: {}, ids: null, from: 0, to: Infinity, order: [] }; calls.push(call);
    const builder = {
      select() { return builder; }, eq(key, value) { call.eq[key] = value; return builder; },
      in(key, ids) { assert.equal(key, 'post_id'); call.ids = ids; return builder; },
      order(key) { call.order.push(key); return builder; },
      range(from, to) { call.from = from; call.to = to; return builder; },
      limit(size) { call.to = size - 1; return builder; },
      then(resolve, reject) {
        const rows = (data[table] ?? []).filter(row => row.organization_id === call.eq.organization_id && (!call.ids || call.ids.includes(row.post_id))).slice(call.from, call.to + 1);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    }; return builder;
  } };
  const module = { exports: {} };
  vm.runInNewContext(bundle, { module, exports: module.exports, require: () => ({ supabase }) });
  return { read: module.exports.readOrganizationFeed, calls };
}
test('all interactions for visible posts are fetched beyond the API row cap', async () => {
  const rows = Array.from({ length: 1001 }, (_, id) => ({ id: String(id), organization_id: 'org', post_id: 'post', user_id: `u${id}` }));
  const api = load({ workplace_posts: [{ id: 'post', organization_id: 'org' }], workplace_comments: rows, workplace_reactions: rows });
  const result = await api.read('org');
  assert.equal(result.comments.length, 1001); assert.equal(result.reactions.length, 1001);
  assert.equal(api.calls.filter(call => call.table === 'workplace_comments').length, 2);
  assert.equal(api.calls.filter(call => call.table === 'workplace_reactions').length, 2);
  assert.ok(api.calls.every(call => call.eq.organization_id === 'org'));
  assert.ok(api.calls.filter(call => call.ids).every(call => call.ids.length === 1 && call.ids[0] === 'post'));
});
test('empty Feed never downloads unrelated organization interactions', async () => {
  const api = load({ workplace_posts: [] }); const result = await api.read('org');
  assert.equal(result.posts.length, 0); assert.equal(result.comments.length, 0); assert.equal(api.calls.length, 1);
});
