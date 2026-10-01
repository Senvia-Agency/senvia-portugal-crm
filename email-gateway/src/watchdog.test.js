import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Loads idle.js without its imports (no IMAP, no Postgres) and hands back the
// CaixaManager class, with timers the test can see.
async function loadManager() {
  const source = (await readFile(new URL('./idle.js', import.meta.url), 'utf8'))
    .replace(/^import [\s\S]*?;\r?\n/gm, '')
    .replace(/^export /gm, '');
  const timers = [];
  const box = vm.createContext({
    console: { log() {}, error() {} },
    Date,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
  });
  vm.runInContext(`${source}\nglobalThis.CaixaManager = CaixaManager;`, box);
  return { CaixaManager: box.CaixaManager, timers };
}

const caixa = { id: 'c1', label: 'Teste', organization_id: 'o1', meta: {} };

test('a sync running for under 5 minutes is left alone', async () => {
  const { CaixaManager } = await loadManager();
  const m = new CaixaManager(caixa);
  let reconnects = 0;
  m.forceReconnect = () => { reconnects++; };
  m.beginSync();
  m.syncStartedAt = Date.now() - 4 * 60 * 1000;
  m.watchdog();
  assert.equal(m.syncing, true);
  assert.equal(reconnects, 0);
});

test('a sync stuck for over 5 minutes is dropped and the connection rebuilt', async () => {
  const { CaixaManager } = await loadManager();
  const m = new CaixaManager(caixa);
  let reconnects = 0;
  m.forceReconnect = () => { reconnects++; };
  m.beginSync();
  m.syncStartedAt = Date.now() - 6 * 60 * 1000;
  m.watchdog();
  assert.equal(m.syncing, false);
  assert.equal(reconnects, 1);
});

test('the hung sync finishing late does not switch off the next one', async () => {
  const { CaixaManager } = await loadManager();
  const m = new CaixaManager(caixa);
  m.forceReconnect = () => {};
  const endHung = m.beginSync();
  m.syncStartedAt = Date.now() - 6 * 60 * 1000;
  m.watchdog();
  m.beginSync();
  endHung();
  assert.equal(m.syncing, true);
});

test('two reconnect requests schedule one reconnect', async () => {
  const { CaixaManager, timers } = await loadManager();
  const m = new CaixaManager(caixa);
  m.scheduleReconnect();
  m.scheduleReconnect();
  assert.equal(timers.length, 1);
});

test('forceReconnect closes the old connection and schedules a new one', async () => {
  const { CaixaManager, timers } = await loadManager();
  const m = new CaixaManager(caixa);
  let closed = 0;
  m.client = { close() { closed++; } };
  m.forceReconnect();
  assert.equal(closed, 1);
  assert.equal(m.client, null);
  assert.equal(timers.length, 1);
});
