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

test('photos sent together as an album show as photos, not "[associatedChild]"', () => {
  const photo = parseContent('m7', {
    associatedChildMessage: {
      message: {
        imageMessage: { mimetype: 'image/jpeg', caption: 'Está assim', fileLength: { low: 52000, high: 0 } },
        messageContextInfo: { messageAssociation: { associationType: 1, parentMessageKey: { id: 'album1' } } },
      },
    },
    messageContextInfo: {},
  });
  assert.equal(photo.texto, 'Está assim');
  assert.deepEqual(photo.anexos, [{ type: 'image', media_id: 'm7', url: null, mime: 'image/jpeg', size: 52000 }]);
  // The album itself only says how many photos follow: no bubble of its own.
  const album = parseContent('m8', { albumMessage: { expectedImageCount: 3 }, messageContextInfo: {} });
  assert.equal(album.texto, '');
  assert.equal(album.anexos.length, 0);
});

test('the moving part of a motion photo and HD copies are not a second bubble', () => {
  const child = (associationType: unknown) => ({
    associatedChildMessage: {
      message: {
        videoMessage: { mimetype: 'video/mp4', fileLength: 603834 },
        messageContextInfo: { messageAssociation: { associationType, parentMessageKey: { id: 'foto1' } } },
      },
    },
  });
  for (const type of [12, 'MOTION_PHOTO', 10, 5, 19]) {
    const parsed = parseContent('m9', child(type));
    assert.equal(parsed.texto, '', String(type));
    assert.equal(parsed.anexos.length, 0, String(type));
  }
  // A real album video (MEDIA_ALBUM = 1) still shows.
  assert.equal(parseContent('m10', child(1)).anexos[0]?.type, 'video');
});

test('plain text and unknown real types still show', () => {
  assert.equal(parseContent('m5', { conversation: 'Viva' }).texto, 'Viva');
  // A type we do not render yet still leaves a trace, as before.
  assert.equal(parseContent('m6', { eventMessage: { name: 'Reunião' } }).texto, '[event]');
});
