export interface JumpNode { readonly id: string; readonly type: string }
export interface JumpGraph {
  readonly nodes: readonly JumpNode[];
  readonly edges: readonly { readonly source: string; readonly target: string }[];
}
export class InvalidAutomationJump extends Error {}
type Context = Readonly<Record<string, unknown>>;
const PREFIX = '__visit:';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function counter(context: Context, name: string, id: string): number {
  const values = context[name];
  const value = object(values) ? values[id] : undefined;
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new InvalidAutomationJump('Estado de repetição inválido.');
  return value;
}
export function stepVisit(context: Context, nodeId: string): number {
  return counter(context, '__node_visits', nodeId);
}
export function visitStepKey(context: Context, nodeId: string): string {
  const visit = stepVisit(context, nodeId);
  return visit === 0 ? nodeId : `${PREFIX}${encodeURIComponent(nodeId)}:${visit}`;
}
export function currentVisitExecutedNodes(
  context: Context,
  nodes: readonly JumpNode[],
  rows: readonly { readonly node_id: string }[],
): Set<string> {
  const keys = new Set(rows.map(row => row.node_id));
  return new Set(nodes.filter(node => keys.has(visitStepKey(context, node.id))).map(node => node.id));
}
function reachable(graph: JumpGraph, start: string, reverse: boolean): Set<string> {
  const found = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift();
    if (id === undefined || found.has(id)) continue;
    found.add(id);
    for (const edge of graph.edges) {
      if ((reverse ? edge.target : edge.source) === id) queue.push(reverse ? edge.source : edge.target);
    }
  }
  return found;
}
export type JumpDecision =
  | { readonly kind: 'continue'; readonly context: Record<string, unknown> }
  | { readonly kind: 'jump'; readonly target: string; readonly region: readonly string[]; readonly context: Record<string, unknown> };

export function planBoundedJump(
  graph: JumpGraph,
  context: Context,
  request: Readonly<{ nodeId: string; target: unknown; maxVisits: unknown; pendingNodeIds?: readonly string[]; entryNodeId?: string | null }>,
): JumpDecision {
  if (typeof request.target !== 'string' || !request.target || request.target === request.nodeId) throw new InvalidAutomationJump('Escolha um passo anterior diferente deste.');
  if (typeof request.maxVisits !== 'number' || !Number.isInteger(request.maxVisits) || request.maxVisits < 1 || request.maxVisits > 20) throw new InvalidAutomationJump('Defina de 1 a 20 passagens pelo segmento.');
  if (graph.nodes.some(node => node.id.startsWith(PREFIX))) throw new InvalidAutomationJump('Os identificadores dos passos usam um prefixo reservado.');
  const target = graph.nodes.find(node => node.id === request.target);
  const current = graph.nodes.find(node => node.id === request.nodeId);
  if (!target || !current || request.target === request.entryNodeId || target.type === 'trigger') throw new InvalidAutomationJump('O destino deve ser um passo existente depois do gatilho.');
  const forwards = reachable(graph, request.target, false);
  if (!forwards.has(request.nodeId)) throw new InvalidAutomationJump('O destino não pertence a um caminho anterior deste passo.');
  const backwards = reachable(graph, request.nodeId, true);
  const region = [...forwards].filter(id => backwards.has(id));
  if (region.includes(request.entryNodeId ?? '')) throw new InvalidAutomationJump('A repetição não pode incluir o gatilho.');
  const jumps = counter(context, '__jump_counts', request.nodeId);
  if (jumps >= request.maxVisits - 1) return { kind: 'continue', context: { ...context } };
  if (request.pendingNodeIds?.some(id => region.includes(id))) throw new InvalidAutomationJump('Aguarde os outros caminhos deste segmento antes de o repetir.');
  const visits = object(context.__node_visits) ? { ...context.__node_visits } : {};
  const counts = object(context.__jump_counts) ? { ...context.__jump_counts } : {};
  const next: Record<string, unknown> = { ...context };
  for (const id of region) {
    visits[id] = stepVisit(context, id) + 1;
    if (id !== request.nodeId) delete counts[id];
    delete next[`__wait_deadline_${id}`];
    delete next[`__retry_${id}`];
    delete next[`__email_wait_${id}`];
  }
  counts[request.nodeId] = jumps + 1;
  next.__node_visits = visits;
  next.__jump_counts = counts;
  return { kind: 'jump', target: request.target, region, context: next };
}

export function canonicalStepNodeId(stepKey: string): string {
  if (!stepKey.startsWith(PREFIX)) return stepKey;
  const separator = stepKey.lastIndexOf(':');
  if (separator <= PREFIX.length || !/^[1-9][0-9]*$/.test(stepKey.slice(separator + 1))) return stepKey;
  try { return decodeURIComponent(stepKey.slice(PREFIX.length, separator)); }
  catch (error) { if (error instanceof URIError) return stepKey; throw error; }
}
