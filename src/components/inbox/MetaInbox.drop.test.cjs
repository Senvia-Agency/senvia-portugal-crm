const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const ast = ts.createSourceFile('MetaInbox.tsx', fs.readFileSync(__dirname + '/MetaInbox.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const thread = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'MetaThread');
const names = new Set(['aceitaFicheiro', 'colar', 'handleFileDrop']);
const statements = thread.body.statements.filter(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => names.has(d.name.getText(ast))));
const code = ts.transpileModule(statements.map(s => s.getText(ast)).join('\n') + '\nhandleFileDrop(event);', {}).outputText;
function drop({ archived = false, expired = false, types = ['Files'], files = [{ type: 'application/pdf', name: 'example.pdf' }, { type: 'image/png', name: 'image.png' }] } = {}) {
 const result = { files: [], prevented: false, focused: false, errors: [] };
 vm.runInNewContext(code, {
  event: { dataTransfer: { types, files }, preventDefault: () => { result.prevented = true; }, stopPropagation() {} },
  channelType: 'whatsapp', arquivada: archived, windowExpired: expired,
  dragDepth: { current: 2 }, setDraggingFiles() {},
  setColados: update => { result.files = update([]); },
  crypto: { randomUUID: () => 'test' }, URL: { createObjectURL: file => 'blob:' + file.name },
  composerRef: { current: { focus: () => { result.focused = true; } } },
  toast: { error: message => result.errors.push(message) },
 });
 return result;
}
test('WhatsApp file drop queues images and documents for confirmation, never sends directly', () => {
 const result = drop();
 assert.equal(result.files.length, 2);
 assert.equal(result.files[0].file.name, 'example.pdf');
 assert.equal(result.prevented, true);
 assert.equal(result.focused, true);
});
test('archived and expired conversations reject dropped attachments', () => {
 for (const options of [{ archived: true }, { expired: true }]) {
  const result = drop(options);
  assert.equal(result.files.length, 0);
  assert.equal(result.errors.length, 1);
 }
});
test('dragging ordinary text keeps native browser behavior', () => {
 const result = drop({ types: ['text/plain'], files: [] });
 assert.equal(result.prevented, false);
 assert.equal(result.files.length, 0);
});
