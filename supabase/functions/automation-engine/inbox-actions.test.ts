import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { executeInboxAction, templatePayload } from './inbox-actions.ts';

const run = { id: 'run', flow_id: 'flow', organization_id: 'org', subject_type: 'contact', subject_id: 'conv',
  contact_name: 'Ana', contact_email: null, contact_phone: '351912345678', context: {} };
function fixture(options: { conversation?: boolean; member?: boolean; provider?: string; approved?: boolean; suppressed?: boolean; finalizeFail?: boolean; historyFailOnce?: boolean } = {}) {
  const writes: Array<{ table: string; body: unknown }> = [];
  const requests: URL[] = [];
  let deliveryState = "new";
  let messageId: string | null = null;
  let historyStored = false;
  let historyFailures = 0;
  const db = createClient('https://db.example.test', 'test-service-key', { auth: { persistSession: false }, global: { fetch: async (request, init) => {
    const url = new URL(String(request)); requests.push(url);
    const table = url.pathname.split('/').pop() ?? '';
    if (url.pathname.includes('/rpc/')) {
      const rpc = url.pathname.split('/').pop();
      if (rpc === 'automation_contact_is_suppressed') return Response.json(options.suppressed ?? false);
      if (rpc === 'claim_automation_meta_delivery') {
        const decision = deliveryState === 'new' || deliveryState === 'retryable' ? 'send' : deliveryState === 'sent' ? 'sent' : 'blocked';
        if (decision === 'send') deliveryState = 'processing';
        return Response.json({ decision, id:'delivery',claim_token:'token',status:deliveryState,
          provider_message_id:messageId,sent_at:messageId?'2026-11-04T10:00:00Z':null });
      }
      if (rpc === 'settle_automation_meta_delivery') {
        if (options.finalizeFail) return Response.json({message:'database unavailable'},{status:500});
        const args = JSON.parse(String(init?.body));
        if (deliveryState !== 'sent') { deliveryState = args.p_status; messageId = args.p_message_id; }
        return Response.json({sent_at:messageId?'2026-11-04T10:00:00Z':null});
      }
      throw new Error('Unexpected RPC');
    }
    if ((init?.method ?? 'GET') !== 'GET') {
      if (table === 'meta_messages' && options.historyFailOnce && historyFailures++ === 0) return Response.json({message:'history unavailable'},{status:500});
      if (table === 'meta_messages') historyStored = true;
      writes.push({ table, body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 204 });
    }
    const rows: Record<string, unknown[]> = {
      meta_messages: historyStored ? [{ id:'history' }] : [],
      meta_conversations: options.conversation === false ? [] : [{ id: 'conv', channel_id: 'channel', organization_id: 'org', contact_ref: '351912345678' }],
      messaging_channels: [{ id: 'channel', channel_type: 'whatsapp', provider: options.provider ?? 'meta', metadata: { phone_number_id: '123' }, archived_at: null }],
      organization_members: options.member === false ? [] : [{ user_id: 'agent' }],
      whatsapp_templates: options.approved === false ? [] : [{ id: 'template' }],
      messaging_channel_secrets: [{ page_access_token: 'private-test-token' }],
    };
    return new Response(JSON.stringify(rows[table] ?? []), { headers: { 'Content-Type': 'application/json' } });
  } } });
  return { db, writes, requests };
}

test('template renders text parameters and rejects arbitrary components', () => {
  const result = templatePayload({ template_name: 'welcome', language: 'pt_PT', components: [{ type: 'body', parameters: ['Olá {{nome}}'] }] }, '3519', { nome: 'Ana' });
  assert.deepEqual(result.template.components, [{ type: 'body', parameters: [{ type: 'text', text: 'Olá Ana' }] }]);
  assert.throws(() => templatePayload({ template_name: 'welcome', language: 'pt_PT', components: [{ type: 'button', parameters: [] }] }, '3519', {}));
});

test('conversation assignment validates active member and scopes reads and writes to organization', async () => {
  const { db, writes, requests } = fixture();
  const result = await executeInboxAction(db, { type: 'assign_conversation', config: { user_id: 'agent' }, run, vars: {} });
  assert.equal(result?.kind, 'next');
  assert.deepEqual(writes, [{ table: 'meta_conversations', body: { assigned_to: 'agent' } }]);
  assert.ok(requests.every(url => url.searchParams.get('organization_id') === 'eq.org'));
});

test('foreign conversation or inactive member cannot change conversation', async () => {
  for (const options of [{ conversation: false }, { member: false }]) {
    const { db, writes } = fixture(options);
    const result = await executeInboxAction(db, { type: 'assign_conversation', config: { user_id: 'agent' }, run, vars: {} });
    assert.equal(result?.kind, 'fail'); assert.equal(writes.length, 0);
  }
});

test('only approved official WhatsApp templates reach Meta and are stored', async () => {
  const { db, writes } = fixture();
  let sends = 0;
  const result = await executeInboxAction(db, { type: 'send_meta_template', node_id:'template-visit', config: { template_name: 'welcome', language: 'pt_PT' }, run, vars: {} }, async (url, init) => {
    sends++; assert.equal(url, 'https://graph.facebook.com/v21.0/123/messages');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private-test-token');
    assert.equal(JSON.parse(String(init?.body)).type, 'template');
    return Response.json({ messages: [{ id: 'wamid.test' }] });
  });
  assert.equal(result?.kind, 'next'); assert.equal(sends, 1);
  assert.equal(writes[0].table, 'meta_messages');
});

test('QR channels and unapproved models cannot send', async () => {
  for (const options of [{ provider: 'evolution' }, { approved: false }]) {
    const { db } = fixture(options);
    const result = await executeInboxAction(db, { type: 'send_meta_template', node_id:'template-visit', config: { template_name: 'welcome', language: 'pt_PT' }, run, vars: {} }, async () => { throw new Error('must not send'); });
    assert.equal(result?.kind, 'fail');
  }
});

test('close conversation changes only supported closed status', async () => {
  const { db, writes } = fixture();
  const result = await executeInboxAction(db, { type: 'close_conversation', config: {}, run, vars: {} });
  assert.equal(result?.kind, 'next'); assert.deepEqual(writes[0].body, { status: 'closed' });
});


test('suppressed contact never reaches Meta', async () => {
  const { db } = fixture({ suppressed: true });
  const result = await executeInboxAction(db, { type: 'send_meta_template', node_id:'template-visit', config: { template_name: 'welcome', language: 'pt_PT' }, run, vars: {} }, async () => { throw new Error('must not send'); });
  assert.equal(result?.kind, 'fail');
});
const templateInput = { type:'send_meta_template',node_id:'template-visit',config:{template_name:'welcome',language:'pt_PT'},run,vars:{} };

test('concurrent official template executions make one Graph request',async()=>{
  const f=fixture();let graphCalls=0;
  const transport:typeof fetch=async()=>{graphCalls++;return Response.json({messages:[{id:'wamid.concurrent'}]});};
  const outcomes=await Promise.all([executeInboxAction(f.db,templateInput,transport),executeInboxAction(f.db,templateInput,transport)]);
  assert.equal(graphCalls,1);
  assert.ok(outcomes.some(outcome=>outcome?.kind==='next'));
});
test('sent template replay repairs history without calling Graph again',async()=>{
  const f=fixture({historyFailOnce:true});let graphCalls=0;
  const transport:typeof fetch=async()=>{graphCalls++;return Response.json({messages:[{id:'wamid.repair'}]});};
  assert.equal((await executeInboxAction(f.db,templateInput,transport))?.kind,'fail');
  assert.equal((await executeInboxAction(f.db,templateInput,transport))?.kind,'next');
  assert.equal(graphCalls,1);
  assert.equal(f.writes.filter(write=>write.table==='meta_messages').length,1);
});
test('confirmed template replay does not duplicate the message history',async()=>{
  const f=fixture();let graphCalls=0;
  const transport:typeof fetch=async()=>{graphCalls++;return Response.json({messages:[{id:'wamid.sent'}]});};
  await executeInboxAction(f.db,templateInput,transport);
  await executeInboxAction(f.db,templateInput,transport);
  assert.equal(graphCalls,1);
  assert.equal(f.writes.filter(write=>write.table==='meta_messages').length,1);
});
test('lost Graph response is uncertain and cannot automatically resend',async()=>{
  const f=fixture();let graphCalls=0;
  const transport:typeof fetch=async()=>{graphCalls++;throw new DOMException('Timed out after acceptance','TimeoutError');};
  const first=await executeInboxAction(f.db,templateInput,transport);
  const second=await executeInboxAction(f.db,templateInput,transport);
  assert.equal(first?.kind,'fail');assert.equal(second?.kind,'fail');
  assert.equal(graphCalls,1);
  assert.equal(f.writes.length,0);
});
test('failure to persist provider acceptance requires review and blocks resend',async()=>{
  const f=fixture({finalizeFail:true});let graphCalls=0;
  const transport:typeof fetch=async()=>{graphCalls++;return Response.json({messages:[{id:'wamid.accepted'}]});};
  assert.equal((await executeInboxAction(f.db,templateInput,transport))?.kind,'fail');
  assert.equal((await executeInboxAction(f.db,templateInput,transport))?.kind,'fail');
  assert.equal(graphCalls,1);
  assert.equal(f.writes.length,0);
});
test('explicit Graph HTTP 503 allows retry using the same durable visit',async()=>{
  const f=fixture();let graphCalls=0;
  const transport:typeof fetch=async()=>{graphCalls++;return graphCalls===1?new Response('unavailable',{status:503}):Response.json({messages:[{id:'wamid.retry'}]});};
  assert.equal((await executeInboxAction(f.db,templateInput,transport))?.kind,'fail');
  assert.equal((await executeInboxAction(f.db,templateInput,transport))?.kind,'next');
  assert.equal(graphCalls,2);
});
