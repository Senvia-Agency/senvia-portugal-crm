const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(__dirname + '/TaskEditor.tsx', 'utf8');
const ast = ts.createSourceFile('TaskEditor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const comparison = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'taskChanged');
const code = ts.transpileModule(comparison.getText(ast), {}).outputText;
const different = (first, second) => vm.runInNewContext(code + '\ntaskChanged(first, second)', { first, second });
test('schema property ordering does not turn an unchanged recovered task into an edit', () => {
 assert.equal(different({ title: 'Task', status: 'todo', description: '' }, { status: 'todo', description: '', title: 'Task' }), false);
});
test('unsaved fields and concurrent version changes remain detectable', () => {
 assert.equal(different({ title: 'Draft', version: 1 }, { title: 'Task', version: 1 }), true);
 assert.equal(different({ title: 'Task', version: 1 }, { title: 'Task', version: 2 }), true);
});

test("participant arrays compare by membership rather than reference or order",()=>{assert.equal(different({title:"Task",participantIds:["a","b"]},{title:"Task",participantIds:["b","a"]}),false);assert.equal(different({title:"Task",participantIds:["a"]},{title:"Task",participantIds:[]}),true);});
