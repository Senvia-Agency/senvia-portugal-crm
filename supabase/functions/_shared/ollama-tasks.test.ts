import { resolveExplicitDeadline, classifyOllamaTask } from './ollama-tasks.ts';
Deno.test('resolves tomorrow at end of day in Lisbon without inventing a deadline', () => {
  const date = '2026-10-09T12:00:00Z';
  if (resolveExplicitDeadline('amanhã', date) !== '2026-10-10T22:59:00.000Z') throw new Error('Wrong Lisbon date');
  if (resolveExplicitDeadline(null, date) !== null || resolveExplicitDeadline('assim que possível', date) !== null) throw new Error('Inferred deadline');
});
Deno.test('uses winter offset and rejects invalid explicit calendar dates', () => {
  if (resolveExplicitDeadline('31/12/2026', '2026-10-09T12:00:00Z') !== '2026-12-31T23:59:00.000Z') throw new Error('Wrong winter offset');
  if (resolveExplicitDeadline('31/02/2027', '2026-10-09T12:00:00Z') !== null) throw new Error('Invalid date');
});
Deno.test('calls authenticated local provider and validates the model decision', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (input, init) => {
    if (String(input) !== 'https://mcp.senvia.pt/senvia-tasks/v1/classify' || new Headers(init?.headers).get('Authorization') !== 'Bearer test-key') throw new Error('Unsafe provider request');
    called = true;
    return Promise.resolve(Response.json({ tarefa: true, titulo: 'Enviar orçamento', confianca: .9, prazo_texto: 'amanhã', prazo_explicito: true }));
  };
  try {
    const out = await classifyOllamaTask({ sender: 'CLIENTE', message: 'Podes enviar o orçamento amanhã?', messageDate: '2026-10-09T12:00:00Z' }, 'https://mcp.senvia.pt/senvia-tasks/v1/classify', 'test-key');
    if (!called || out.prazo_iso !== '2026-10-10T22:59:00.000Z') throw new Error('Missing validated deadline');
  } finally { globalThis.fetch = original; }
});
Deno.test('resolves an explicit weekday and clock time in Lisbon', () => {
  if (resolveExplicitDeadline('segunda-feira às 10:30', '2026-10-09T12:00:00Z') !== '2026-10-12T09:30:00.000Z') throw new Error('Explicit weekday time was lost');
});
Deno.test('preserves a clock time before the autumn Lisbon DST transition', () => {
  if (resolveExplicitDeadline('25/10/2026 às 00:30', '2026-10-09T12:00:00Z') !== '2026-10-24T23:30:00.000Z') throw new Error('Wrong offset before clock change');
});
Deno.test('does not invent a nonexistent spring-transition clock time', () => {
  if (resolveExplicitDeadline('28/03/2027 às 01:30', '2026-10-09T12:00:00Z') !== null) throw new Error('Nonexistent local time accepted');
});
