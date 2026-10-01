import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldDeliverVoiceRecording } from './voice-recording.ts';

test('does not deliver the final MediaRecorder chunk after cancellation', () => {
  assert.equal(shouldDeliverVoiceRecording({ cancelled: true, byteLength: 4_096 }), false);
});

test('delivers a completed voice recording above the accidental-touch threshold', () => {
  assert.equal(shouldDeliverVoiceRecording({ cancelled: false, byteLength: 4_096 }), true);
});
