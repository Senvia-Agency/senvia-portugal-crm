import assert from 'node:assert/strict';
import test from 'node:test';

import { createMetaMessageSendPlan } from './meta-message-send-plan.ts';

test('sends a pasted image and its text as one attachment with a caption', () => {
  // Given
  const attachment = { id: 'image-1' };

  // When
  const plan = createMetaMessageSendPlan({ attachments: [attachment], text: 'Resumo das contas', replyToMid: null });

  // Then
  assert.deepEqual(plan, [{ kind: 'attachment', attachment, caption: 'Resumo das contas', replyToMid: null }]);
});

test('keeps a plain-text message as text when there are no attachments', () => {
  // Given / When
  const plan = createMetaMessageSendPlan({ attachments: [], text: 'Olá', replyToMid: 'message-1' });

  // Then
  assert.deepEqual(plan, [{ kind: 'text', text: 'Olá', replyToMid: 'message-1' }]);
});
