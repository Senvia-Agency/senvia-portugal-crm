import type { AutomationRunStep } from '@/types/automations';

type StepIdentity = Pick<AutomationRunStep, 'node_id' | 'detail'>;

export function canonicalStepNodeId(step: StepIdentity): string | null {
  if (typeof step.detail?.canonical_node_id === 'string') return step.detail.canonical_node_id;
  const id = step.node_id;
  const encoded = id?.match(/^__visit:(.*):\d+$/)?.[1];
  if (!encoded) return id ?? null;
  try { return decodeURIComponent(encoded); } catch (error) {
    if (error instanceof URIError) return id ?? null;
    throw error;
  }
}

export function stepVisitNumber(step: StepIdentity): number {
  const visit = step.detail?.visit;
  if (typeof visit === 'number' && Number.isInteger(visit) && visit >= 0) return visit + 1;
  const encodedVisit = step.node_id?.match(/^__visit:.*:(\d+)$/)?.[1];
  return encodedVisit ? Number(encodedVisit) + 1 : 1;
}
