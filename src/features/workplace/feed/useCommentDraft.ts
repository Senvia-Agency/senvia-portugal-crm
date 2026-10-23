import { useState } from 'react';
import { z } from 'zod';
export function useCommentDraft(storageKey: string, postId: string) {
  const key = `${storageKey}:comment:${encodeURIComponent(postId)}`;
  const [initial] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return { text: raw ? z.string().max(2000).parse(JSON.parse(raw)) : '', error: '', blocked: false };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return { text: '', error: 'Não foi possível recuperar o rascunho deste comentário. Os dados existentes foram preservados.', blocked: true };
    }
  });
  const [text, setText] = useState(initial.text);
  const [error, setError] = useState(initial.error);
  function change(next: string) {
    setText(next);
    try { window.localStorage.setItem(key, JSON.stringify(next)); setError(''); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      setError('O rascunho do comentário não foi guardado. O texto continua aberto; copie-o antes de sair.');
    }
  }
  function published() {
    try { window.localStorage.removeItem(key); setText(''); setError(''); return true; }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      setError('Comentário confirmado. Não foi possível limpar o rascunho guardado; tente novamente para confirmar sem duplicar.');
      return false;
    }
  }
  return { text, change, published, error, blocked: initial.blocked };
}
