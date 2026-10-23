const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(__dirname + '/MetaInbox.tsx', 'utf8');
const ast = ts.createSourceFile('MetaInbox.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = ast.statements.filter(ts.isVariableStatement).filter(statement => statement.declarationList.declarations.some(d => d.name.getText(ast).startsWith('REACOES_'))).map(d => d.getText(ast)).join('\n');
const picker = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'ReactionPicker');
const choice = picker.body.statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(ast) === 'reacoes')).getText(ast);
const reactions = channelType => vm.runInNewContext(declarations + '\n' + choice + '\nJSON.stringify(reacoes)', { channelType });
test('WhatsApp offers its full quick reaction row rather than the Instagram heart-only rule', () => {
 assert.deepEqual(JSON.parse(reactions('whatsapp')), ['👍', '❤️', '😂', '😮', '😢', '🙏']);
});
test('Instagram remains heart-only and Messenger retains its supported reactions', () => {
 assert.deepEqual(JSON.parse(reactions('instagram')), ['❤️']);
 assert.deepEqual(JSON.parse(reactions('facebook')), ['❤️', '😂', '😮', '😢', '😡', '👍']);
});
