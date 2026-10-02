import assert from 'node:assert/strict';
import test from 'node:test';
import {
  avatarUrlExpired, profilePictureUrlFromContacts, profilePictureUrlFromEvolutionResponse,
} from './evolution-contact-avatar.ts';

test('falls back to the photo in Evolution\'s own contact list', () => {
  const jid = '351931040317@s.whatsapp.net';
  const list = [
    { remoteJid: '351000000000@s.whatsapp.net', profilePicUrl: 'https://pps.whatsapp.net/other.jpg' },
    { remoteJid: jid, profilePicUrl: 'https://pps.whatsapp.net/nuno.jpg' },
  ];
  assert.equal(profilePictureUrlFromContacts(list, jid), 'https://pps.whatsapp.net/nuno.jpg');
  assert.equal(profilePictureUrlFromContacts([{ remoteJid: jid, profilePicUrl: null }], jid), null);
  assert.equal(profilePictureUrlFromContacts({ error: 'x' }, jid), null);
});

test('refreshes a WhatsApp photo whose signed link has expired', () => {
  const now = Date.parse('2026-10-02T09:00:00Z');
  const at = (iso: string) => Math.floor(Date.parse(iso) / 1000).toString(16).toUpperCase();
  assert.equal(avatarUrlExpired(null, now), true);
  assert.equal(avatarUrlExpired(`https://pps.whatsapp.net/v/x.jpg?oh=1&oe=${at('2026-10-20T00:00:00Z')}`, now), false);
  assert.equal(avatarUrlExpired(`https://pps.whatsapp.net/v/x.jpg?oh=1&oe=${at('2026-10-01T00:00:00Z')}`, now), true);
  // Expiring within a day counts as expired.
  assert.equal(avatarUrlExpired(`https://pps.whatsapp.net/v/x.jpg?oe=${at('2026-10-02T20:00:00Z')}`, now), true);
  // Links without an expiry are kept.
  assert.equal(avatarUrlExpired('https://cdn.example.pt/foto.jpg', now), false);
});

test('returns Evolution profile pictures that the inbox can render', () => {
  const url = profilePictureUrlFromEvolutionResponse({
    wuid: '351910000000@s.whatsapp.net',
    profilePictureUrl: 'https://pps.whatsapp.net/photo.jpg',
  });

  assert.equal(url, 'https://pps.whatsapp.net/photo.jpg');
});

test('uses initials when Evolution has no usable profile picture', () => {
  assert.equal(profilePictureUrlFromEvolutionResponse({ profilePictureUrl: null }), null);
  assert.equal(profilePictureUrlFromEvolutionResponse({ profilePictureUrl: 'http://example.test/photo.jpg' }), null);
  assert.equal(profilePictureUrlFromEvolutionResponse(null), null);
});
