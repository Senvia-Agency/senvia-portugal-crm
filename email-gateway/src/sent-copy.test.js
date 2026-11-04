import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadSentCopyExists() {
  const code = (await readFile(new URL('./commands.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  const box = vm.createContext({ console, Buffer, setTimeout, q: async () => [] });
  vm.runInContext(`${code}\nthis.sentCopyExists = sentCopyExists;`, box);
  return box.sentCopyExists;
}

// An IMAP client whose Sent folder answers each search with the next result.
function fakeClient(answers) {
  const calls = { searches: [], locks: 0, released: 0 };
  return {
    calls,
    getMailboxLock: async () => { calls.locks++; return { release: () => { calls.released++; } }; },
    search: async (query) => { calls.searches.push(query); return answers.shift() ?? []; },
  };
}

test('the copy the server filed in Sent is recognised by its Message-ID', async () => {
  const sentCopyExists = await loadSentCopyExists();
  const client = fakeClient([[124]]);
  assert.equal(await sentCopyExists(client, 'Sent', '<abc@senvia.pt>', { waitMs: 0 }), true);
  assert.equal(JSON.stringify(client.calls.searches), JSON.stringify([{ header: { 'message-id': 'abc@senvia.pt' } }]));
  assert.equal(client.calls.released, client.calls.locks);
});

test('a copy filed a moment after the send is still found', async () => {
  const sentCopyExists = await loadSentCopyExists();
  const client = fakeClient([[], [125]]);
  assert.equal(await sentCopyExists(client, 'Sent', '<abc@senvia.pt>', { waitMs: 0 }), true);
  assert.equal(client.calls.searches.length, 2);
});

test('a server that does not file sent mail gets our copy', async () => {
  const sentCopyExists = await loadSentCopyExists();
  const client = fakeClient([[], [], []]);
  assert.equal(await sentCopyExists(client, 'Sent', '<abc@senvia.pt>', { tries: 3, waitMs: 0 }), false);
  assert.equal(client.calls.searches.length, 3);
  assert.equal(client.calls.released, 3);
});
