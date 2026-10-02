import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveEmailSignatureHtml } from './email-signature.ts';

test('uses the saved profile signature when the mailbox has no default signature', () => {
  // Given
  const profileSignature = '<p>Equipa Senvia</p>';

  // When
  const result = resolveEmailSignatureHtml({ mode: 'new', metadata: null, profileSignature });

  // Then
  assert.equal(result, '<br><br><div class="senvia-signature">--<br><p>Equipa Senvia</p></div>');
});

test('uses the mailbox default before the saved profile signature', () => {
  // Given
  const metadata = {
    signatures: [{ id: 'mailbox-default', name: 'Caixa', html: '<p>Caixa Senvia</p>' }],
    signature_default_new: 'mailbox-default',
  };

  // When
  const result = resolveEmailSignatureHtml({ mode: 'new', metadata, profileSignature: '<p>Perfil</p>' });

  // Then
  assert.equal(result, '<br><br><div class="senvia-signature">--<br><p>Caixa Senvia</p></div>');
});
