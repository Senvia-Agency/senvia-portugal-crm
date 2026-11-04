import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { conditionMatches, planRules, ruleMatches, rulesNeedBody } from './rules.js';

const message = {
  from_name: 'João Faria', from_address: 'joao@cliente.pt',
  to_addresses: [{ name: 'Geral Senvia', address: 'geral@senvia.pt' }],
  cc_addresses: JSON.stringify([{ name: '', address: 'contabilidade@senvia.pt' }]),
  subject: 'Fatura FT 2026/123', body: 'Segue em anexo a fatura de outubro.', has_attachments: true,
};
const rule = (id, conditions, actions, extra = {}) => ({ id, name: id, match_all: true, conditions, actions, stop_processing: false, ...extra });

test('conditions ignore case and look at the name or the address', () => {
  assert.equal(conditionMatches({ field: 'from', operator: 'ends_with', value: '@CLIENTE.pt' }, message), true);
  assert.equal(conditionMatches({ field: 'from', operator: 'equals', value: 'joão faria' }, message), true);
  assert.equal(conditionMatches({ field: 'from', operator: 'starts_with', value: 'maria' }, message), false);
  assert.equal(conditionMatches({ field: 'subject', operator: 'contains', value: 'fatura' }, message), true);
  assert.equal(conditionMatches({ field: 'body', operator: 'contains', value: 'outubro' }, message), true);
});

test('lists match any address; "não contém" holds only when none has it', () => {
  assert.equal(conditionMatches({ field: 'to', operator: 'equals', value: 'geral@senvia.pt' }, message), true);
  assert.equal(conditionMatches({ field: 'cc', operator: 'contains', value: 'contabilidade' }, message), true);
  assert.equal(conditionMatches({ field: 'cc', operator: 'not_contains', value: 'contabilidade' }, message), false);
  assert.equal(conditionMatches({ field: 'cc', operator: 'not_contains', value: 'x' }, { ...message, cc_addresses: [] }), true);
});

test('attachments and empty values', () => {
  assert.equal(conditionMatches({ field: 'has_attachments', operator: 'equals', value: 'true' }, message), true);
  assert.equal(conditionMatches({ field: 'has_attachments', operator: 'equals', value: 'false' }, message), false);
  assert.equal(conditionMatches({ field: 'subject', operator: 'contains', value: '  ' }, message), false);
});

test('"todas" needs every condition, "qualquer uma" needs one', () => {
  const conditions = [{ field: 'subject', operator: 'contains', value: 'fatura' }, { field: 'from', operator: 'contains', value: 'outro' }];
  assert.equal(ruleMatches(rule('a', conditions, [], { match_all: true }), message), false);
  assert.equal(ruleMatches(rule('a', conditions, [], { match_all: false }), message), true);
  assert.equal(ruleMatches(rule('a', [], []), message), false);
});

test('flags add up, the first destination wins, stop ends the run', () => {
  const subject = [{ field: 'subject', operator: 'contains', value: 'fatura' }];
  const rules = [
    rule('1', subject, [{ type: 'move', folderId: 'f-faturas' }]),
    rule('2', subject, [{ type: 'mark_read' }, { type: 'archive' }], { stop_processing: true }),
    rule('3', subject, [{ type: 'flag' }]),
  ];
  assert.deepEqual({ ...planRules(rules, message), matched: [...planRules(rules, message).matched] },
    { matched: ['1', '2'], seen: true, flagged: false, destination: { folderId: 'f-faturas' } });
  const spam = planRules([rule('s', subject, [{ type: 'spam' }])], message);
  assert.deepEqual({ ...spam.destination }, { role: 'junk' });
  assert.equal(planRules([rule('x', [{ field: 'subject', operator: 'contains', value: 'nada' }], [{ type: 'flag' }])], message).matched.length, 0);
});

test('the body is only downloaded when a rule reads it', () => {
  assert.equal(rulesNeedBody([rule('a', [{ field: 'subject', operator: 'contains', value: 'x' }], [])]), false);
  assert.equal(rulesNeedBody([rule('a', [{ field: 'body', operator: 'contains', value: 'x' }], [])]), true);
});

// applyInboxRules against a fake database and IMAP server.
async function loadCommands(rows, rules) {
  const code = (await readFile(new URL('./commands.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  const calls = { flags: [], moves: [], counted: [] };
  const q = async (sql, params = []) => {
    if (/FROM email_messages\s+WHERE folder_id/.test(sql)) return rows.filter((row) => row.uid > params[3]);
    if (/FROM email_rules\s+WHERE channel_id/.test(sql)) return rules;
    if (/UPDATE email_rules SET match_count/.test(sql)) { calls.counted.push(...params[0]); return []; }
    if (/FROM email_folders WHERE id=/.test(sql)) return params[0] === 'f-faturas' ? [{ id: 'f-faturas', path: 'Faturas', role: 'custom' }] : [];
    if (/FROM email_folders WHERE channel_id=\$1 AND role=/.test(sql)) return [{ id: `f-${params[1]}`, path: params[1], role: params[1] }];
    return [];
  };
  const client = {
    getMailboxLock: async () => ({ release() {} }),
    messageFlagsAdd: async (uid, flags) => { calls.flags.push([uid, flags[0]]); },
    messageMove: async (uid, path) => { calls.moves.push([uid, path]); },
    status: async () => ({ messages: 0, unseen: 0 }),
  };
  const box = vm.createContext({
    console: { log() {} }, Buffer, setTimeout, q, planRules, rulesNeedBody,
    syncFolderMessages: async () => 0, fetchMessageBody: async () => ({ text: 'corpo', html: null }),
  });
  vm.runInContext(`${code}\nthis.applyInboxRules = applyInboxRules;`, box);
  return { applyInboxRules: box.applyInboxRules, client, calls };
}

const caixa = { id: 'c1', organization_id: 'o1', label: 'Geral' };
const inbox = { id: 'f-inbox', path: 'INBOX' };
const row = (uid, extra = {}) => ({ id: `m${uid}`, uid, folder_id: 'f-inbox', seen: false, flagged: false, ...message, body_fetched: true, text_body: '', html_body: null, ...extra });

test('new Inbox mail is read, starred and moved by the matching rules, once', async () => {
  const rules = [
    rule('r1', [{ field: 'from', operator: 'ends_with', value: '@cliente.pt' }], [{ type: 'mark_read' }, { type: 'move', folderId: 'f-faturas' }]),
    rule('r2', [{ field: 'subject', operator: 'contains', value: 'fatura' }], [{ type: 'flag' }]),
  ];
  const { applyInboxRules, client, calls } = await loadCommands([row(7), row(8, { from_address: 'outro@x.pt', subject: 'Olá' })], rules);
  const result = await applyInboxRules(client, caixa, inbox, 6);
  assert.deepEqual({ ...result }, { lastUid: 8, touched: true });
  assert.deepEqual(calls.flags.map((call) => [...call]), [['7', '\\Seen'], ['7', '\\Flagged']]);
  assert.deepEqual(calls.moves.map((call) => [...call]), [['7', 'Faturas']]);
  assert.deepEqual([...calls.counted], ['r1', 'r2']);
});

test('no rules, or nothing new: the watermark still moves on', async () => {
  const { applyInboxRules, client, calls } = await loadCommands([row(9)], []);
  assert.deepEqual({ ...(await applyInboxRules(client, caixa, inbox, 8)) }, { lastUid: 9, touched: false });
  assert.deepEqual({ ...(await applyInboxRules(client, caixa, inbox, 9)) }, { lastUid: 9, touched: false });
  assert.equal(calls.moves.length, 0);
});
