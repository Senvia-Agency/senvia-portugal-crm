const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness(access) {
  let handler;
  let claims = 0;
  const pushes = [];
  const checks = [];
  const task = { id: 'task', organization_id: 'org', title: 'Protected customer request', contact_name: 'Customer', contact_phone: '351912345678', assigned_to: 'excluded-member', created_by: 'creator', source_channel_id: 'private-channel' };
  const admin = {
    rpc: async (name, args) => { checks.push({ name, args: JSON.parse(JSON.stringify(args)) }); return { data: access, error: access instanceof Error ? access : null }; },
    from: () => {
      let update = false;
      const query = {
        select() { return this; }, is() { return this; }, eq() { return this; }, not() { return this; }, lte() { return this; },
        limit: async () => ({ data: [task], error: null }),
        update() { update = true; return this; },
        maybeSingle: async () => { if (update) claims++; return { data: { id: task.id }, error: null }; },
      };
      return query;
    },
  };
  const source = ts.createSourceFile('index.ts', fs.readFileSync('supabase/functions/task-reminders/index.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const code = source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source)).join('\n');
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: {}, Request, Response, URL, Date, JSON, console: { error() {} },
    createClient: () => admin, internalJobGuard: async () => null,
    Deno: { serve: next => { handler = next; }, env: { get: name => name === 'SUPABASE_URL' ? 'https://test.invalid' : 'service-key' } },
    fetch: async (_url, options) => { pushes.push(JSON.parse(options.body)); return new Response('{}'); },
  });
  return { run: () => handler(new Request('https://test.invalid', { method: 'POST' })), pushes, checks, claims: () => claims };
}

test('excluded task assignee cannot receive a protected channel title', async () => {
  const job = harness(false);
  const result = await job.run();
  assert.equal(result.status, 200);
  assert.equal(job.pushes.length, 0);
  assert.equal(job.claims(), 0);
  assert.deepEqual(job.checks, [{ name: 'pode_aceder_caixa', args: { _user_id: 'excluded-member', _channel_id: 'private-channel' } }]);
});

test('channel authorization errors cannot release protected reminders', async () => {
  const job = harness(new Error('Authorization unavailable'));
  const result = await job.run();
  assert.equal(result.status, 500);
  assert.equal(job.pushes.length, 0);
  assert.equal(job.claims(), 0);
});

test('authorized task assignee receives their scoped reminder', async () => {
  const job = harness(true);
  const result = await job.run();
  assert.equal(result.status, 200);
  assert.equal(job.pushes.length, 1);
  assert.equal(job.claims(), 1);
  assert.deepEqual(job.pushes[0].user_ids, ['excluded-member']);
});
