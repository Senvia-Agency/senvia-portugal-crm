export interface NodeMetricStep {
  readonly run_id: string;
  readonly node_id: string;
  readonly status: string;
  readonly detail: unknown;
}

export function canonicalMetricNodeId(nodeId: string, detail: unknown): string {
  if (detail && typeof detail === 'object' && 'canonical_node_id' in detail
    && typeof detail.canonical_node_id === 'string' && detail.canonical_node_id) return detail.canonical_node_id;
  return nodeId;
}

export function countUniqueNodeRuns(steps: readonly NodeMetricStep[]): Record<string, { passed: number; failed: number }> {
  const result: Record<string, { passed: number; failed: number }> = {};
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.status !== 'ok' && step.status !== 'failed') continue;
    const nodeId = canonicalMetricNodeId(step.node_id, step.detail);
    const key = JSON.stringify([step.run_id, nodeId, step.status]);
    if (seen.has(key)) continue;
    seen.add(key);
    const count = result[nodeId] ?? { passed: 0, failed: 0 };
    if (step.status === 'ok') count.passed++;
    else count.failed++;
    result[nodeId] = count;
  }
  return result;
}
