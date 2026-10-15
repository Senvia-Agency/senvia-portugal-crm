import { useState } from 'react';
import { toast } from 'sonner';
import { readMessageDraft, writeMessageDraft } from '@/lib/inbox-drafts';

export function useMessageDraft(scope: string, conversation: string) {
  const key = `${scope}:${conversation}`;
  const [state, setState] = useState(() => ({ key, text: readMessageDraft(scope, conversation) }));
  const text = state.key === key ? state.text : readMessageDraft(scope, conversation);
  const setText = (next: string) => {
    if (!writeMessageDraft(scope, conversation, next)) {
      toast.error('Não foi possível proteger o rascunho neste navegador. Guarda o texto antes de sair.', { id: 'draft-storage-error' });
    }
    setState({ key, text: next });
  };
  return [text, setText] as const;
}
