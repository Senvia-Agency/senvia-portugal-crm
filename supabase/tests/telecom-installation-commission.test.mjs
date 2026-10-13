import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Telecom timing follows installation plus one month and preserves other niches and frozen amounts', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE organizations(id uuid PRIMARY KEY, niche text);
      CREATE TABLE operators(id uuid PRIMARY KEY, organization_id uuid, commission_payment_month_offset int);
      CREATE TABLE sales(id int PRIMARY KEY, organization_id uuid, telecom_status text, activation_date date,
        scheduled_install_date timestamptz, sale_date date, servicos_details jsonb,
        commission_payment_month_offset int, commission_expected_date date, commission_month_override date,
        comissao numeric, org_commission numeric, seller_id text);
      INSERT INTO organizations VALUES ('00000000-0000-0000-0000-000000000001','telecom'),('00000000-0000-0000-0000-000000000002','agency');
      INSERT INTO operators VALUES ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002',2);
    `);
    const prior = await readFile(new URL('../migrations/20261008120000_sales_commission_month_override.sql',import.meta.url),'utf8');
    await db.exec(prior);
    await db.exec(`INSERT INTO sales VALUES
      (1,'00000000-0000-0000-0000-000000000001','instalado','2026-08-01','2026-09-30 09:00+01','2026-07-01','{}',0,null,'2027-01-01',230,50,'seller-original'),
      (2,'00000000-0000-0000-0000-000000000002','instalado','2026-08-01','2026-09-30 09:00+01','2026-07-01','{"service":{"operator_id":"00000000-0000-0000-0000-000000000003"}}',0,null,null,230,50,'seller-other');`);
    const otherBefore=(await db.query('SELECT * FROM sales WHERE id=2')).rows[0];
    await db.exec(await readFile(new URL('../migrations/20261013150032_telecom_installation_commission_month.sql',import.meta.url),'utf8'));
    const row=(await db.query('SELECT commission_expected_date::text as due,commission_payment_month_offset as offset,comissao::text as gross,org_commission::text as org,seller_id FROM sales WHERE id=1')).rows[0];
    assert.deepEqual(row,{due:'2026-10-01',offset:1,gross:'230',org:'50',seller_id:'seller-original'});
    assert.deepEqual((await db.query('SELECT * FROM sales WHERE id=2')).rows[0],otherBefore);
    await db.exec(`UPDATE sales SET scheduled_install_date='2026-12-31 18:00+00' WHERE id=1`);
    assert.equal((await db.query('SELECT commission_expected_date::text as due FROM sales WHERE id=1')).rows[0].due,'2027-01-01');
    await db.exec(`UPDATE sales SET scheduled_install_date='2026-09-30 23:30+00' WHERE id=1`);
    assert.equal((await db.query('SELECT commission_expected_date::text as due FROM sales WHERE id=1')).rows[0].due,'2026-11-01');
    await db.exec(`UPDATE sales SET scheduled_install_date=null WHERE id=1`);
    assert.equal((await db.query('SELECT commission_expected_date FROM sales WHERE id=1')).rows[0].commission_expected_date,null);
    await db.exec(`UPDATE sales SET scheduled_install_date='2026-09-30 09:00+01',telecom_status='em_instalacao' WHERE id=1`);
    assert.equal((await db.query('SELECT commission_expected_date FROM sales WHERE id=1')).rows[0].commission_expected_date,null);
    await db.exec(`UPDATE sales SET commission_payment_month_offset=0 WHERE id=2`);
    assert.deepEqual((await db.query('SELECT * FROM sales WHERE id=2')).rows[0],otherBefore);
  } finally { await db.close(); }
});
