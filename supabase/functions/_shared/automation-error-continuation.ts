interface FailureNode {
  readonly id: string;
  readonly type: string;
  readonly config: Readonly<Record<string, unknown>>;
}
interface FailureEdge {
  readonly source: string;
  readonly target: string;
  readonly branch?: string | null;
}
const DECISIONS = new Set(['condition', 'router', 'wait_until', 'wait_reply', 'split_ab', 'ai_classify', 'ai_summarize', 'ai_extract', 'ai_draft']);
export function isDecisionAutomationNode(node: Pick<FailureNode, 'type' | 'config'>): boolean {
  return DECISIONS.has(node.type) || node.type.startsWith('request_')
    || (node.type === 'send_whatsapp' && node.config.wait_reply === true)
    || (node.type === 'send_email' && !!node.config.wait_event);
}
export function planAutomationErrorContinuation(node: FailureNode, edges: readonly FailureEdge[]):
  | { readonly kind: 'next'; readonly branch: 'default' | 'error' }
  | { readonly kind: 'fail'; readonly error: string } {
  if (node.config.on_error === 'error_branch') return { kind: 'next', branch: 'error' };
  const outgoing = edges.filter(edge => edge.source === node.id);
  const hasDefault = outgoing.some(edge => !edge.branch || edge.branch === 'default');
  const hasBusinessBranches = outgoing.some(edge => edge.branch && edge.branch !== 'default' && edge.branch !== 'error');
  if ((isDecisionAutomationNode(node) || hasBusinessBranches) && !hasDefault) {
    return { kind: 'fail', error: 'Não é possível continuar após falha num passo com decisões sem um caminho padrão explícito. Escolha Parar ou Caminho de erro.' };
  }
  return { kind: 'next', branch: 'default' };
}
