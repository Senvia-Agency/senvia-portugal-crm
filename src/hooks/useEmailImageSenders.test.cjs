const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function setup() {
 const events = []; let options;
 const code = ts.transpileModule(fs.readFileSync(__dirname + '/useEmailImageSenders.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
 const exports = {};
 vm.runInNewContext(code, { exports, require: name => {
  if (name === '@tanstack/react-query') return {
   useQuery: () => ({ data: ['old@example.com'], isLoading: false }),
   useQueryClient: () => ({ cancelQueries: async () => events.push('cancel'), setQueryData: (_, value) => events.push([...value]), invalidateQueries: () => events.push('refresh') }),
   useMutation: value => { options = value; return { mutate: () => {}, isPending: false }; },
  };
  if (name.endsWith('AuthContext')) return { useAuth: () => ({ user: { id: 'test' } }) };
  if (name === 'sonner') return { toast: { error: () => events.push('error') } };
  if (name.endsWith('/client')) return { supabase: {} };
  throw new Error(name);
 }});
 exports.useEmailImageSenders();
 return { events, options };
}
test('image trust waits for persistence and cancels obsolete reads before confirmation', async () => {
 const { events, options } = setup();
 await options.onMutate(['new@example.com']);
 assert.deepEqual(events, ['cancel']);
 options.onSuccess(['old@example.com', 'new@example.com']);
 assert.deepEqual(events, ['cancel', ['old@example.com', 'new@example.com']]);
});
test('failed persistence reports an error rather than silently promising saved trust', () => {
 const { events, options } = setup();
 options.onError();
 assert.deepEqual(events, ['error', 'refresh']);
});
