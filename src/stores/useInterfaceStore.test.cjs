const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(storage) {
  const api = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname + '/useInterfaceStore.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: api, require, localStorage: storage });
  return api.useInterfaceStore;
}

test('new interface is default and classic preference survives a fresh load', () => {
  const values = new Map([['draft', 'Unsent message']]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const first = load(storage);
  assert.equal(first.getState().legacy, false);
  first.getState().setLegacy(true);
  const second = load(storage);
  assert.equal(second.getState().legacy, true);
  second.getState().setLegacy(false);
  assert.equal(load(storage).getState().legacy, false);
  assert.equal(values.get('draft'), 'Unsent message');
});
