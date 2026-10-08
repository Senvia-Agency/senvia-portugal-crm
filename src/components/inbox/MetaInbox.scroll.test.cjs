const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'MetaInbox.tsx'), 'utf8');
const ast = ts.createSourceFile('MetaInbox.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const thread = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MetaThread');
const effect = thread.body.statements.find(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useLayoutEffect');
assert.ok(effect, 'Opening must position the messages before paint');
assert.match(source, /<div ref={messageListRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">/);
assert.doesNotMatch(thread.getText(ast), /scrollIntoView/);
const code = ts.transpileModule(effect.getText(ast), {}).outputText;

function setup() {
  const calls = [];
  const viewport = { scrollHeight: 1800, scrollTo: options => calls.push({ ...options }) };
  const state = {
    messageListRef: { current: viewport }, positionedConversationRef: { current: null },
    conversation: { id: 'a' }, messages: [], pendentes: [], isLoading: false, isError: false,
  };
  let previous;
  const render = () => vm.runInNewContext(code, {
    ...state,
    useLayoutEffect: (callback, deps) => {
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous[i]))) callback();
      previous = deps;
    },
  });
  return { state, calls, viewport, render };
}

test('cached conversation opens instantly at the bottom', () => {
  const { state, calls, render } = setup();
  state.messages = Array(30);
  render();
  assert.deepEqual(calls, [{ top: 1800, behavior: 'instant' }]);
  render();
  assert.equal(calls.length, 1);
});

test('loading and failed requests do not consume the initial positioning', () => {
  const { state, calls, render } = setup();
  state.isLoading = true;
  render();
  state.isLoading = false;
  state.isError = true;
  render();
  assert.equal(calls.length, 0);
  state.isError = false;
  state.messages = Array(30);
  render();
  assert.deepEqual(calls, [{ top: 1800, behavior: 'instant' }]);
});

test('new messages and pending sends retain smooth scrolling', () => {
  const { state, calls, viewport, render } = setup();
  state.messages = Array(30);
  render();
  viewport.scrollHeight = 1900;
  state.messages = Array(31);
  render();
  viewport.scrollHeight = 2000;
  state.pendentes = Array(1);
  render();
  assert.deepEqual(calls.slice(1), [
    { top: 1900, behavior: 'smooth' }, { top: 2000, behavior: 'smooth' },
  ]);
});

test('another conversation with the same message count opens instantly', () => {
  const { state, calls, render } = setup();
  state.messages = Array(30);
  render();
  state.conversation = { id: 'b' };
  render();
  assert.equal(calls.at(-1).behavior, 'instant');
});
