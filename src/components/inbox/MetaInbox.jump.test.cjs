const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'MetaInbox.tsx'), 'utf8');
const ast = ts.createSourceFile('MetaInbox.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const thread = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MetaThread');
const declarations = thread.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]);
function callback(node, context) {
  assert.ok(node, 'The conversation control must exist');
  const exports = {};
  const code = ts.transpileModule('exports.run = ' + node.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, ...context });
  return exports.run;
}

test('jump to latest immediately scrolls only the message viewport and keeps the draft', () => {
  const viewport = { scrollHeight: 3000, scrollTop: 100, clientHeight: 500 };
  const nearBottomRef = { current: false };
  const scrollBeforeHistoryRef = { current: { height: 2500, top: 100 } };
  let visible = true;
  const run = callback(declarations.find(node => node.name.getText(ast) === 'goToLatest')?.initializer, {
    messageListRef: { current: viewport }, nearBottomRef, scrollBeforeHistoryRef,
    setShowJumpToLatest: value => { visible = value; },
    setDraft: () => assert.fail('Jumping must not change the draft'),
  });
  run();
  assert.equal(viewport.scrollTop, viewport.scrollHeight);
  assert.equal(nearBottomRef.current, true);
  assert.equal(scrollBeforeHistoryRef.current, null);
  assert.equal(visible, false);
});

test('jump control appears away from the latest messages and hides near the bottom', () => {
  let scrollHandler;
  const visit = node => {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onScroll') scrollHandler = node.initializer.expression;
    ts.forEachChild(node, visit);
  };
  visit(thread);
  const nearBottomRef = { current: true };
  let visible = false;
  const onScroll = callback(scrollHandler, { nearBottomRef, setShowJumpToLatest: value => { visible = value; } });
  onScroll({ currentTarget: { scrollHeight: 3000, scrollTop: 100, clientHeight: 500 } });
  assert.equal(visible, true);
  assert.equal(nearBottomRef.current, false);
  onScroll({ currentTarget: { scrollHeight: 3000, scrollTop: 2450, clientHeight: 500 } });
  assert.equal(visible, false);
  assert.equal(nearBottomRef.current, true);
});
