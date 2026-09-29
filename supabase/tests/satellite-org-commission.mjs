import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(
  new URL('../migrations/20260929120000_satellite_sales_no_org_commission.sql', import.meta.url),
  'utf8',
);

async function legacyDatabase() {
  const db = new PGlite();
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS public;
    CREATE TABLE public.sales (
      id uuid PRIMARY KEY,
      servicos_details jsonb,
      comissao numeric NOT NULL DEFAULT 0,
      org_commission numeric NOT NULL DEFAULT 0
    );
    CREATE TABLE public.sale_commission_splits (
      sale_id uuid NOT NULL,
      amount numeric NOT NULL
    );
  `);
  return db;
}

async function database() {
  const db = await legacyDatabase();
  await db.exec(migration);
  return db;
}

test('migration corrects an existing satellite sale', async () => {
  const db = await legacyDatabase();
  try {
    await db.exec(`
      INSERT INTO public.sales (id, servicos_details, comissao, org_commission)
      VALUES ('10000000-0000-0000-0000-000000000003', '{"Internet":{"tecnologia":"satelite"}}', 100, 70);
      INSERT INTO public.sale_commission_splits (sale_id, amount)
      VALUES ('10000000-0000-0000-0000-000000000003', 30);
    `);
    await db.exec(migration);

    const result = await db.query('SELECT comissao, org_commission FROM public.sales');
    assert.deepEqual({
      comissao: Number(result.rows[0].comissao),
      org_commission: Number(result.rows[0].org_commission),
    }, { comissao: 30, org_commission: 0 });
  } finally {
    await db.close();
  }
});

test('satellite recalculation assigns only the seller commission', async () => {
  const db = await database();
  try {
    await db.exec(`
      INSERT INTO public.sales (id, servicos_details)
      VALUES ('10000000-0000-0000-0000-000000000001', '{"Internet":{"tecnologia":"satelite"}}');
      INSERT INTO public.sale_commission_splits (sale_id, amount)
      VALUES ('10000000-0000-0000-0000-000000000001', 30);
      UPDATE public.sales SET comissao = 100, org_commission = 70
      WHERE id = '10000000-0000-0000-0000-000000000001';
    `);

    const result = await db.query('SELECT comissao, org_commission FROM public.sales');
    assert.deepEqual({
      comissao: Number(result.rows[0].comissao),
      org_commission: Number(result.rows[0].org_commission),
    }, { comissao: 30, org_commission: 0 });
  } finally {
    await db.close();
  }
});

test('fibre sales retain their organization commission', async () => {
  const db = await database();
  try {
    await db.exec(`
      INSERT INTO public.sales (id, servicos_details, comissao, org_commission)
      VALUES ('10000000-0000-0000-0000-000000000002', '{"Internet":{"tecnologia":"fibra"}}', 100, 70);
      UPDATE public.sales SET comissao = 100, org_commission = 70
      WHERE id = '10000000-0000-0000-0000-000000000002';
    `);

    const result = await db.query('SELECT comissao, org_commission FROM public.sales');
    assert.deepEqual({
      comissao: Number(result.rows[0].comissao),
      org_commission: Number(result.rows[0].org_commission),
    }, { comissao: 100, org_commission: 70 });
  } finally {
    await db.close();
  }
});
