import { isLeadVerificationMessage } from './lead-verification.ts';

export async function requestInboxTaskSuggestions(conversationId: string): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return;
  try {
    const response = await fetch(`${url}/functions/v1/inbox-task-suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ conversation_id: conversationId }),
      signal: AbortSignal.timeout(110_000),
    });
    if (!response.ok) console.error('[inbox-task-suggestions] dispatch failed', { status: response.status });
  } catch (error) {
    console.error('[inbox-task-suggestions] dispatch failed', { name: error instanceof Error ? error.name : 'unknown' });
  }
}

export function scheduleInboxTaskSuggestions(conversationId: string, text: string | null, sentAt: Date = new Date()): void {
  const content = text?.trim() ?? '';
  if (content.length < 15 || content.length > 1200 || isLeadVerificationMessage(content)
    || !Number.isFinite(sentAt.getTime()) || Math.abs(Date.now() - sentAt.getTime()) > 10 * 60_000) return;
  const task = requestInboxTaskSuggestions(conversationId);
  const runtime: unknown = Reflect.get(globalThis, 'EdgeRuntime');
  if (runtime && typeof runtime === 'object' && 'waitUntil' in runtime && typeof runtime.waitUntil === 'function') {
    runtime.waitUntil(task);
  }
}
