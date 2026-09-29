import assert from 'node:assert/strict';
import test from 'node:test';

import { whatsappAutomationIssue } from './automation-whatsapp.ts';

test('requires an explicit WhatsApp channel before activation', () => {
  assert.equal(
    whatsappAutomationIssue({ message: 'Olá {{nome}}' }),
    'Escolhe a caixa de WhatsApp que envia esta mensagem.',
  );
});

test('accepts a configured message with an explicit channel', () => {
  assert.equal(whatsappAutomationIssue({
    channel_id: '67ee1712-e1c7-4d78-831d-ae0e79b59118',
    message: 'Olá {{nome}}',
  }), null);
});
