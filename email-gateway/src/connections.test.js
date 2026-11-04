import test from 'node:test';
import assert from 'node:assert/strict';
import { withHostSlot, hostSlotsInUse } from './host-slots.js';
import { smtpErrorMessage, retryableBeforeSend } from './smtp-errors.js';
import { embedInlineImages, isEmbeddable } from './inline-images.js';

const BASE = 'https://chhmfwlimtbsyjmgtokn.supabase.co/storage/v1/object/public/email-signatures/u1/logo.png';

test('one server never has more than two connections opening at once', async () => {
  let live = 0, peak = 0;
  const work = () => withHostSlot('cpanel168.example', async () => {
    live++; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 10));
    live--;
  });
  await Promise.all(Array.from({ length: 7 }, work));
  assert.equal(peak, 2);
  assert.equal(hostSlotsInUse('cpanel168.example'), 0);
});

test('a failing job frees its slot for the next one', async () => {
  await assert.rejects(withHostSlot('h', async () => { throw new Error('x'); }));
  await withHostSlot('h', async () => {});
  assert.equal(hostSlotsInUse('h'), 0);
});

test('other servers do not wait for a busy one', async () => {
  const releases = [];
  const busy = Promise.all([1, 2].map(() => withHostSlot('a', () => new Promise((r) => { releases.push(r); }))));
  let ran = false;
  await withHostSlot('b', async () => { ran = true; });
  assert.ok(ran);
  releases.forEach((release) => release());
  await busy;
});

test('SMTP errors say what to fix, with the server reply', () => {
  const auth = smtpErrorMessage({ code: 'EAUTH', responseCode: 535, response: '535 5.7.8 Error: authentication failed' }, 'mail.x.pt');
  assert.match(auth, /palavra-passe SMTP/);
  assert.match(auth, /authentication failed/);
  assert.match(auth, /mail\.x\.pt/);
  assert.match(smtpErrorMessage({ code: 'EENVELOPE', rejected: ['a@b.pt'], response: '550 no such user' }), /destinatário a@b\.pt/);
  assert.match(smtpErrorMessage({ code: 'ECONNECTION', command: 'CONN' }, 'smtp.x'), /Não foi possível ligar/);
  assert.match(smtpErrorMessage({ code: 'EMESSAGE', responseCode: 552, response: '552 Message size exceeds' }), /demasiado grande/);
  assert.match(smtpErrorMessage({ code: 'EMESSAGE', responseCode: 554, response: '554 spam' }), /recusou a mensagem/);
});

test('only failures before the server took anything are retried', () => {
  assert.equal(retryableBeforeSend({ code: 'ETIMEDOUT', command: 'CONN' }), true);
  assert.equal(retryableBeforeSend({ code: 'ECONNECTION' }), true);
  assert.equal(retryableBeforeSend({ code: 'ESOCKET', command: 'DATA' }), false);
  assert.equal(retryableBeforeSend({ code: 'EMESSAGE', responseCode: 554 }), false);
  assert.equal(retryableBeforeSend({ code: 'EAUTH' }), false);
});

test('only Senvia signature images are fetched', () => {
  assert.equal(isEmbeddable(BASE), true);
  assert.equal(isEmbeddable('https://evil.example/logo.png'), false);
  assert.equal(isEmbeddable('http://chhmfwlimtbsyjmgtokn.supabase.co/storage/v1/object/public/email-signatures/a.png'), false);
  assert.equal(isEmbeddable('https://chhmfwlimtbsyjmgtokn.supabase.co/storage/v1/object/public/avatars/a.png'), false);
  assert.equal(isEmbeddable(`${BASE}?x=1`), false);
});

test('signature images travel inside the email as cid', async () => {
  const fetcher = async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
  const html = `<p>Olá</p><img src="${BASE}" width="120"><img src="${BASE}"><img src='https://other.example/x.png'>`;
  const out = await embedInlineImages(html, fetcher);
  assert.equal(out.attachments.length, 1);
  const cid = out.attachments[0].cid;
  assert.equal(out.html.split(`cid:${cid}`).length - 1, 2);
  assert.match(out.html, /https:\/\/other\.example\/x\.png/);
  assert.equal(out.attachments[0].contentType, 'image/png');
});

test('an image that cannot be fetched keeps its link and the send goes on', async () => {
  const out = await embedInlineImages(`<img src="${BASE}">`, async () => { throw new Error('offline'); });
  assert.equal(out.attachments.length, 0);
  assert.match(out.html, /email-signatures/);
});
