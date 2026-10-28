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

test('the first month reads from its own documents, then from why it waits', () => {
  const base = { lastError: null, policy: 'invoice_then_receipt', anchorDate: '2026-10-27', today: '2026-10-27', documents: [] };
  assert.equal(api.firstMonthState(base), 'queued');
  assert.equal(api.firstMonthState({ ...base, policy: 'invoice_receipt_when_paid' }), 'waiting_payment');
  assert.equal(api.firstMonthState({ ...base, anchorDate: '2026-11-03' }), 'waiting_start');
  assert.equal(api.firstMonthState({ ...base, lastError: '[missing_nif] Sem NIF' }), 'review');
  assert.equal(api.firstMonthState({ ...base, documents: [{ document_type: 'invoice', processing_status: 'processing' }] }), 'processing');
  assert.equal(api.firstMonthState({ ...base, documents: [{ document_type: 'invoice', processing_status: 'manual_review' }] }), 'review');
  // A receipt alone is not the month's document; a voided Fatura no longer counts.
  assert.equal(api.firstMonthState({ ...base, documents: [{ document_type: 'receipt', processing_status: 'issued' }] }), 'queued');
  assert.equal(api.firstMonthState({ ...base, documents: [{ document_type: 'invoice', processing_status: 'void' }] }), 'queued');
  // Once issued, an older error no longer matters.
  assert.equal(api.firstMonthState({ ...base, lastError: 'x', documents: [{ document_type: 'invoice', processing_status: 'issued' }] }), 'issued');
});

test('job states read in plain terms', () => {
  assert.equal(api.automaticReceiptState('pending'), 'queued');
  assert.equal(api.automaticReceiptState('retry'), 'retry');
  assert.equal(api.automaticReceiptState('issued'), 'issued');
  assert.equal(api.automaticReceiptState('manual_review'), 'review');
  assert.equal(api.automaticReceiptState('reconciliation_required'), 'review');
  assert.equal(api.automaticReceiptState('cancelled'), 'cancelled');
});
