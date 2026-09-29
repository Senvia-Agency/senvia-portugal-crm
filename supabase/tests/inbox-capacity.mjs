import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';

const requireFromHere = createRequire(import.meta.url);
const orgA = '10000000-0000-4000-8000-000000000001';
const orgB = '10000000-0000-4000-8000-000000000002';
const userA = '20000000-0000-4000-8000-000000000001';
const outsider = '20000000-0000-4000-8000-000000000002';
const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

async function legacyDatabase() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    CREATE TABLE public.subscription_plans (
      id text PRIMARY KEY, name text NOT NULL, max_users integer, max_forms integer,
      price_monthly numeric NOT NULL DEFAULT 49, features jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO public.subscription_plans(id, name) VALUES
      ('basic','SENVIA OS'),('starter','SENVIA OS'),('pro','SENVIA OS'),('elite','SENVIA OS'),
      ('custom-unlimited','Custom');
    CREATE TABLE public.organizations (
      id uuid PRIMARY KEY, plan text DEFAULT 'starter', billing_exempt boolean DEFAULT false
    );
    CREATE TABLE public.organization_members (
      user_id uuid, organization_id uuid, is_active boolean DEFAULT true
    );
    CREATE FUNCTION public.is_org_member(_user uuid, _org uuid) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER SET search_path=public
      AS $$SELECT EXISTS(SELECT 1 FROM organization_members
        WHERE user_id=_user AND organization_id=_org AND is_active)$$;
    CREATE TABLE public.messaging_channels (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
      channel_type text NOT NULL, provider text NOT NULL, status text NOT NULL DEFAULT 'disconnected',
      archived_at timestamptz
    );
    CREATE TABLE public.inbox_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), channel_id uuid REFERENCES messaging_channels(id) ON DELETE CASCADE,
      body text NOT NULL
    );
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
  `);
  await db.exec(await source('../migrations/20260618120000_inbox_plan_limits.sql'));
  await db.exec("UPDATE subscription_plans SET max_inboxes=NULL WHERE id IN ('basic','starter','pro','elite','custom-unlimited')");
  return db;
}

async function capacityDatabase() {
  const db = await legacyDatabase();
  await db.exec(await source('../migrations/20260914100000_messaging_inbox_capacity.sql'));
  return db;
}

async function addOrganization(db, id, { plan = 'starter', override = null, exempt = false } = {}) {
  await db.query('INSERT INTO organizations(id,plan,max_inboxes_override,billing_exempt) VALUES($1,$2,$3,$4)', [id, plan, override, exempt]);
}

async function addChannel(db, organizationId, type, status = 'connected', archivedAt = null) {
  return (await db.query(
    "INSERT INTO messaging_channels(organization_id,channel_type,provider,status,archived_at) VALUES($1,$2,'fixture',$3,$4) RETURNING id",
    [organizationId, type, status, archivedAt],
  )).rows[0].id;
}

async function asUser(db, userId, action) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.exec('SET ROLE authenticated');
  try { return await action(); } finally { await db.exec('RESET ROLE'); }
}

async function inboxCapacity(db, organizationId, userId = userA) {
  return asUser(db, userId, async () =>
    (await db.query('SELECT public.get_inbox_capacity($1) AS value', [organizationId])).rows[0].value);
}

async function rejectsCapacity(promise) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, '23514');
    assert.match(error.message, /INBOX_LIMIT_REACHED/);
    return true;
  });
}

test('baseline: the previous insert-only trigger permits an over-cap unarchive', async () => {
  const db = await legacyDatabase();
  try {
    // Given two active rows and one archived row created while the plan was unlimited.
    await addOrganization(db, orgA);
    await addChannel(db, orgA, 'email');
    await addChannel(db, orgA, 'whatsapp');
    const archived = await addChannel(db, orgA, 'instagram', 'disconnected', '2026-09-01T00:00:00Z');
    await db.query('UPDATE organizations SET max_inboxes_override=2 WHERE id=$1', [orgA]);
    // When the archived row is restored, then the legacy trigger does not run.
    await db.query('UPDATE messaging_channels SET archived_at=NULL WHERE id=$1', [archived]);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM messaging_channels WHERE archived_at IS NULL')).rows[0].n), 3);
  } finally { await db.close(); }
});

test('four mixed configured rows are accepted and a fifth is rejected', async () => {
  const db = await capacityDatabase();
  try {
    // Given four nonarchived rows with different channel and connection states.
    await addOrganization(db, orgA);
    await db.query('INSERT INTO organization_members(user_id,organization_id) VALUES($1,$2)', [userA, orgA]);
    await addChannel(db, orgA, 'email', 'connected');
    await addChannel(db, orgA, 'whatsapp', 'disconnected');
    await addChannel(db, orgA, 'instagram', 'error');
    await addChannel(db, orgA, 'facebook', 'connecting');
    // When a fifth hidden/legacy type is configured, then the DB rejects it and reports 4/4.
    await rejectsCapacity(addChannel(db, orgA, 'legacy-hidden'));
    assert.deepEqual(await inboxCapacity(db, orgA), { used: 4, limit: 4, remaining: 0, can_create: false });
  } finally { await db.close(); }
});

test('archiving preserves history and restoration requires free capacity', async () => {
  const db = await capacityDatabase();
  try {
    // Given a full organization and history attached to one channel.
    await addOrganization(db, orgA);
    const archived = await addChannel(db, orgA, 'email');
    for (const type of ['whatsapp', 'instagram', 'facebook']) await addChannel(db, orgA, type);
    await db.query("INSERT INTO inbox_history(channel_id,body) VALUES($1,'preserved')", [archived]);
    // When it is archived, then capacity is released without deleting history.
    await db.query('UPDATE messaging_channels SET archived_at=now(),status=$2 WHERE id=$1', [archived, 'disconnected']);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM inbox_history WHERE channel_id=$1', [archived])).rows[0].n), 1);
    const replacement = await addChannel(db, orgA, 'legacy-hidden');
    // When the old row is restored while full, then it is rejected; after another archive it succeeds.
    await rejectsCapacity(db.query('UPDATE messaging_channels SET archived_at=NULL WHERE id=$1', [archived]));
    await db.query('UPDATE messaging_channels SET archived_at=now() WHERE id=$1', [replacement]);
    await db.query('UPDATE messaging_channels SET archived_at=NULL WHERE id=$1', [archived]);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM messaging_channels WHERE archived_at IS NULL')).rows[0].n), 4);
  } finally { await db.close(); }
});

test('an active organization move cannot bypass a full destination', async () => {
  const db = await capacityDatabase();
  try {
    // Given a source row and a destination at 4/4.
    await addOrganization(db, orgA); await addOrganization(db, orgB);
    const moving = await addChannel(db, orgA, 'email');
    const destination = [];
    for (const type of ['email', 'whatsapp', 'instagram', 'facebook']) destination.push(await addChannel(db, orgB, type));
    // When the row is moved, then the destination rejects it and the source remains unchanged.
    await rejectsCapacity(db.query('UPDATE messaging_channels SET organization_id=$1 WHERE id=$2', [orgB, moving]));
    assert.equal((await db.query('SELECT organization_id FROM messaging_channels WHERE id=$1', [moving])).rows[0].organization_id, orgA);
    await db.query('UPDATE messaging_channels SET archived_at=now() WHERE id=$1', [destination[0]]);
    await db.query('UPDATE messaging_channels SET organization_id=$1 WHERE id=$2', [orgB, moving]);
  } finally { await db.close(); }
});

test('overrides, billing exemption, custom unlimited plans and grandfathered rows keep their contracts', async () => {
  const db = await legacyDatabase();
  try {
    // Given five rows that predate the four-box migration.
    await addOrganization(db, orgA); await db.query('INSERT INTO organization_members VALUES($1,$2,true)', [userA, orgA]);
    for (let index = 0; index < 5; index += 1) await addChannel(db, orgA, `legacy-${index}`);
    // When the migration lands, then rows remain and neutral updates work, while growth is blocked.
    await db.exec(await source('../migrations/20260914100000_messaging_inbox_capacity.sql'));
    await db.query("UPDATE messaging_channels SET status='connected' WHERE organization_id=$1", [orgA]);
    await rejectsCapacity(addChannel(db, orgA, 'sixth'));
    assert.deepEqual(await inboxCapacity(db, orgA), { used: 5, limit: 4, remaining: 0, can_create: false });
    // Given explicit finite and unlimited contracts, then each remains authoritative.
    await addOrganization(db, orgB, { override: 6 });
    for (let index = 0; index < 6; index += 1) await addChannel(db, orgB, `override-${index}`);
    await rejectsCapacity(addChannel(db, orgB, 'override-seventh'));
    const exemptOrg = '10000000-0000-4000-8000-000000000003';
    const customOrg = '10000000-0000-4000-8000-000000000004';
    await addOrganization(db, exemptOrg, { exempt: true });
    await addOrganization(db, customOrg, { plan: 'custom-unlimited' });
    for (let index = 0; index < 6; index += 1) { await addChannel(db, exemptOrg, `e-${index}`); await addChannel(db, customOrg, `c-${index}`); }
  } finally { await db.close(); }
});

test('concurrent creation attempts leave exactly four active rows', async () => {
  const db = await capacityDatabase();
  try {
    // Given 3/4 used, when two callers race, then only one reservation succeeds.
    await addOrganization(db, orgA);
    for (const type of ['email', 'whatsapp', 'instagram']) await addChannel(db, orgA, type);
    const results = await Promise.allSettled([addChannel(db, orgA, 'facebook'), addChannel(db, orgA, 'legacy-hidden')]);
    assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM messaging_channels WHERE archived_at IS NULL')).rows[0].n), 4);
  } finally { await db.close(); }
});

test('capacity RPC is member-only and unsafe grants are revoked', async () => {
  const db = await capacityDatabase();
  try {
    // Given one organization member, when an outsider calls the RPC, then PostgreSQL denies it.
    await addOrganization(db, orgA); await db.query('INSERT INTO organization_members VALUES($1,$2,true)', [userA, orgA]);
    await assert.rejects(inboxCapacity(db, orgA, outsider), (error) => error.code === '42501');
    const privileges = (await db.query(`SELECT
      has_function_privilege('authenticated','public.get_inbox_capacity(uuid)','EXECUTE') AS member,
      has_function_privilege('anon','public.get_inbox_capacity(uuid)','EXECUTE') AS anonymous,
      has_function_privilege('authenticated','public.enforce_inbox_limit()','EXECUTE') AS direct_trigger`)).rows[0];
    assert.deepEqual(privileges, { member: true, anonymous: false, direct_trigger: false });
  } finally { await db.close(); }
});

function evaluateTypeScript(code, requireModule, globals = {}) {
  const exports = {};
  const compatibleCode = code.replace(/import\.meta\.env\.[A-Z0-9_]+/g, "''");
  const compiled = ts.transpileModule(compatibleCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports, module: { exports }, require: requireModule, console, Request, Response, ...globals });
  return exports;
}

test('subscription and capacity hooks expose four-box WhatsApp entitlement without permissive loading fallback', async () => {
  // Given the fallback plan, when subscription state is consumed, then WhatsApp and four inboxes are available.
  const planConfig = evaluateTypeScript(await source('../../src/lib/plan-config.ts'), requireFromHere);
  const subscription = evaluateTypeScript(await source('../../src/hooks/useSubscription.ts'), (id) => {
    if (id === '@tanstack/react-query') return { useQuery: () => ({ data: undefined, isLoading: false }) };
    if (id === '@/integrations/supabase/client') return { supabase: {} };
    if (id === '@/contexts/AuthContext') return { useAuth: () => ({ organization: { id: orgA, plan: 'starter' } }) };
    if (id === '@/lib/plan-config') return planConfig;
    throw new Error(`Unexpected module: ${id}`);
  });
  const state = subscription.useSubscription();
  assert.equal(state.limits.maxInboxes, 4);
  assert.equal(state.canUseIntegration('whatsapp'), true);

  // Given an authoritative RPC result, when the capacity hook runs, then it maps snake_case and returns React Query state unchanged.
  let options;
  const queryState = { data: undefined, isLoading: true, error: null };
  const hook = evaluateTypeScript(await source('../../src/hooks/useInboxCapacity.ts'), (id) => {
    if (id === '@tanstack/react-query') return { useQuery: (value) => { options = value; return queryState; } };
    if (id === '@/integrations/supabase/client') return { supabase: { rpc: async () => ({ data: { used: 5, limit: 4, remaining: 0, can_create: false }, error: null }) } };
    if (id === '@/contexts/AuthContext') return { useAuth: () => ({ organization: { id: orgA } }) };
    if (id === 'zod') return requireFromHere('zod');
    throw new Error(`Unexpected module: ${id}`);
  });
  assert.deepEqual(Array.from(hook.inboxCapacityQueryKey(orgA)), ['inbox-capacity', orgA]);
  assert.equal(hook.useInboxCapacity(), queryState);
  assert.deepEqual(JSON.parse(JSON.stringify(await options.queryFn())), { used: 5, limit: 4, remaining: 0, canCreate: false, overLimit: true });
});

async function invokeEmailInbox(body, insertError = null) {
  let handler; const updates = []; let deletes = 0;
  const admin = { from(table) {
    let operation = 'select';
    const query = {
      select() { return query; }, eq() { return query; }, filter() { return query; },
      insert() { operation = 'insert'; return query; }, update(value) { operation = 'update'; updates.push(value); return query; },
      delete() { operation = 'delete'; deletes += 1; return query; },
      async maybeSingle() { return { data: body.action === 'delete' ? { id: 'channel-email' } : null, error: null }; },
      async single() { return table === 'organizations' ? { data: { id: orgA, name: 'Org' }, error: null } : { data: null, error: operation === 'insert' ? insertError : null }; },
      then(resolve, reject) { return Promise.resolve({ data: null, error: null }).then(resolve, reject); },
    };
    return query;
  } };
  evaluateTypeScript(await source('../functions/email-inbox/index.ts'), (id) => {
    if (id.endsWith('_shared/multicanal.ts')) return {
      corsHeaders: {}, getConfig: () => ({}), authOrgAdmin: async () => ({ admin }),
      json: (value, status = 200) => new Response(JSON.stringify(value), { status }),
    };
    throw new Error(`Unexpected module: ${id}`);
  }, { Deno: { serve: (value) => { handler = value; } } });
  const response = await handler(new Request('https://example.invalid', { method: 'POST', body: JSON.stringify({ organization_id: orgA, ...body }) }));
  return { response, body: await response.json(), updates, deletes };
}

test('email endpoint maps quota rejection to 409 and archives instead of deleting history', async () => {
  // Given a database capacity error, when email creation runs, then the HTTP contract returns conflict.
  const valid = { action: 'create', label: 'Geral', email_config: { email_address: 'a@example.test', imap_server: 'imap.test', smtp_server: 'smtp.test', imap_password: 'secret', smtp_password: 'secret' } };
  const limited = await invokeEmailInbox(valid, { code: '23514', message: 'INBOX_LIMIT_REACHED: 4/4' });
  assert.equal(limited.response.status, 409);
  assert.match(limited.body.error, /limite/i);
  // Given an existing email box, when delete is requested, then the row is archived and never deleted.
  const archived = await invokeEmailInbox({ action: 'delete', channel_id: 'channel-email' });
  assert.equal(archived.response.status, 200);
  assert.equal(archived.deletes, 0);
  assert.equal(archived.updates[0].status, 'disconnected');
  assert.ok(Date.parse(archived.updates[0].archived_at));
});

test('gateway excludes archived mailboxes from sync, direct lookup and command execution', async () => {
  const db = new PGlite();
  try {
    // Given active and archived email rows, when the gateway loads mailboxes, then only the active row can sync.
    await db.exec(`CREATE TABLE messaging_channels(id text,organization_id text,channel_type text,label text,metadata jsonb,assigned_user_ids text[],archived_at timestamptz);
      CREATE TABLE messaging_channel_secrets(channel_id text,imap_password text,smtp_password text);
      CREATE TABLE organization_members(organization_id text,user_id text,is_active boolean,role text,profile_id text);
      CREATE TABLE organization_profiles(id text,organization_id text,base_role text);
      INSERT INTO messaging_channels VALUES
        ('active','org-a','email','Active','{"imap_server":"imap.test"}',ARRAY[]::text[],NULL),
        ('archived','org-a','email','Archived','{"imap_server":"imap.test"}',ARRAY[]::text[],now());
      INSERT INTO messaging_channel_secrets VALUES('active','secret','secret'),('archived','secret','secret');
      INSERT INTO organization_members VALUES('org-a','actor',true,'admin',NULL);`);
    const q = async (sql, params) => (await db.query(sql, params)).rows;
    const caixaCode = (await readFile(new URL('../../email-gateway/src/caixas.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
    const caixaBox = vm.createContext({ q, console, nodemailer: {}, mailEndpoint: async () => ({}) });
    vm.runInContext(`${caixaCode}\nglobalThis.caixaApi={getEmailCaixas,getEmailCaixa};`, caixaBox);
    assert.deepEqual((await caixaBox.caixaApi.getEmailCaixas()).map(({ id }) => id), ['active']);
    assert.equal(await caixaBox.caixaApi.getEmailCaixa('archived'), null);
    // When a stale caller supplies an archived mailbox, then the command authorization still rejects it.
    const commandCode = (await readFile(new URL('../../email-gateway/src/commands.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
    const commandBox = vm.createContext({ q, console, Buffer, Date, setInterval,
      getEmailCaixa: async () => ({ id: 'archived', organization_id: 'org-a' }), getManager: () => ({ client: { usable: true } }) });
    vm.runInContext(`${commandCode}\nglobalThis.executeCommand=execute;`, commandBox);
    await assert.rejects(commandBox.executeCommand({ created_by: 'actor', channel_id: 'archived', organization_id: 'org-a', type: 'fixture' }), /não autorizado/);
  } finally { await db.close(); }
});
