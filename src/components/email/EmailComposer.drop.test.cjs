const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(__dirname + '/EmailComposer.tsx', 'utf8');
const ast = ts.createSourceFile('EmailComposer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const composer = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'EmailComposer');
const handler = composer.body.statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(ast) === 'handleDrop'));
const code = ts.transpileModule(handler.getText(ast) + '\nhandleDrop(event);', {}).outputText;
test('email file drop captures the files for attachment staging and expands a minimized composer', () => {
 const files = [{ name: 'example.pdf' }, { name: 'example.png' }]; const calls = [];
 vm.runInNewContext(code, {
  event: { dataTransfer: { types: ['Files'], files }, preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') },
  setIsDragging: value => calls.push(['dragging', value]), setMinimized: value => calls.push(['minimized', value]),
  onFiles: selected => calls.push(['files', selected]),
 });
 assert.deepEqual(calls, ['prevent', 'stop', ['dragging', false], ['minimized', false], ['files', files]]);
 assert.match(source, /onDropCapture={handleDrop}/);
});
test('ordinary text drags keep their normal editor behavior', () => {
 vm.runInNewContext(code, { event: { dataTransfer: { types: ['text/plain'] }, preventDefault: () => assert.fail('text drag should not be intercepted') } });
});
