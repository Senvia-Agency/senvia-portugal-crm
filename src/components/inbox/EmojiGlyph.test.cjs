const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const exportsUnderTest = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname + '/EmojiGlyph.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
}).outputText, { exports: exportsUnderTest, require });
test('faces, skin tones and joined emoji use the local Google artwork', () => {
  for (const emoji of ['😀', '👍🏽', '👨‍👩‍👧', '🇵🇹']) {
    const html = renderToStaticMarkup(React.createElement(exportsUnderTest.EmojiGlyph, { emoji }));
    assert.ok(html.includes('/emoji/google/sheet.png'), emoji);
    assert.ok(html.includes('aria-label="' + emoji + '"'));
    assert.ok(!html.includes('https://'));
  }
});
test('unrecognized glyphs keep readable text', () => {
  assert.equal(renderToStaticMarkup(React.createElement(exportsUnderTest.EmojiGlyph, { emoji: '?' })), '<span>?</span>');
});
