const { test } = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const vm = require('node:vm');
const bundle = esbuild.buildSync({ entryPoints: ['src/features/workplace/feed/feed-actions.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@/integrations/supabase/client'] }).outputFiles[0].text;
function load() {
  const rows = new Map(); const writes = []; let uncertain = false;
  const supabase = { from(table) {
    const filters = new Map(); let inserted;
    const builder = {
      select() { return builder; },
      eq(key, value) { filters.set(key, value); return builder; },
      insert(row) { inserted = row; return builder; },
      async maybeSingle() {
        const data = rows.get(`${table}:${filters.get('id')}`) ?? null;
        return { data: data?.organization_id === filters.get('organization_id') ? data : null, error: null };
      },
      async single() {
        writes.push({ table, row: inserted });
        rows.set(`${table}:${inserted.id}`, inserted);
        return uncertain ? { data: null, error: { message: 'connection lost after commit' } } : { data: inserted, error: null };
      },
    };
    return builder;
  } };
  const module = { exports: {} };
  vm.runInNewContext(bundle, { module, exports: module.exports, Error, require: () => ({ supabase }) });
  return { ...module.exports, writes, rows, makeUncertain: () => { uncertain = true; } };
}
test('uncertain publication commit confirms existing ID and retry never duplicates', async () => {
  const api = load(); api.makeUncertain(); const scope = { organizationId: 'org', userId: 'user' };
  const input = { id: 'stable-id', body: 'Texto preservado', kind: 'publication' };
  await api.publishPost(scope, input); await api.publishPost(scope, input);
  assert.equal(api.writes.length, 1);
  assert.equal(api.writes[0].row.organization_id, 'org');
  assert.equal(api.writes[0].row.author_id, 'user');
});
test('retrying an ID with changed content is rejected without replacing the original', async () => {
  const api = load(); const scope = { organizationId: 'org', userId: 'user' };
  await api.publishPost(scope, { id: 'id', body: 'Original', kind: 'publication' });
  await assert.rejects(api.publishPost(scope, { id: 'id', body: 'Alterado', kind: 'publication' }), /Não foi criado um duplicado/);
  assert.equal(api.writes.length, 1); assert.equal(api.rows.get('workplace_posts:id').body, 'Original');
});
test('recognition retry keeps recipient and type, and a changed recipient is never merged', async () => {
  const api = load(); api.makeUncertain(); const scope = { organizationId: 'org', userId: 'user' };
  const input = { id: 'rec-id', body: 'Fechou a proposta com um acompanhamento impecável.', kind: 'recognition', recipientId: 'ana', recognitionType: 'great_work' };
  await api.publishPost(scope, input); await api.publishPost(scope, input);
  assert.equal(api.writes.length, 1);
  assert.equal(api.writes[0].row.recipient_id, 'ana'); assert.equal(api.writes[0].row.recognition_type, 'great_work');
  await assert.rejects(api.publishPost(scope, { ...input, recipientId: 'rui' }), /Não foi criado um duplicado/);
});
test('uncertain comment commit is recovered without duplicate or cross-post replacement', async () => {
  const api = load(); api.makeUncertain(); const scope = { organizationId: 'org', userId: 'user' };
  const input = { id: 'comment-id', postId: 'post', body: 'Comentário' };
  await api.publishComment(scope, input); await api.publishComment(scope, input);
  await assert.rejects(api.publishComment(scope, { ...input, postId: 'other-post' }), /outro comentário/);
  assert.equal(api.writes.length, 1); assert.equal(api.writes[0].row.post_id, 'post');
});
