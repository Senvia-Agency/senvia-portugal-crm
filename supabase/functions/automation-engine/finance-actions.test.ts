import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { financialRequest, InvalidFinancialAction, executeFinanceAction } from './finance-actions.ts';

test('invoice action prepares an approval request without claiming emission', () => {
  assert.deepEqual(financialRequest('request_issue_invoice', { reason: 'Cliente pediu fatura' }), {
    kind: 'issue_invoice', details: { reason: 'Cliente pediu fatura' },
  });
});
test('status approval requires a supported requested state', () => {
  assert.throws(() => financialRequest('request_sale_status', { reason: 'Rever', target_status: 'paid' }), InvalidFinancialAction);
  assert.equal(financialRequest('request_sale_status', { reason: 'Instalado', target_status: 'delivered' })?.details.target_status, 'delivered');
});
test('requests require an explanation and never accept arbitrary operations', () => {
  assert.throws(() => financialRequest('request_service_suspension', { reason: '' }), InvalidFinancialAction);
  assert.equal(financialRequest('issue_invoice', { reason: 'direto' }), null);
});
test('proposal conversion is rejected before database access for another entity', async () => {
  const input = { type: 'create_sale_from_proposal', config: {}, vars: {}, run: { id: 'r', flow_id: 'f', organization_id: 'o', subject_type: 'lead', subject_id: 'l', contact_name: null, contact_email: null, contact_phone: null, context: {} } };
  const client = createClient('http://127.0.0.1:54321', 'test-key', { global: { fetch: async () => { throw new Error('database must not be called'); } } });
  const result = await executeFinanceAction(client, input);
  assert.equal(result?.kind, 'fail');
});
