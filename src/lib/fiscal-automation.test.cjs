const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname + '/fiscal-automation.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: api });

test('a sale follows the client unless it makes its own choice', () => {
  assert.equal(api.effectiveSaleSetting(null, true), true);
  assert.equal(api.effectiveSaleSetting(undefined, false), false);
  assert.equal(api.effectiveSaleSetting(false, true), false);
  assert.equal(api.effectiveSaleSetting(true, false), true);
  assert.equal(api.effectiveSaleSetting(null, null), false);
});

test('the sale choice maps to the stored value both ways', () => {
  assert.equal(api.choiceFromValue(null), 'follow');
  assert.equal(api.choiceFromValue(true), 'on');
  assert.equal(api.choiceFromValue(false), 'off');
  assert.equal(api.valueFromChoice('follow'), null);
  assert.equal(api.valueFromChoice('on'), true);
  assert.equal(api.valueFromChoice('off'), false);
});

test('automatic receipts are only offered with an active KeyInvoice credential', () => {
  assert.equal(api.isKeyInvoiceActive({ billing_provider: 'keyinvoice', tem_keyinvoice_password: true, integrations_enabled: { keyinvoice: true } }), true);
  assert.equal(api.isKeyInvoiceActive({ billing_provider: 'keyinvoice', tem_keyinvoice_password: false, integrations_enabled: { keyinvoice: true } }), false);
  assert.equal(api.isKeyInvoiceActive({ billing_provider: 'invoicexpress', tem_keyinvoice_password: true, integrations_enabled: { keyinvoice: true } }), false);
  assert.equal(api.isKeyInvoiceActive(null), false);
});

test('job states read in plain terms', () => {
  assert.equal(api.automaticReceiptState('pending'), 'queued');
  assert.equal(api.automaticReceiptState('retry'), 'retry');
  assert.equal(api.automaticReceiptState('issued'), 'issued');
  assert.equal(api.automaticReceiptState('manual_review'), 'review');
  assert.equal(api.automaticReceiptState('reconciliation_required'), 'review');
  assert.equal(api.automaticReceiptState('cancelled'), 'cancelled');
});
