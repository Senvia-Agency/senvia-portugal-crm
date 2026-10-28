const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname + '/commission-earnings.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: api });

const sale = { status: 'in_progress', is_paid: false, total_value: 1000, paid_amount: 500, comissao: 250 };

test('outside telecom the commission follows the payments, whatever the sale status', () => {
  assert.deepEqual({ ...api.commissionPortions({ ...sale, commission_by_payment: true }) }, { confirmed: 125, pending: 125, fraction: 0.5 });
  assert.equal(api.commissionPortions({ ...sale, commission_by_payment: true, is_paid: true }).confirmed, 250);
  assert.equal(api.commissionPortions({ ...sale, commission_by_payment: true, paid_amount: 0 }).confirmed, 0);
});

test('a cancelled sale earns nothing, paid or not', () => {
  assert.deepEqual({ ...api.commissionPortions({ ...sale, status: 'cancelled', commission_by_payment: true }) }, { confirmed: 0, pending: 0, fraction: 0 });
});

test('telecom keeps waiting for the sale to be concluded', () => {
  assert.equal(api.commissionPortions(sale).confirmed, 0);
  assert.equal(api.commissionPortions({ ...sale, status: 'fulfilled' }).confirmed, 125);
  assert.equal(api.commissionPortions({ ...sale, status: 'delivered', earned_by_operator: true }).confirmed, 250);
});
