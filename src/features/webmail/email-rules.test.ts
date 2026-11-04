import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanDraft, describeRule, emptyRule, ruleDraftError, ruleHasMissingFolder, withField, type RuleDraft } from './email-rules.ts';

const folders = new Set(['f-faturas']);
const valid: RuleDraft = {
  name: ' Faturas ', match_all: true, stop_processing: false,
  conditions: [{ field: 'subject', operator: 'contains', value: ' fatura ' }],
  actions: [{ type: 'mark_read' }, { type: 'move', folderId: 'f-faturas' }],
};

test('a complete rule can be saved', () => {
  assert.equal(ruleDraftError(valid, folders), null);
});

test('the editor names what is missing before saving', () => {
  assert.match(ruleDraftError({ ...valid, name: '  ' }, folders) ?? '', /nome/);
  assert.match(ruleDraftError({ ...valid, conditions: [{ field: 'from', operator: 'contains', value: ' ' }] }, folders) ?? '', /Remetente/);
  assert.match(ruleDraftError({ ...valid, actions: [] }, folders) ?? '', /ação/);
  assert.match(ruleDraftError({ ...valid, actions: [{ type: 'move' }] }, folders) ?? '', /pasta/);
  assert.match(ruleDraftError({ ...valid, actions: [{ type: 'move', folderId: 'apagada' }] }, folders) ?? '', /pasta/);
});

test('one destination per rule and each action once', () => {
  assert.match(ruleDraftError({ ...valid, actions: [{ type: 'archive' }, { type: 'spam' }] }, folders) ?? '', /uma pasta/);
  assert.match(ruleDraftError({ ...valid, actions: [{ type: 'flag' }, { type: 'flag' }] }, folders) ?? '', /uma vez/);
});

test('a new rule starts empty and is not saveable until named', () => {
  assert.notEqual(ruleDraftError(emptyRule(), folders), null);
});

test('"Tem anexos" switches to a yes/no condition and back', () => {
  const attachments = withField({ field: 'from', operator: 'ends_with', value: 'x' }, 'has_attachments');
  assert.deepEqual(attachments, { field: 'has_attachments', operator: 'equals', value: 'true' });
  assert.deepEqual(withField(attachments, 'subject'), { field: 'subject', operator: 'contains', value: '' });
  assert.deepEqual(withField({ field: 'from', operator: 'ends_with', value: 'x' }, 'to'), { field: 'to', operator: 'ends_with', value: 'x' });
});

test('saved drafts are trimmed and keep the folder only on "move"', () => {
  const clean = cleanDraft({ ...valid, actions: [{ type: 'flag', folderId: 'f-faturas' }, { type: 'move', folderId: 'f-faturas' }] });
  assert.equal(clean.name, 'Faturas');
  assert.equal(clean.conditions[0].value, 'fatura');
  assert.deepEqual(clean.actions, [{ type: 'flag' }, { type: 'move', folderId: 'f-faturas' }]);
});

test('the list explains each rule in one line and flags a deleted folder', () => {
  const name = (id: string) => (id === 'f-faturas' ? 'Faturas' : null);
  assert.equal(describeRule(valid, name), 'Se assunto contém " fatura " → Marcar como lido, Mover para "Faturas"');
  assert.equal(describeRule({ ...valid, match_all: false, conditions: [...valid.conditions, { field: 'has_attachments', operator: 'equals', value: 'true' }] }, name),
    'Se assunto contém " fatura " ou tem anexos → Marcar como lido, Mover para "Faturas"');
  assert.equal(ruleHasMissingFolder({ actions: [{ type: 'move', folderId: 'apagada' }] }, folders), true);
  assert.equal(ruleHasMissingFolder(valid, folders), false);
});
