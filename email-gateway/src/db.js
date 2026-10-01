// Postgres pool. The gateway writes synced email directly (it runs server-side
// with full DB access; RLS is for the browser, not for this worker).
import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL no ambiente (.env ou variável de ambiente).');
  process.exit(1);
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  // The Supabase pooler drops connections (idle ones, and all of them when it
  // restarts). With no timeouts, a query sent on a connection that had died
  // without closing waited forever — and the caixa's sync waiting on it never
  // finished, so no new mail came in for days while the process stayed up
  // (2026-09-29). These make such a query fail instead, and the sync recover.
  keepAlive: true,
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 30_000,
  query_timeout: 60_000,
});

// A pooled connection that dies while idle emits 'error' on the pool. pg drops
// it and opens a new one on the next query; unhandled, the event would crash
// the whole gateway.
pool.on('error', (err) => {
  console.error(new Date().toISOString(), '[db] ligação ao Postgres perdida:', err.message);
});

export async function q(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}
