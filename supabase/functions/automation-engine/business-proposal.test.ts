import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { executeBusinessAction } from './business-actions.ts';

test('proposal action sends exact persisted multi-line quantities and totals with scoped names', async () => {
  let sent: unknown;
  const db = createClient('https://proposal.test', 'service-test-key', { auth: { persistSession: false }, global: {
    fetch: async (request, init) => {
      const url = new URL(typeof request === 'string' ? request : request instanceof URL ? request.href : request.url);
      switch (url.pathname) {
        case '/rest/v1/proposals': return Response.json({ id: 'proposal', code: 'P12', proposal_date: '2026-11-04', total_value: 216.9, client_id: 'client', notes: 'Condições reais' });
        case '/rest/v1/crm_clients': return Response.json({ name: 'Ana', email: 'ana@example.test' });
        case '/rest/v1/organizations': return Response.json({ name: 'Empresa' });
        case '/rest/v1/proposal_products':
          assert.equal(url.searchParams.get('proposal_id'), 'eq.proposal');
          return Response.json([{ product_id: 'a', quantity: 2, unit_price: 100, total: 180 }, { product_id: 'b', quantity: 3, unit_price: 12.3, total: 36.9 }]);
        case '/rest/v1/products':
          assert.equal(url.searchParams.get('organization_id'), 'eq.org');
          return Response.json([{ id: 'a', name: 'Serviço A' }, { id: 'b', name: 'Serviço B' }]);
        case '/functions/v1/send-proposal-email':
          sent = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
          return Response.json({ success: true, email_send_id: 'ledger' });
        default: throw new Error(`Unexpected request ${url.pathname}`);
      }
    },
  } });
  const outcome = await executeBusinessAction(db, { type: 'send_proposal_email', node_id: 'node', config: {}, vars: {}, run: {
    id: 'run', flow_id: 'flow', organization_id: 'org', subject_type: 'proposal', subject_id: 'proposal',
    contact_name: null, contact_email: null, contact_phone: null, context: {},
  } });
  assert.equal(outcome?.kind, 'next');
  assert.deepEqual(sent, { organizationId: 'org', to: 'ana@example.test', clientName: 'Ana', proposalCode: 'P12',
    proposalDate: '2026-11-04', totalValue: 216.9,
    products: [{ name: 'Serviço A', quantity: 2, unitPrice: 100, total: 180 }, { name: 'Serviço B', quantity: 3, unitPrice: 12.3, total: 36.9 }],
    automationRunId: 'run', automationNodeId: 'node', notes: 'Condições reais', orgName: 'Empresa' });
});
