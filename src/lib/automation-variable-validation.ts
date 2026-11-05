import { renderAutomationTemplate } from '../../supabase/functions/_shared/automation-template.ts';
import type { AutomationGraph } from '../types/automations';

export function unknownTemplateVariables(text: string, available: readonly string[]): { readonly unknown: readonly string[]; readonly invalid: readonly string[] } {
  const keys = new Set(available);
  const unknown = new Set<string>();
  for (const match of text.matchAll(/\{\{([^{}]{1,512})\}\}/g)) {
    const key = match[1].split('|')[0].trim();
    if (/^[\w:]+(?:\.[\w:]+)*$/.test(key) && !keys.has(key) && !keys.has(key.split('.')[0])) unknown.add(key);
  }
  return { unknown: [...unknown], invalid: renderAutomationTemplate(text, {}).invalid };
}

export function validateAutomationVariableTemplates(graph: AutomationGraph, available: Readonly<Record<string, readonly string[]>> | undefined) {
  if (!available) return [];
  const issues: { nodeId: string; severity: 'warning'; message: string }[] = [];
  const texts = (value: unknown): string[] => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(texts);
    if (value && typeof value === 'object') return Object.values(value).flatMap(texts);
    return [];
  };
  for (const node of graph.nodes) {
    const seen = new Set<string>();
    for (const text of texts(node.config)) {
      const result = unknownTemplateVariables(text, available[node.id] ?? []);
      for (const key of result.unknown) seen.add(`A variável {{${key}}} não está no catálogo de entrada deste passo. Confirme os dados do gatilho ou de um passo anterior.`);
      for (const expression of result.invalid) seen.add(`A expressão {{${expression}}} tem uma sintaxe de variável inválida.`);
    }
    for (const message of seen) issues.push({ nodeId: node.id, severity: 'warning', message });
  }
  return issues;
}
