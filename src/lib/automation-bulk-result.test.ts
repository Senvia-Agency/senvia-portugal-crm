import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeBulkRetry, InvalidBulkRetryResponse } from './automation-bulk-result.ts';

test('resumo distingue execução concluída, espera, nova falha e recusa', () => {
  const response = { results: [
    { result: { status: 'completed' } }, { result: { status: 'awaiting_reply' } },
    { result: { status: 'failed', error: 'indisponível' } }, { result: { error: 'já está ativo' } },
    { result: {} },
  ] };
  const summary = summarizeBulkRetry(response);
  assert.deepEqual(summary, { total: 5, queued: 0, completed: 1, active: 1, failed: 1, refused: 1, unknown: 1 });
});

test('lote vazio não afirma que houve percursos repetidos', () => {
  assert.equal(summarizeBulkRetry({ results: [] }).total, 0);
});

test('erro do motor e envelope inválido não são sucesso', () => {
  assert.throws(() => summarizeBulkRetry({ error: 'Sem autorização' }), /Sem autorização/);
  assert.throws(() => summarizeBulkRetry({}), InvalidBulkRetryResponse);
});

test('fila durável distingue agendados de percursos já ativos e estados antigos', () => {
  const summary = summarizeBulkRetry({ results: [
    { result: { status: 'waiting', queued: true } },
    { result: { status: 'waiting' } },
    { result: { status: 'running', queued: false } },
    { result: { status: 'completed' } },
    { result: { status: 'failed', error: 'falhou' } },
    { result: { error: 'não elegível' } },
  ] });
  assert.deepEqual(summary, { total: 6, queued: 1, completed: 1, active: 2, failed: 1, refused: 1, unknown: 0 });
});

test('marcador de fila com estado incompatível não confirma conclusão', () => {
  const summary = summarizeBulkRetry({ results: [{ result: { status: 'completed', queued: true } }] });
  assert.equal(summary.completed, 0);
  assert.equal(summary.unknown, 1);
});
