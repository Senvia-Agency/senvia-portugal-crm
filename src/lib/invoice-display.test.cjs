const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname + '/invoice-display.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: api });

test('automatic documents show the frozen fiscal recipient when the display column is empty', () => {
  assert.equal(api.invoiceClientName({ client_name: null, fiscal_snapshot: { client: { name: 'Fiscal recipient' } } }), 'Fiscal recipient');
  assert.equal(api.invoiceClientName({ client_name: 'Legacy recipient', fiscal_snapshot: { client: { name: 'Other' } } }), 'Legacy recipient');
  assert.equal(api.invoiceClientName({ raw_data: { snapshot: { client: { name: 'Archived recipient' } } } }), 'Archived recipient');
  assert.equal(api.invoiceClientName({ fiscal_snapshot: { client: null } }), null);
});

test('invoice and partial receipts show their actual related references in both directions', () => {
  const rows = [
    { id: 'ft', reference: 'FT 23/5', related_invoice_id: null },
    { id: 'rc1', reference: 'RC 38/1', related_invoice_id: 'ft' },
    { id: 'rc2', reference: 'RC 38/2', related_invoice_id: 'ft' },
    { id: 'pending', reference: null, related_invoice_id: 'ft' },
    { id: 'fr', reference: 'FR 25/1', related_invoice_id: null },
  ];
  const related = api.invoiceRelatedReferences(rows);
  assert.equal(related.get('rc1'), 'FT 23/5');
  assert.equal(related.get('rc2'), 'FT 23/5');
  assert.equal(related.get('ft'), 'RC 38/1, RC 38/2');
  assert.equal(related.get('fr'), undefined);
});

test('credit-note links remain available without duplicate references', () => {
  const related = api.invoiceRelatedReferences([
    { id: 'ft', reference: 'FT 1', related_invoice_id: null, credit_note_reference: 'NC 1' },
    { id: 'nc', reference: 'NC 1', related_invoice_id: 'ft' },
  ]);
  assert.equal(related.get('ft'), 'NC 1');
  assert.equal(related.get('nc'), 'FT 1');
});
