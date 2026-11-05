import type { AutomationGraph } from '@/types/automations';
import { getNodeDefinition } from '@/lib/automation-nodes';

export function copyAutomationFragment(graph: AutomationGraph, rootId: string, descendants = false): AutomationGraph {
  const included = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    if (!id || included.has(id)) continue;
    const node = graph.nodes.find(item => item.id === id);
    if (!node || getNodeDefinition(node.type)?.isTrigger) continue;
    included.add(id);
    if (descendants) queue.push(...graph.edges.filter(edge => edge.source === id).map(edge => edge.target));
  }
  return structuredClone({
    nodes: graph.nodes.filter(node => included.has(node.id)),
    edges: graph.edges.filter(edge => included.has(edge.source) && included.has(edge.target)),
  });
}

export function pasteAutomationFragment(graph: AutomationGraph, fragment: AutomationGraph): AutomationGraph {
  const nodes = fragment.nodes.filter(node => !getNodeDefinition(node.type)?.isTrigger);
  if (!nodes.length) return graph;
  const ids = new Map(nodes.map(node => [node.id, `node_${crypto.randomUUID()}`]));
  const right = Math.max(0, ...graph.nodes.map(node => node.position?.x ?? 0)) + 300;
  const left = Math.min(...nodes.map(node => node.position?.x ?? 0));
  return {
    nodes: [...graph.nodes, ...nodes.flatMap(node => {
      const id = ids.get(node.id);
      return id ? [{ ...structuredClone(node), id, position: { x: (node.position?.x ?? 0) - left + right, y: node.position?.y ?? 0 } }] : [];
    })],
    edges: [...graph.edges, ...fragment.edges.flatMap(edge => {
      const source = ids.get(edge.source);
      const target = ids.get(edge.target);
      return source && target ? [{ ...structuredClone(edge), id: `edge_${crypto.randomUUID()}`, source, target }] : [];
    })],
  };
}
