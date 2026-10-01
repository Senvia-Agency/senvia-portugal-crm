import assert from 'node:assert/strict';
import test from 'node:test';
import { profilePictureUrlFromEvolutionResponse } from './evolution-contact-avatar.ts';

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
