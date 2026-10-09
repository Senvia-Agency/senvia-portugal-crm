import { eligibleMessage, matchesServiceKey, parseTaskDecision, SuggestionError } from './inbox-task-suggestions.ts';

const now = Date.parse('2026-10-08T12:00:00Z');
Deno.test('suggests a confident concrete request with a future explicit deadline', () => {
  // Given
  const decision = { tarefa: true, titulo: 'Enviar proposta', confianca: .9, prazo_iso: '2026-10-09T09:00:00Z', prazo_explicito: true };
  // When
  const result = parseTaskDecision(decision, now);
  // Then
  if (result?.title !== 'Enviar proposta' || result.dueAt !== '2026-10-09T09:00:00.000Z') throw new Error('Missing suggestion');
});
Deno.test('rejects malformed model output as an upstream failure', () => {
  for (const input of [null, {}, { tarefa: true, confianca: '1' }]) {
    let error: unknown;
    try { parseTaskDecision(input, now); } catch (caught) { error = caught; }
    if (!(error instanceof SuggestionError)) throw new Error('Malformed decision silently accepted');
  }
});
Deno.test('requires exact service key equality', async () => {
  if (!await matchesServiceKey('secret', 'secret') || await matchesServiceKey('secret ', 'secret') || await matchesServiceKey('secreu', 'secret')) throw new Error('Service authentication failed');
});
Deno.test('excludes deleted, OTP, attachment placeholders and replayed old messages', () => {
  const message = { id: '11111111-1111-4111-8111-111111111111', content: 'Pode enviar uma proposta?', direction: 'incoming' as const, is_deleted: false, created_at: new Date(now).toISOString(), sent_at: null };
  if (!eligibleMessage(message, now)) throw new Error('Concrete request excluded');
  for (const excluded of [{ ...message, is_deleted: true }, { ...message, content: 'SENVIA CONFIRMAR 12345678901234567890123456789012' }, { ...message, content: '[imagem sem texto]' }, { ...message, sent_at: '2026-09-01T12:00:00Z' }]) {
    if (eligibleMessage(excluded, now)) throw new Error('Unsafe message analyzed');
  }
});
Deno.test('rejects social or low confidence decisions', () => {
  // Given
  const decisions = [{ tarefa: false, titulo: 'Olá', confianca: 1 }, { tarefa: true, titulo: 'Enviar proposta', confianca: .74 }];
  // When
  const results = decisions.map(value => parseTaskDecision(value, now));
  // Then
  if (results.some(Boolean)) throw new Error('Noise accepted');
});
Deno.test('limits titles and excludes inferred or past deadlines', () => {
  // Given
  const decision = { tarefa: true, titulo: 'a'.repeat(200), confianca: .75, prazo_iso: '2026-10-07T09:00:00Z', prazo_explicito: true };
  // When
  const result = parseTaskDecision(decision, now);
  // Then
  if (result?.title.length !== 160 || result.dueAt !== null) throw new Error('Unsafe deadline or title');
});
