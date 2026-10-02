import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

const source = readFileSync(new URL('../functions/email-message-action/imap-action.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports });
const { applyMailboxAction } = module.exports;

function mailboxClient() {
  const calls = [];
  return {
    calls,
    async mailboxOpen(path) { calls.push(['open', path]); },
    async messageMove(uids, path, options) {
      calls.push(['move', [...uids], path, options]);
      return { uidMap: new Map(uids.map((uid) => [uid, uid + 100])) };
    },
    async messageDelete(uids, options) { calls.push(['delete', [...uids], options]); return true; },
  };
}

test('moves selected messages to Lixo in one immediate IMAP operation', async () => {
  const client = mailboxClient();
  const result = await applyMailboxAction(client, {
    action: 'move_to_trash',
    sourcePath: 'Spam',
    sourceIsTrash: false,
    targetPath: 'Lixo',
    uids: [12, 13],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(client.calls)), [
    ['open', 'Spam'],
    ['move', [12, 13], 'Lixo', { uid: true }],
  ]);
  assert.equal(result?.get(12), 112);
  assert.equal(result?.get(13), 113);
});

test('permanently deletes selected Lixo messages in one immediate IMAP operation', async () => {
  const client = mailboxClient();
  await applyMailboxAction(client, {
    action: 'delete_permanently',
    sourcePath: 'Lixo',
    sourceIsTrash: true,
    uids: [21, 22],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(client.calls)), [
    ['open', 'Lixo'],
    ['delete', [21, 22], { uid: true }],
  ]);
});

test('rejects a permanent deletion outside Lixo', async () => {
  const client = mailboxClient();
  await assert.rejects(
    applyMailboxAction(client, {
      action: 'delete_permanently',
      sourcePath: 'Spam',
      sourceIsTrash: false,
      uids: [21],
    }),
    /Lixo/,
  );
  assert.deepEqual(client.calls, []);
});
