// The send is the only big write: no draft save may run next to it or come back after it.
// Statement timeouts on the small database plan came from a draft save of the same
// attachments running one second after the send (both ~6 MB).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(__dirname + '/EmailComposer.tsx', 'utf8');
const ast = ts.createSourceFile('EmailComposer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const composer = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'EmailComposer');
const handler = composer.body.statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(ast) === 'doSend'));
const code = ts.transpileModule(handler.getText(ast) + '\nresult = doSend();', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

function run({ sendFails = false, pendingTimer = true } = {}) {
  const calls = [];
  let releaseDraft;
  const closingRef = { current: false };
  const ctx = {
    calls, closingRef,
    sendLock: { current: false }, loadingAttachments: false,
    autosaveTimer: { current: pendingTimer ? 42 : null },
    clearTimeout: (id) => calls.push(['clearTimeout', id]),
    draftOperation: { current: new Promise((resolve) => { releaseDraft = () => { calls.push('draft-save-finished'); resolve(); }; }) },
    setSending: () => {}, sanitizeEmailHtml: (h) => h,
    editorRef: { current: { innerHTML: '<p>x</p>', innerText: 'x' } },
    original: null, mode: 'forward', initialDraft: null, recovered: null,
    to: [{ address: 'a@example.com' }], cc: [], bcc: [], showCc: false, showBcc: false, subject: 'Fwd: x',
    attachments: [{ filename: 'big.zip', contentType: 'application/zip', b64: 'AAAA' }],
    actions: {
      send: async () => { calls.push(['send', closingRef.current]); if (sendFails) throw new Error('canceling statement due to statement timeout'); },
      deleteDraft: async () => calls.push('deleteDraft'),
    },
    draftIdRef: { current: null },
    persistDraft: () => { calls.push(['persistDraft', closingRef.current]); return Promise.resolve({ id: 'd' }); },
    currentDraft: () => ({}),
    clearRecovery: () => {}, toast: (m) => calls.push(['toast', m.title]), t: (s) => s,
    webmail: null, organization: null, onClose: () => calls.push('onClose'),
    result: null,
  };
  vm.runInNewContext(code, ctx);
  return { ctx, calls, releaseDraft };
}

test('send cancels the pending autosave and waits for a running draft save before writing', async () => {
  const { ctx, calls, releaseDraft } = run();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(!calls.some((c) => Array.isArray(c) && c[0] === 'send'), 'the send waited for the draft save in progress');
  assert.deepEqual(calls[0], ['clearTimeout', 42]);
  assert.equal(ctx.closingRef.current, true, 'no new draft save can start once the send began');
  releaseDraft();
  await ctx.result;
  const order = calls.map((c) => (Array.isArray(c) ? c[0] : c));
  assert.ok(order.indexOf('draft-save-finished') < order.indexOf('send'));
  assert.deepEqual(calls.find((c) => Array.isArray(c) && c[0] === 'send'), ['send', true]);
  assert.ok(!order.includes('persistDraft'), 'no draft is saved after a successful send');
  assert.equal(ctx.closingRef.current, true, 'a sent message cannot get a draft back');
  assert.ok(order.includes('onClose'));
});

test('a failed send reopens drafts and saves the edits whose autosave it had cancelled', async () => {
  const { ctx, calls, releaseDraft } = run({ sendFails: true });
  releaseDraft();
  await ctx.result;
  assert.equal(ctx.closingRef.current, false);
  assert.deepEqual(calls.find((c) => Array.isArray(c) && c[0] === 'persistDraft'), ['persistDraft', false]);
  assert.deepEqual(calls.find((c) => Array.isArray(c) && c[0] === 'toast'), ['toast', 'Falha ao enviar']);
  assert.ok(!calls.includes('onClose'));
});

test('a failed send with no pending autosave writes nothing more', async () => {
  const { ctx, calls, releaseDraft } = run({ sendFails: true, pendingTimer: false });
  releaseDraft();
  await ctx.result;
  assert.ok(!calls.some((c) => Array.isArray(c) && c[0] === 'persistDraft'));
});

// Draft saves: attachments above 1 MB stay out, unchanged ones are not sent again.
const pick = (name) => composer.body.statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(ast) === name)).getText(ast);
const draftCode = ts.transpileModule([pick('draftAttachmentKey'), pick('keptForDraft'), pick('persistDraft'), 'api = { persistDraft };'].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

function draftHarness(initialKey = null, draftId = null) {
  const saves = [];
  const ctx = {
    DRAFT_ATTACHMENT_MAX: 1024 * 1024,
    savedAttachmentKey: { current: initialKey }, draftIdRef: { current: draftId }, closingRef: { current: false },
    draftOperation: { current: Promise.resolve() },
    actions: { saveDraft: async (p) => { saves.push(p); return { id: 'draft-1' }; } },
    setDraftId: () => {}, setSavedAt: () => {}, Date, api: null,
  };
  vm.runInNewContext(draftCode, ctx);
  return { ctx, saves };
}
const small = { filename: 'a.pdf', contentType: 'application/pdf', b64: 'A'.repeat(1000) };
const big = { filename: 'b.zip', contentType: 'application/zip', b64: 'A'.repeat(2 * 1024 * 1024) };

test('the draft keeps attachments up to 1 MB and leaves bigger ones out', async () => {
  const { ctx, saves } = draftHarness();
  await ctx.api.persistDraft({ to: [], subject: 's', bodyHtml: '', attachments: [small, big] });
  assert.deepEqual(saves[0].attachments.map((a) => a.filename), ['a.pdf']);
});

test('a later save with the same attachments does not send them again', async () => {
  const { ctx, saves } = draftHarness();
  await ctx.api.persistDraft({ to: [], subject: 's', bodyHtml: '', attachments: [small, big] });
  await ctx.api.persistDraft({ to: [], subject: 's2', bodyHtml: '', attachments: [small, big] });
  assert.equal(saves[1].attachments, undefined);
  await ctx.api.persistDraft({ to: [], subject: 's3', bodyHtml: '', attachments: [] });
  assert.deepEqual(saves[2].attachments, [], 'removing an attachment is saved');
});

test('nothing is saved once the composer is closing or sending', async () => {
  const { ctx, saves } = draftHarness(null, 'draft-9');
  ctx.closingRef.current = true;
  const result = await ctx.api.persistDraft({ to: [], subject: 's', bodyHtml: '', attachments: [small] });
  assert.equal(saves.length, 0);
  assert.equal(result.id, 'draft-9');
});
