import assert from 'node:assert/strict';
import test from 'node:test';

import { parseContent } from './evolution-inbox.ts';

test('WhatsApp signalling is not a message: no "[secretEncrypted]" bubble', () => {
  const secret = parseContent('m1', {
    secretEncryptedMessage: { targetMessageKey: { id: 'x' }, encPayload: 'AA==', encIv: 'AA==' },
    messageContextInfo: {},
  });
  assert.equal(secret.texto, '');
  assert.equal(secret.anexos.length, 0);
  assert.equal(parseContent('m2', { encReactionMessage: { encPayload: 'AA==' } }).texto, '');
  assert.equal(parseContent('m3', { senderKeyDistributionMessage: {} }).texto, '');
});

test('a message sent from the owner\'s other device keeps its text', () => {
  const sent = parseContent('m4', { deviceSentMessage: { destinationJid: 'x', message: { conversation: 'Olá Nuno' } } });
  assert.equal(sent.texto, 'Olá Nuno');
});

test('plain text and unknown real types still show', () => {
  assert.equal(parseContent('m5', { conversation: 'Viva' }).texto, 'Viva');
  // A type we do not render yet still leaves a trace, as before.
  assert.equal(parseContent('m6', { eventMessage: { name: 'Reunião' } }).texto, '[event]');
});
