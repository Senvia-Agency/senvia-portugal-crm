const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, database) {
  const exports = {}, invalidations = [];
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname + '/' + file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, require: name => {
      if (name.includes('react-query')) return { useQuery: options => options, useMutation: options => options,
        useQueryClient: () => ({ invalidateQueries: async x => invalidations.push(x), cancelQueries: async () => {}, getQueryData: () => true, setQueryData: () => {} }) };
      if (name.includes('AuthContext')) return { useAuth: () => ({ organization: { id: 'org' }, user: { id: 'user' } }) };
      if (name.includes('supabase/client')) return { supabase: database };
      throw new Error('Unexpected import');
    },
  });
  return { api: exports, invalidations };
}
test('AI analysis uses native conversation ID and refreshes task suggestions after success', async () => {
  let payload;
  const f = load('useNativeTaskSuggestions.ts', { functions: { invoke: async (name, options) => {
    payload = { name, options }; return { data: { ok: true, analyzed: 1, suggested: 1 } };
  } } });
  const query = f.api.useNativeTaskSuggestions('native-uuid', 'message-id', true);
  assert.equal(query.enabled, true);
  await query.queryFn();
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), { name: 'inbox-task-suggestions', options: { body: { conversation_id: 'native-uuid' } } });
  assert.equal(f.invalidations.length, 1);
  assert.equal(f.api.useNativeTaskSuggestions('native-uuid', 'message-id', false).enabled, false);
});
test('failed AI analysis is surfaced instead of reporting an empty successful result', async () => {
  const f = load('useNativeTaskSuggestions.ts', { functions: { invoke: async () => ({ error: new Error('offline') }) } });
  await assert.rejects(f.api.useNativeTaskSuggestions('conv', 'msg', true).queryFn());
  assert.equal(f.invalidations.length, 0);
});
test('AI toggle reads the selected WhatsApp box even with multiple boxes', async () => {
  const filters = [];
  const query = { select: fields => { assert.equal(fields, 'metadata_public'); return query; },
    eq: (key, value) => { filters.push([key, value]); return query; }, is: () => query,
    then: resolve => Promise.resolve({ data: [{ metadata_public: { ai_tasks_enabled: false } }] }).then(resolve) };
  const f = load('useInboxTasks.ts', { from: () => query });
  assert.equal(await f.api.useAiTasksEnabled('chosen-channel').queryFn(), false);
  assert.ok(filters.some(([key, value]) => key === 'id' && value === 'chosen-channel'));
});
test('AI toggle updates only the chosen channel', async () => {
  let update;
  const f = load('useInboxTasks.ts', { rpc: async (name, args) => { update = { name, args }; return {}; } });
  await f.api.useSaveAiTasksEnabled('chosen-channel').mutationFn(false);
  assert.deepEqual(JSON.parse(JSON.stringify(update)), { name: 'merge_messaging_channel_metadata_by_id', args: { p_channel_id: 'chosen-channel', p_patch: { ai_tasks_enabled: false } } });
});
test('manual native task retains its source box and conversation queries scope that box', async () => {
  let inserted, scoped;
  const query = { select: () => query, eq: () => query, or: value => { scoped = value; return query; },
    order: () => query, limit: async () => ({ data: [], error: null }),
    insert: async value => { inserted = value; return {}; } };
  const f = load('useInboxTasks.ts', { from: () => query });
  await f.api.useCreateInboxTask().mutationFn({ title: 'Enviar proposta', sourceChannelId: 'box-id' });
  assert.equal(inserted.source_channel_id, 'box-id');
  await f.api.useConversationTasks('351912345678', 'box-id').queryFn();
  assert.equal(scoped, 'source_channel_id.is.null,source_channel_id.eq.box-id');
});
