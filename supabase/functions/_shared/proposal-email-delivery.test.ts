import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { deliverProposalAutomationEmail } from './proposal-email-delivery.ts';

function fixture() {
  let state = 'new';
  const db = createClient('https://delivery.test', 'service-test-key', { auth: { persistSession: false }, global: {
    fetch: async (request, init) => {
      const url = new URL(typeof request === 'string' ? request : request instanceof URL ? request.href : request.url);
      const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      if (url.pathname.endsWith('/claim_automation_email_delivery')) {
        const decision = state === 'new' ? 'send' : state === 'sent' ? 'sent' : 'blocked';
        if (decision === 'send') state = 'processing';
        return Response.json({ decision, delivery_id: 'delivery', claim_token: 'token', idempotency_key: 'stable-key',
          email_send_id: state === 'sent' ? 'email-ledger' : null, status: state });
      }
      if (url.pathname.endsWith('/finalize_automation_email_delivery')) { state = payload.p_status; return Response.json(null); }
      if (url.pathname.endsWith('/email_sends')) return Response.json({ id: 'email-ledger' });
      throw new Error('Unexpected request');
    },
  } });
  return { db, state: () => state };
}
const input = { organizationId: 'org', runId: 'run', nodeId: 'proposal-node', recipientEmail: 'a@example.test',
  recipientName: 'Ana', subject: 'Proposta', templateId: 'template' };
test('lost proposal provider response stays uncertain and replay never sends again', async () => {
  const f = fixture();
  let calls = 0;
  const provider = async () => { calls++; throw new DOMException('Response lost after acceptance', 'TimeoutError'); };
  const first = await deliverProposalAutomationEmail(f.db, input, provider);
  const second = await deliverProposalAutomationEmail(f.db, input, provider);
  assert.equal(first.status, 'uncertain');
  assert.equal(second.retryable, false);
  assert.equal(f.state(), 'uncertain');
  assert.equal(calls, 1);
});
test('confirmed proposal send replay returns ledger without another provider call', async () => {
  const f = fixture();
  let calls = 0;
  const provider = async (key: string) => { calls++; assert.equal(key, 'stable-key'); return { status: 201, messageId: 'brevo-id' }; };
  assert.equal((await deliverProposalAutomationEmail(f.db, input, provider)).status, 'sent');
  assert.equal((await deliverProposalAutomationEmail(f.db, input, provider)).email_send_id, 'email-ledger');
  assert.equal(calls, 1);
});
