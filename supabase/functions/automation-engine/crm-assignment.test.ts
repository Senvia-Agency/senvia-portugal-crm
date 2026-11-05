import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { executeCrmAction } from './crm-actions.ts';
const run = { id: 'run', flow_id: 'flow', organization_id: 'org', subject_type: 'lead', subject_id: 'lead',
  contact_name: null, contact_email: null, contact_phone: null, context: { source: 'form' } };
function fixture(members: readonly { organization_id: string; user_id: string; is_active: boolean }[], functionStatus = 200) {
  let updates = 0;
  const db = createClient('https://assignment.test', 'service-key', { auth: { persistSession: false }, global: {
    fetch: async (request, init) => {
      const url = new URL(typeof request === 'string' ? request : request instanceof URL ? request.href : request.url);
      if (url.pathname.endsWith('/organization_members')) {
        const member = members.find(row => Object.entries(row).every(([key, value]) =>
          !url.searchParams.has(key) || url.searchParams.get(key) === `eq.${String(value)}`));
        return Response.json(member ? { user_id: member.user_id } : null);
      }
      if (url.pathname.endsWith('/leads') || url.pathname.endsWith('/crm_clients')) {
        assert.equal(init?.method, 'PATCH');
        assert.equal(url.searchParams.get('organization_id'), 'eq.org');
        assert.equal(url.searchParams.get('id'), 'eq.lead');
        updates++;
        return Response.json({ id: 'lead' });
      }
      if (url.pathname.endsWith('/send-push-notification')) return Response.json({ success: false }, { status: functionStatus });
      throw new Error(`Unexpected request ${url.pathname}`);
    },
  } });
  return { db, updates: () => updates };
}
test('fixed assignment refuses a foreign organization member before updating the record', async () => {
  const f = fixture([{ organization_id: 'foreign', user_id: 'user', is_active: true }]);
  const result = await executeCrmAction(f.db, { type: 'assign_user', run, vars: {}, config: { user_id: 'user' } });
  assert.equal(result?.kind, 'fail');
  assert.equal(f.updates(), 0);
});
test('fixed assignment refuses an inactive organization member before updating the record', async () => {
  const f = fixture([{ organization_id: 'org', user_id: 'user', is_active: false }]);
  const result = await executeCrmAction(f.db, { type: 'assign_user', run, vars: {}, config: { assignment_mode: 'fixed', user_id: 'user' } });
  assert.equal(result?.kind, 'fail');
  assert.equal(f.updates(), 0);
});
test('legacy fixed configuration assigns an active member and updates context', async () => {
  const f = fixture([{ organization_id: 'org', user_id: 'user', is_active: true }]);
  const result = await executeCrmAction(f.db, { type: 'assign_user', run, vars: {}, config: { user_id: 'user' } });
  assert.deepEqual(result, { kind: 'next', detail: { atribuido_a: 'user', modo: 'fixed' }, context: { source: 'form', assigned_to: 'user' } });
  assert.equal(f.updates(), 1);
});
test('notification retains FunctionsHttpError status for retry classification', async () => {
  const f = fixture([{ organization_id: 'org', user_id: 'user', is_active: true }], 503);
  const result = await executeCrmAction(f.db, { type: 'notify_user', run, vars: {}, config: { user_id: 'user', title: 'Alerta' } });
  assert.equal(result?.kind, 'fail');
  if (result?.kind === 'fail') assert.match(result.error, /HTTP 503/);
});
