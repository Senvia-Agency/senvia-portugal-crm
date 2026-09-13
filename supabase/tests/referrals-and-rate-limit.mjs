// Runs against an isolated embedded PostgreSQL only. Never connects to Supabase.
// Install @electric-sql/pglite in a temporary directory and set PGLITE_MODULE to its index.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  CREATE TABLE auth.users(id uuid PRIMARY KEY, created_at timestamptz DEFAULT now(), raw_user_meta_data jsonb);
  CREATE TABLE organizations(id uuid PRIMARY KEY, name text, slug text, created_at timestamptz DEFAULT now(), first_paid_at timestamptz, billing_exempt boolean DEFAULT false, payment_failed_at timestamptz, current_period_end timestamptz);
  CREATE TABLE organization_members(user_id uuid, organization_id uuid, role text, is_active boolean DEFAULT true);
  CREATE TABLE rate_limit_hits(bucket text PRIMARY KEY, hits integer DEFAULT 0, window_start timestamptz DEFAULT now());
  CREATE TABLE email_commands(id uuid DEFAULT gen_random_uuid(), type text, created_by uuid);
  CREATE FUNCTION is_org_member(u uuid,o uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$SELECT EXISTS(SELECT 1 FROM organization_members WHERE user_id=u AND organization_id=o AND is_active)$$;
  CREATE FUNCTION is_org_admin(u uuid,o uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$SELECT EXISTS(SELECT 1 FROM organization_members WHERE user_id=u AND organization_id=o AND is_active AND role='admin')$$;
  GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
`);
for (const name of ['20260912090000_referral_program.sql', '20260912091000_user_action_rate_limit.sql', '20260913100000_referral_billing.sql', '20260913110000_referral_audit.sql']) {
  await db.exec(await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'));
}
const ids = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12,'0')}`);
const [org, referred, user, secondOrg, secondUser] = ids;
await db.query('INSERT INTO organizations(id,name,slug) VALUES ($1,$2,$3),($4,$5,$6),($7,$8,$9)', [org,'Origin','origin',referred,'Invited','invited',secondOrg,'Other','other']);
await db.query('INSERT INTO organization_members VALUES ($1,$2,$3,true)', [user,org,'admin']);
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);
const dashboard = (await db.query('SELECT get_referral_dashboard($1) AS d',[org])).rows[0].d;
await db.query('INSERT INTO auth.users(id,raw_user_meta_data) VALUES ($1,$2)', [secondUser, { referral_code: dashboard.code, organization_slug:'invited' }]);
await db.query('INSERT INTO organization_members VALUES ($1,$2,$3,true)',[secondUser,referred,'admin']);

test('signup attribution and first positive payment earn one month despite webhook replays', async () => {
  assert.equal((await db.query('SELECT * FROM organization_referrals')).rows.length,1);
  await db.query('SELECT qualify_referral($1,$2,now())',[referred,'in_first']);
  await db.query('SELECT qualify_referral($1,$2,now())',[referred,'in_renewal']);
  assert.equal((await db.query('SELECT qualifying_invoice_id FROM organization_referrals')).rows[0].qualifying_invoice_id,'in_first');
});
test('one invoice reserves exactly one month; retry returns same reward', async () => {
  const first = (await db.query('SELECT reserve_referral_month($1,$2) AS id',[org,'in_free'])).rows[0].id;
  const again = (await db.query('SELECT reserve_referral_month($1,$2) AS id',[org,'in_free'])).rows[0].id;
  assert.ok(first); assert.equal(first,again);
  assert.equal((await db.query('SELECT reserve_referral_month($1,$2) AS id',[org,'in_next'])).rows[0].id,null);
});
test('RLS prevents reading another organization rewards and earning rewards as a client', async () => {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[secondUser]);
  await db.exec('SET ROLE authenticated');
  assert.equal((await db.query('SELECT * FROM organization_referrals')).rows.length,0);
  await assert.rejects(db.query('SELECT qualify_referral($1,$2,now())',[referred,'forged']), /permission denied/);
  await assert.rejects(db.query('SELECT get_referral_dashboard($1)',[org]), /Not authorized/);
  await db.exec('RESET ROLE');
});
test('sliding window accepts five, rejects sixth, and isolates users and operations', async () => {
  for (let n=0;n<5;n++) assert.equal((await db.query("SELECT user_action_rate_limit($1,'otto') AS r",[user])).rows[0].r.allowed,true);
  const denied = (await db.query("SELECT user_action_rate_limit($1,'otto') AS r",[user])).rows[0].r;
  assert.equal(denied.allowed,false); assert.ok(denied.retry_after > 0 && denied.retry_after <= 60);
  assert.equal((await db.query("SELECT user_action_rate_limit($1,'otto') AS r",[secondUser])).rows[0].r.allowed,true);
  assert.equal((await db.query("SELECT user_action_rate_limit($1,'email-send') AS r",[user])).rows[0].r.allowed,true);
  await db.query("UPDATE rate_limit_hits SET request_times=ARRAY[now()-interval '61 seconds'] WHERE bucket=$1",['user-action:otto:'+user]);
  assert.equal((await db.query("SELECT user_action_rate_limit($1,'otto') AS r",[user])).rows[0].r.allowed,true);
});
test('email sends are limited in the database while reads remain available', async () => {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[secondUser]);
  for(let n=0;n<5;n++) await db.query("INSERT INTO email_commands(type,created_by) VALUES('send',$1)",[secondUser]);
  await assert.rejects(db.query("INSERT INTO email_commands(type,created_by) VALUES('send',$1)",[secondUser]),/Máximo de 5/);
  await db.query("INSERT INTO email_commands(type,created_by) VALUES('mark_read',$1)",[secondUser]);
});
test.after(async () => { await db.close(); });

// This adapter executes the real webhook helper against the migrated SQL schema.
// Only Stripe transport is substituted; ledger reads/writes and dashboard RPC are real.
import { handleReferralEvent } from '../functions/_shared/referrals.ts';
const ledgerClient = {
  rpc: async (name, args) => {
    const permitted = { qualify_referral: ['_organization_id','_invoice_id','_paid_at'], reserve_referral_month: ['_organization_id','_invoice_id'], sync_referral_billing: ['_organization_id','_customer_id','_subscription_id','_snapshot','_observed_at'] };
    const values = permitted[name].map(k => args[k]);
    try { return { data: (await db.query(`SELECT ${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) AS value`,values)).rows[0].value }; }
    catch(error) { return { error }; }
  },
  from(table) {
    assert.ok(['organizations','organization_referrals','organization_billing_accounts'].includes(table));
    let columns='*', update; const filters=[];
    const run = async () => {
      const values=[]; const param = value => {values.push(value);return '$'+values.length;};
      let sql=update ? `UPDATE ${table} SET `+Object.entries(update).map(([k,v])=>`${k}=${param(v)}`).join(',') : `SELECT ${columns} FROM ${table}`;
      if(filters.length)sql+=' WHERE '+filters.map(([k,v])=>v===null?`${k} IS NULL`:`${k}=${param(v)}`).join(' AND ');
      if(update)sql+=' RETURNING *';
      try {return {data:(await db.query(sql,values)).rows,error:null};}catch(error){return {data:null,error};}
    };
    const query={select(v){columns=v;return query;},update(v){update=v;return query;},eq(k,v){filters.push([k,v]);return query;},is(k,v){filters.push([k,v]);return query;},async maybeSingle(){const r=await run();return {...r,data:r.data?.[0]??null};},async single(){const r=await run();return {...r,data:r.data?.[0]??null};},then(resolve,reject){return run().then(resolve,reject);}};
    return query;
  },
};

test('real migrated ledger: confirmed payment -> dashboard bonus -> renewal -> used; replay earns nothing extra',async()=>{
  await db.query('INSERT INTO organization_referrals(organization_id,referred_organization_id) VALUES($1,$2)',[org,secondOrg]);
  await db.query("INSERT INTO organization_billing_accounts(organization_id,stripe_customer_id) VALUES($1,'cus_origin'),($2,'cus_invited')",[org,secondOrg]);
  const subs={sub_origin:{id:'sub_origin',customer:'cus_origin'},sub_invited:{id:'sub_invited',customer:'cus_invited'}};
  for(const s of Object.values(subs))Object.assign(s,{status:'active',items:{data:[{current_period_end:Math.floor(Date.now()/1000)+86400*20,price:{product:'prod_U0wAc7Tuy8w6gA',recurring:{interval:'month',interval_count:1}}}]}});
  const invoice={id:'in_actual_renewal',status:'draft',total:4900,discounts:[],metadata:{}};
  const stripe={subscriptions:{retrieve:async id=>subs[id]},prices:{retrieve:async()=>({product:'prod_seats'})},coupons:{retrieve:async()=>({id:'senvia-referral-month-v2',percent_off:100,duration:'once',applies_to:{products:['prod_U0wAc7Tuy8w6gA','prod_U0wGoA4odOBHOZ','prod_U0wG6doz0zgZFV','prod_seats']}})},invoices:{retrieve:async id=>id==='in_actual_first'?paid:id==='in_free'?{id,status:'void'}:invoice,update:async(_,patch)=>Object.assign(invoice,patch,{discounts:[{id:'di_ref',coupon:{id:'senvia-referral-month-v2'}}],total_discount_amounts:[{discount:'di_ref',amount:4900}]})}};
  const paid={id:'in_actual_first',subscription:'sub_invited',customer:'cus_invited',amount_paid:4900,status:'paid',created:Math.floor(Date.now()/1000)};
  await handleReferralEvent(ledgerClient,stripe,{type:'invoice.paid',data:{object:paid}});
  await handleReferralEvent(ledgerClient,stripe,{type:'invoice.paid',data:{object:paid}});
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
  const getDashboard=async()=>(await db.query('SELECT get_referral_dashboard($1) AS value',[org])).rows[0].value;
  let dashboard=await getDashboard();
  assert.equal(dashboard.referrals.filter(r=>r.qualified_at).length,2);
  Object.assign(invoice,{subscription:'sub_origin',customer:'cus_origin',billing_reason:'subscription_cycle',created:Math.floor(Date.now()/1000),lines:{data:[{amount:4900,price:{product:'prod_U0wAc7Tuy8w6gA'}}],has_more:false}});
  const renewal={...invoice};
  await handleReferralEvent(ledgerClient,stripe,{type:'invoice.created',data:{object:renewal}});
  assert.ok(invoice.metadata.senvia_referral_reward);
  await handleReferralEvent(ledgerClient,stripe,{type:'invoice.created',data:{object:renewal}});
  dashboard=await getDashboard();
  assert.equal(dashboard.billing.interval,'month');
  assert.equal(dashboard.referrals.find(r=>r.id===invoice.metadata.senvia_referral_reward).reserved,true);
  Object.assign(invoice,{status:'paid',amount_paid:0});
  await handleReferralEvent(ledgerClient,stripe,{type:'invoice.paid',data:{object:{...invoice}}});
  dashboard=await getDashboard();
  const used=dashboard.referrals.find(r=>r.id===invoice.metadata.senvia_referral_reward);
  assert.ok(used.redeemed_at);assert.equal(used.reserved,false);
  await handleReferralEvent(ledgerClient,stripe,{type:'invoice.voided',data:{object:{id:'in_free'}}});
  assert.equal((await getDashboard()).referrals.filter(r=>!r.reserved&&!r.redeemed_at&&r.qualified_at).length,1);
});

test('billing binding is private, unique and never writable by a browser client',async()=>{
  await db.exec('SET ROLE authenticated');
  await assert.rejects(db.query('SELECT * FROM organization_billing_accounts'),/permission denied/);
  await assert.rejects(db.query("UPDATE organization_billing_accounts SET stripe_customer_id='cus_forged'"),/permission denied/);
  await db.exec('RESET ROLE');
  await assert.rejects(db.query("INSERT INTO organization_billing_accounts(organization_id,stripe_customer_id) VALUES($1,'cus_origin')",[referred]),/unique constraint/);
  await db.query('UPDATE organizations SET billing_exempt=true WHERE id=$1',[org]);
  const d=(await db.query('SELECT get_referral_dashboard($1) AS value',[org])).rows[0].value;
  assert.equal(d.billing.exempt,true);
  assert.equal('stripe_customer_id' in d.billing,false);
});

test('ordinary members cannot read referral links or rewards through direct table access',async()=>{
  const member=ids[7];await db.query("INSERT INTO organization_members VALUES($1,$2,'viewer',true)",[member,org]);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[member]);
  await db.exec('SET ROLE authenticated');
  try{
    assert.equal((await db.query('SELECT * FROM referral_codes')).rows.length,0);
    assert.equal((await db.query('SELECT * FROM organization_referrals')).rows.length,0);
    await assert.rejects(db.query('SELECT get_referral_dashboard($1)',[org]),/Not authorized/);
    await assert.rejects(db.query('SELECT claim_referral_checkout($1,$2)',[org,{}]),/permission denied/);
  }finally{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);}
});

test('subscription snapshots reject old-subscription and delayed-fetch overwrites',async()=>{
  const originTime=Date.now()+1000;
  const snapshot={status:'active',billing_interval:'month',interval_count:1,next_renewal_at:new Date(Date.now()+86400000).toISOString()};
  const sync=async(sub,patch={},offset=0)=>(await db.query('SELECT sync_referral_billing($1,$2,$3,$4,$5) AS ok',[org,'cus_origin',sub,{...snapshot,...patch},new Date(originTime+offset).toISOString()])).rows[0].ok;
  assert.equal(await sync('sub_origin'),true);
  assert.equal(await sync('sub_old',{status:'canceled'},1000),false);
  assert.equal(await sync('sub_origin',{status:'canceled'},2000),true);
  assert.equal(await sync('sub_replacement',{},3000),true);
  assert.equal(await sync('sub_origin',{status:'canceled'},4000),false);
  assert.equal(await sync('sub_replacement',{status:'canceled'},1000),false);
  assert.equal((await db.query('SELECT stripe_subscription_id,status FROM organization_billing_accounts WHERE organization_id=$1',[org])).rows[0].status,'active');
});

test('checkout retries share one attempt and reject changed parameters until expiration',async()=>{
  const parameters={customer:'cus_origin',mode:'subscription',line_items:[{price:'price_fixture',quantity:1}]};
  const claim=async p=>(await db.query('SELECT claim_referral_checkout($1,$2) AS attempt',[org,p])).rows[0].attempt;
  const first=await claim(parameters);const retry=await claim(parameters);
  assert.equal(first.attempt,retry.attempt);assert.equal(first.expires_at,retry.expires_at);
  await assert.rejects(claim({...parameters,customer:'cus_different'}),/outros dados/);
  await db.query("UPDATE organization_billing_accounts SET checkout_expires_at=now()-interval '1 second' WHERE organization_id=$1",[org]);
  assert.notEqual((await claim(parameters)).attempt,first.attempt);
});

test('out-of-order payments keep the earliest confirmation without earning another month',async()=>{
  const {rows:[before]}=await db.query('SELECT id,created_at,qualified_at FROM organization_referrals WHERE referred_organization_id=$1',[referred]);
  await db.query("UPDATE organization_referrals SET created_at=now()-interval '10 days',qualified_at=now()-interval '2 days' WHERE id=$1",[before.id]);
  await db.query("SELECT qualify_referral($1,'in_earliest',now()-interval '5 days')",[referred]);
  await db.query("SELECT qualify_referral($1,'in_late',now()-interval '1 day')",[referred]);
  await db.query("SELECT qualify_referral($1,'in_before_registration',now()-interval '20 days')",[referred]);
  const rows=(await db.query('SELECT qualifying_invoice_id FROM organization_referrals WHERE referred_organization_id=$1',[referred])).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].qualifying_invoice_id,'in_earliest');
});

test('first payment date is updated only by confirmed qualification and keeps the earliest payment',async()=>{
  await db.query("UPDATE organizations SET created_at=now()-interval '30 days', first_paid_at=NULL WHERE id=$1",[referred]);
  await db.query("SELECT qualify_referral($1,'in_first_confirmed',now()-interval '5 days')",[referred]);
  const first=(await db.query('SELECT first_paid_at FROM organizations WHERE id=$1',[referred])).rows[0].first_paid_at;
  assert.ok(first);
  await db.query("SELECT qualify_referral($1,'in_later',now()-interval '1 day')",[referred]);
  assert.equal(String((await db.query('SELECT first_paid_at FROM organizations WHERE id=$1',[referred])).rows[0].first_paid_at),String(first));
  await db.query("SELECT qualify_referral($1,'in_earlier',now()-interval '8 days')",[referred]);
  assert.ok(new Date((await db.query('SELECT first_paid_at FROM organizations WHERE id=$1',[referred])).rows[0].first_paid_at)<new Date(first));
});

test('inviting an administrator into an existing organization does not create a referral',async()=>{
  const olderOrg=ids[5],newUser=ids[6];
  await db.query("INSERT INTO organizations(id,name,slug,created_at) VALUES($1,'Existing','existing',now()-interval '1 month')",[olderOrg]);
  await db.query('INSERT INTO auth.users(id,raw_user_meta_data) VALUES($1,$2)',[newUser,{referral_code:dashboard.code,organization_slug:'existing'}]);
  await db.query("INSERT INTO organization_members VALUES($1,$2,'admin',true)",[newUser,olderOrg]);
  assert.equal((await db.query('SELECT * FROM organization_referrals WHERE referred_organization_id=$1',[olderOrg])).rows.length,0);
});

test('revoked and redeemed reservations are never returned for reuse',async()=>{
  const target=(await db.query('SELECT id FROM organization_referrals WHERE referred_organization_id=$1',[referred])).rows[0].id;
  await db.query("UPDATE organization_referrals SET redemption_invoice_id='in_revoked',revoked_at=now(),redeemed_at=NULL WHERE id=$1",[target]);
  assert.equal((await db.query("SELECT reserve_referral_month($1,'in_revoked') AS id",[org])).rows[0].id,null);
  await db.query('UPDATE organization_referrals SET revoked_at=NULL,redeemed_at=now() WHERE id=$1',[target]);
  assert.equal((await db.query("SELECT reserve_referral_month($1,'in_revoked') AS id",[org])).rows[0].id,null);
  await handleReferralEvent(ledgerClient,{}, {type:'invoice.deleted',data:{object:{id:'in_revoked'}}});
  assert.ok((await db.query('SELECT redeemed_at FROM organization_referrals WHERE id=$1',[target])).rows[0].redeemed_at);
});
