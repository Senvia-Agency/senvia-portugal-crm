import { useState } from 'react';
import { z } from 'zod';
const intentSchema = z.object({ id: z.string().uuid(), body: z.string(), kind: z.enum(['publication', 'announcement', 'comment']) });
export type FeedIntent = z.infer<typeof intentSchema>;
export function useFeedIntent(key: string) {
  const [initial] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return { pending: raw ? intentSchema.parse(JSON.parse(raw)) : null, error: '' };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return { pending: null, error: 'Não foi possível recuperar a tentativa pendente. Os dados locais foram preservados.' };
    }
  });
  const [pending, setPending] = useState(initial.pending);
  function prepare(body: string, kind: FeedIntent['kind']) {
    if (initial.error) throw new Error(initial.error);
    if (pending) return pending;
    const intent = { id: crypto.randomUUID(), body, kind };
    window.localStorage.setItem(key, JSON.stringify(intent));
    setPending(intent);
    return intent;
  }
  function clear() { window.localStorage.removeItem(key); setPending(null); }
  return { pending, prepare, clear, error: initial.error };
}
