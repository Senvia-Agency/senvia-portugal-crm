export interface PipelineStageIdentity { readonly id: string; readonly key: string }
export interface StageFilterResult { readonly matches: boolean; readonly reason?: string }

export function matchesStageTransition(
  config: Readonly<Record<string, unknown>>,
  currentStatus: unknown,
  previousStatus: unknown,
  stages: readonly PipelineStageIdentity[] = [],
): StageFilterResult {
  const resolve = (canonical: string, legacy: string): string | null | undefined => {
    const key = config[canonical];
    if (typeof key === 'string' && key) return key;
    const id = config[legacy];
    if (typeof id !== 'string' || !id) return undefined;
    return stages.find(stage => stage.id === id || stage.key === id)?.key ?? null;
  };
  const from = resolve('from_stage', 'from_stage_id');
  const to = resolve('to_stage', 'to_stage_id');
  if (from === null || to === null) return { matches: false, reason: 'A etapa configurada já não pertence a esta organização.' };
  if (from !== undefined && previousStatus !== from) return { matches: false, reason: 'outra etapa de origem' };
  if (to !== undefined && currentStatus !== to) return { matches: false, reason: 'outra etapa de destino' };
  if (typeof config.to_status === 'string' && config.to_status && currentStatus !== config.to_status) return { matches: false, reason: 'outro estado de destino' };
  return { matches: true };
}
