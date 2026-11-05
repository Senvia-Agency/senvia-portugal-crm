export interface BulkRetrySummary {
  readonly total: number;
  readonly queued: number;
  readonly completed: number;
  readonly active: number;
  readonly failed: number;
  readonly refused: number;
  readonly unknown: number;
}

export class InvalidBulkRetryResponse extends Error {}

export function summarizeBulkRetry(value: unknown): BulkRetrySummary {
  if (!value || typeof value !== 'object') throw new InvalidBulkRetryResponse('Resposta de repetição inválida.');
  if ('error' in value && typeof value.error === 'string') throw new InvalidBulkRetryResponse(value.error);
  if (!('results' in value) || !Array.isArray(value.results)) throw new InvalidBulkRetryResponse('O motor não devolveu os resultados dos percursos.');
  let queued = 0;
  let completed = 0;
  let active = 0;
  let failed = 0;
  let refused = 0;
  let unknown = 0;
  for (const row of value.results) {
    if (!row || typeof row !== 'object' || !('result' in row) || !row.result || typeof row.result !== 'object') { unknown++; continue; }
    const result = row.result;
    if ('queued' in result && result.queued === true) {
      if ('status' in result && result.status === 'waiting') queued++;
      else unknown++;
      continue;
    }
    if ('status' in result) {
      switch (result.status) {
        case 'completed': completed++; continue;
        case 'running': case 'waiting': case 'awaiting_reply': active++; continue;
        case 'failed': failed++; continue;
      }
    }
    if ('error' in result && typeof result.error === 'string') refused++;
    else unknown++;
  }
  return { total: value.results.length, queued, completed, active, failed, refused, unknown };
}
