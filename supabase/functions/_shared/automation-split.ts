export class AutomationSplitError extends Error {}

export interface AutomationSplitVariant {
  readonly id: string;
  readonly label?: string;
  readonly weight: number;
}

function isVariant(value: unknown): value is AutomationSplitVariant {
  return typeof value === 'object' && value !== null && 'id' in value && 'weight' in value
    && typeof value.id === 'string' && value.id.trim().length > 0
    && typeof value.weight === 'number' && Number.isFinite(value.weight) && value.weight > 0;
}

export function deterministicAssignment(flowId: string, subjectKey: string, variants: unknown): string {
  if (!flowId.trim() || !subjectKey.trim()) throw new AutomationSplitError('A divisão precisa de uma automação e de um contacto identificável.');
  if (!Array.isArray(variants) || variants.length === 0 || !variants.every(isVariant)) {
    throw new AutomationSplitError('Configure caminhos com identificadores e percentagens positivas.');
  }
  const ids = new Set(variants.map(variant => variant.id));
  if (ids.size !== variants.length) throw new AutomationSplitError('Os identificadores dos caminhos não podem repetir-se.');
  const total = variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (Math.abs(total - 100) > 1e-9) throw new AutomationSplitError('As percentagens dos caminhos devem somar 100.');
  const key = JSON.stringify([flowId, subjectKey]);
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619) >>> 0;
  }
  const bucket = hash / 4294967296 * 100;
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight;
    if (bucket < cumulative) return variant.id;
  }
  return variants[variants.length - 1].id;
}
