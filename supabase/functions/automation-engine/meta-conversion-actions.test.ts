import assert from 'node:assert/strict';
import test from 'node:test';
import { conversionEvent, conversionEventId, InvalidMetaConversion } from './meta-conversion-actions.ts';
const run = { id: 'r', flow_id: 'flow', organization_id: 'org', subject_type: 'lead', subject_id: 'lead', contact_name: null, contact_email: 'a@example.test', contact_phone: null, context: {} };
test('conversion event names are bounded and arbitrary custom events rejected', () => {
  assert.equal(conversionEvent({ event_name: 'Lead' }), 'Lead');
  assert.throws(() => conversionEvent({ event_name: 'FakePurchase' }), InvalidMetaConversion);
});
test('event identifier is stable across retries and contains no contact data', async () => {
  const input = { type: 'meta_conversion', config: { event_name: 'Lead', __node_id: 'node' }, run, vars: {} };
  const first = await conversionEventId(input);
  assert.equal(first, await conversionEventId(input));
  assert.notEqual(first, await conversionEventId({ ...input, run: { ...run, id: 'another-run' } }));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, await conversionEventId({ ...input, config: { ...input.config, __node_id: 'another-node' } }));
});
test('Purchase shares authoritative sale identifier and rejects a lead subject', async () => {
  const input = { type: 'meta_conversion', config: { event_name: 'Purchase' }, run, vars: {} };
  await assert.rejects(conversionEventId(input), InvalidMetaConversion);
  assert.equal(await conversionEventId({ ...input, run: { ...run, subject_type: 'sale', subject_id: 'sale' } }), 'sale');
});

test('server action uses tenant token directly and skips already sent events', async t => {
  const { createClient } = await import('@supabase/supabase-js');
  const { executeMetaConversionAction } = await import('./meta-conversion-actions.ts');
  let claimed = true;
  let graphCalls = 0;
  const fakeFetch: typeof fetch = async (request, options) => {
    const url = String(request);
    if (url.includes('/organizations?')) return new Response(JSON.stringify({ meta_pixels: [{ pixel_id: 'tenant-pixel', enabled: true }], meta_conversions_api_token: 'tenant-secret' }));
    if (url.includes('/rpc/claim_automation_meta_event')) return new Response(JSON.stringify(claimed));
    if (url.includes('/automation_meta_events?')) return new Response(JSON.stringify(options?.method === 'PATCH' ? null : { status: 'sent' }));
    if (url.startsWith('https://graph.facebook.com/')) {
      graphCalls++;
      assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer tenant-secret');
      assert.equal(url.includes('access_token'), false);
      const body = JSON.parse(String(options?.body));
      assert.equal(body.data[0].event_name, 'Lead');
      assert.match(body.data[0].user_data.em[0], /^[a-f0-9]{64}$/);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('351912345678'));
      const expectedPhone = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
      assert.equal(body.data[0].user_data.ph[0], expectedPhone);
      return new Response(JSON.stringify({ events_received: 1 }));
    }
    throw new Error('Unexpected network boundary');
  };
  t.mock.method(globalThis, 'fetch', fakeFetch);
  const db = createClient('https://db.example.test', 'test-key', { global: { fetch: fakeFetch } });
  const input = { type: 'meta_conversion', config: { event_name: 'Lead', __node_id: 'node', pixel_id: 'tenant-pixel' }, run: { ...run, contact_phone: '+351 912-345-678' }, vars: {} };
  assert.equal((await executeMetaConversionAction(db, input))?.kind, 'next');
  claimed = false;
  assert.equal((await executeMetaConversionAction(db, input))?.kind, 'next');
  assert.equal(graphCalls, 1);
});

test('disabled tenant pixel and unpaid Purchase fail before Graph delivery', async t => {
  const { createClient } = await import('@supabase/supabase-js');
  const { executeMetaConversionAction } = await import('./meta-conversion-actions.ts');
  let enabled = false;
  let graphCalls = 0;
  const fakeFetch: typeof fetch = async (request) => {
    const url = String(request);
    if (url.includes('/organizations?')) return new Response(JSON.stringify({ meta_pixels: [{ pixel_id: 'tenant-pixel', enabled }], meta_conversions_api_token: 'tenant-secret' }));
    if (url.includes('/sales?')) return new Response(JSON.stringify({ id: 'sale', total_value: 120, payment_status: 'pending', status: 'pending' }));
    graphCalls++;
    throw new Error('Unexpected delivery before authorization');
  };
  t.mock.method(globalThis, 'fetch', fakeFetch);
  const db = createClient('https://db.example.test', 'test-key', { global: { fetch: fakeFetch } });
  const input = { type: 'meta_conversion', config: { event_name: 'Purchase', __node_id: 'node', pixel_id: 'tenant-pixel' }, run: { ...run, subject_type: 'sale', subject_id: 'sale' }, vars: {} };
  assert.equal((await executeMetaConversionAction(db, input))?.kind, 'fail');
  enabled = true;
  assert.equal((await executeMetaConversionAction(db, input))?.kind, 'fail');
  assert.equal(graphCalls, 0);
});
