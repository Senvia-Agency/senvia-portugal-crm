import { renderAutomationTemplate } from "../../supabase/functions/_shared/automation-template";
export interface EditorChange {
  readonly section: string;
  readonly label: string;
  readonly before: string;
  readonly after: string;
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${key}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? '';
}
const labels: Readonly<Record<string, string>> = {
  message: 'Mensagem', subject: 'Assunto', html: 'Conteúdo do email', user_id: 'Responsável',
  channel_id: 'Caixa de envio', list_id: 'Lista', stage: 'Etapa', conditions: 'Condições',
  match: 'Combinação de condições', routes: 'Caminhos', amount: 'Duração', unit: 'Unidade',
  timeout_amount: 'Prazo de resposta', timeout_unit: 'Unidade do prazo', retry: 'Tentativas',
  on_error: 'Se falhar', trigger_type: 'Gatilho', trigger_config: 'Regras de entrada e saída',
  quiet_hours: 'Horário de silêncio', reentry_policy: 'Reentrada', max_steps_per_run: 'Limite de passos',
};
function valueLabel(value: unknown, key: string): string {
  if (/secret|password|authorization|token|headers/i.test(key)) return value == null ? 'Não definido' : 'Valor protegido';
  if (value === undefined || value === null || value === '') return 'Não definido';
  if (typeof value === 'boolean') return value ? 'Ligado' : 'Desligado';
  if (Array.isArray(value)) return value.slice(0, 10).map(item => valueLabel(item, key)).join('; ') + (value.length > 10 ? ` · mais ${value.length - 10}` : '');
  if (record(value)) return Object.entries(value).filter(([name]) => name !== 'id').map(([name, item]) => `${labels[name] ?? name}: ${valueLabel(item, name)}`).join(' · ');
  if (key === 'match') return value === 'all' ? 'Todas as condições' : value === 'any' ? 'Qualquer condição' : String(value);
  if (key === 'html') return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return String(value);
}
function nodes(snapshot: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const graph = record(snapshot.graph) ? snapshot.graph : {};
  const items = Array.isArray(graph.nodes) ? graph.nodes : [];
  return new Map(items.filter(record).filter(node => typeof node.id === 'string').map(node => [String(node.id), node]));
}
export function compareAutomationVersions(beforeValue: unknown, afterValue: unknown, describeType: (type: string) => string = type => type): readonly EditorChange[] {
  const before = record(beforeValue) ? beforeValue : {};
  const after = record(afterValue) ? afterValue : {};
  const changes: EditorChange[] = [];
  const oldNodes = nodes(before), newNodes = nodes(after);
  for (const id of new Set([...oldNodes.keys(), ...newNodes.keys()])) {
    const oldNode = oldNodes.get(id), newNode = newNodes.get(id);
    const section = `Passo ${describeType(String(newNode?.type ?? oldNode?.type ?? id))}`;
    if (!oldNode || !newNode) {
      changes.push({ section, label: oldNode ? 'Passo removido' : 'Passo adicionado', before: oldNode ? describeType(String(oldNode.type)) : 'Não existia', after: newNode ? describeType(String(newNode.type)) : 'Removido' });
      continue;
    }
    if (oldNode.type !== newNode.type) changes.push({ section, label: 'Tipo de passo', before: describeType(String(oldNode.type)), after: describeType(String(newNode.type)) });
    const oldConfig = record(oldNode.config) ? oldNode.config : {}, newConfig = record(newNode.config) ? newNode.config : {};
    for (const key of new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)])) {
      if (canonical(oldConfig[key]) !== canonical(newConfig[key])) changes.push({ section, label: labels[key] ?? key.replace(/_/g, ' '), before: valueLabel(oldConfig[key], key), after: valueLabel(newConfig[key], key) });
    }
  }
  for (const key of ['trigger_type', 'trigger_config', 'quiet_hours', 'reentry_policy', 'max_steps_per_run']) {
    if (canonical(before[key]) !== canonical(after[key])) changes.push({ section: 'Definições da automação', label: labels[key] ?? key, before: valueLabel(before[key], key), after: valueLabel(after[key], key) });
  }
  const edges = (snapshot: Record<string, unknown>) => {
    const graph = record(snapshot.graph) ? snapshot.graph : {};
    const byId = nodes(snapshot);
    return new Map((Array.isArray(graph.edges) ? graph.edges : []).filter(record).map(edge => [
      canonical([edge.source, edge.target, edge.branch ?? null]),
      `${describeType(String(byId.get(String(edge.source))?.type ?? 'passo'))} → ${describeType(String(byId.get(String(edge.target))?.type ?? 'passo'))} (${edge.branch ?? 'Continuar'})`,
    ]));
  };
  const oldEdges = edges(before), newEdges = edges(after);
  for (const [key, edge] of oldEdges) if (!newEdges.has(key)) changes.push({ section: 'Ligações', label: 'Ligação removida', before: edge, after: 'Removida' });
  for (const [key, edge] of newEdges) if (!oldEdges.has(key)) changes.push({ section: 'Ligações', label: 'Ligação adicionada', before: 'Não existia', after: edge });
  return changes;
}
export function renderAutomationPreview(template: string, variables: Readonly<Record<string, unknown>>, html = false): { readonly text: string; readonly missing: readonly string[]; readonly invalid?: readonly string[] } {
  const result = renderAutomationTemplate(template, variables, html);
  return result.invalid.length ? result : { text: result.text, missing: result.missing };
}
