const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
test('colon suggestions respect the cursor and preserve surrounding draft text', () => {
  const source = fs.existsSync(__dirname + '/emoji-shortcut.ts') ? fs.readFileSync(__dirname + '/emoji-shortcut.ts', 'utf8') : '';
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
  assert.equal(typeof exports.emojiShortcutAt, 'function');
  assert.deepEqual(JSON.parse(JSON.stringify(exports.emojiShortcutAt('Olá :so depois', 7))), { start: 4, end: 7, query: 'so' });
  assert.equal(exports.emojiShortcutAt('https://site', 12), null);
  assert.equal(exports.emojiShortcutAt('12:30', 5), null);
  assert.equal(exports.emojiShortcutAt(':', 1).query, '');
  const result = exports.insertComposerEmoji('Olá :so depois', 4, 7, '☀️');
  assert.equal(result.text, 'Olá ☀️ depois');
  assert.equal(result.cursor, 'Olá ☀️'.length);
});
