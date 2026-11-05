export interface PersistedReply {
  readonly text: string;
  readonly receivedAt: string;
}
export function eligiblePersistedReply(
  context: Readonly<Record<string, unknown>>, nodeId: string, fallbackAfter: string | null,
  deadline: string | null,
): PersistedReply | null {
  const text = context.ultima_resposta;
  const timestamp = context.ultima_resposta_received_at;
  const after = context['__reply_after_' + nodeId] ?? fallbackAfter;
  if (typeof text !== 'string' || !text.trim() || typeof timestamp !== 'string' || typeof after !== 'string') return null;
  const received = Date.parse(timestamp), cutoff = Date.parse(after);
  const consumed = typeof context.__reply_consumed_at === 'string' ? Date.parse(context.__reply_consumed_at) : -Infinity;
  if (!Number.isFinite(received) || !Number.isFinite(cutoff) || received <= cutoff || received <= consumed) return null;
  if (deadline !== null && (!Number.isFinite(Date.parse(deadline)) || received > Date.parse(deadline))) return null;
  return { text, receivedAt: timestamp };
}
export function replyRuleBranch(text: string, rules: readonly { readonly id: string; readonly keywords?: readonly string[]; readonly label?: string }[]) {
  const lower = text.toLowerCase(), exact = lower.trim();
  const matched = rules.find((rule, index) => (rule.keywords ?? []).some(keyword => lower.includes(keyword.toLowerCase()))
    || (rule.label && exact === rule.label.toLowerCase()) || exact === String(index + 1));
  return { branch: matched?.id ?? 'fallback', label: matched?.label ?? null };
}
