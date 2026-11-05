export interface ConditionGroupResult {
  readonly matched: boolean;
  readonly results: readonly boolean[];
}

export class InvalidConditionGroup extends Error {}

export async function evaluateConditionGroup(
  config: Readonly<Record<string, unknown>>,
  evaluate: (rule: Record<string, unknown>) => Promise<boolean>,
): Promise<ConditionGroupResult> {
  if (!Array.isArray(config.conditions) || config.conditions.length === 0) {
    throw new InvalidConditionGroup('O grupo precisa de pelo menos uma condição.');
  }
  if (config.match !== 'all' && config.match !== 'any') {
    throw new InvalidConditionGroup('Escolha Todas ou Qualquer para combinar as condições.');
  }
  const results: boolean[] = [];
  for (const rule of config.conditions) {
    if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
      throw new InvalidConditionGroup('Condição inválida no grupo.');
    }
    results.push(await evaluate(rule));
  }
  return {
    matched: config.match === 'all' ? results.every(Boolean) : results.some(Boolean),
    results,
  };
}

export function validateConditionTree(config: Readonly<Record<string, unknown>>, depth = 0): void {
  if (depth > 8) throw new InvalidConditionGroup('A condição excede oito níveis de grupos.');
  if (config.conditions !== undefined) {
    if (!Array.isArray(config.conditions) || !config.conditions.length || config.conditions.length > 100) throw new InvalidConditionGroup('O grupo deve ter de 1 a 100 regras.');
    if (config.match !== 'all' && config.match !== 'any') throw new InvalidConditionGroup('Escolha Todas ou Qualquer.');
    for (const rule of config.conditions) {
      if (typeof rule !== 'object' || !rule || Array.isArray(rule)) throw new InvalidConditionGroup('Regra inválida.');
      validateConditionTree(rule, depth + 1);
    }
    return;
  }
  if (typeof config.field !== 'string' || !config.field.trim()) throw new InvalidConditionGroup('Escolha o campo da condição.');
  const valueless = ['exists', 'not_exists', 'is_empty', 'is_not_empty', 'in_clients', 'in_leads', 'in_crm'];
  if (!valueless.includes(String(config.operator)) && config.value === undefined) throw new InvalidConditionGroup('Preencha o valor da condição.');
}
