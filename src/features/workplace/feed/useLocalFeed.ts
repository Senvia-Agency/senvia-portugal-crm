import { useEffect, useRef, useState } from 'react';
import { emptyFeed, readFeed, writeFeed, type FeedState } from './feed-storage';
export function useLocalFeed(key: string) {
  const [initial] = useState(() => {
    try { return { state: readFeed(window.localStorage, key), blocked: false }; }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      return { state: emptyFeed(), blocked: true };
    }
  });
  const [state, setState] = useState(initial.state);
  const pendingUnsaved = useRef(false);
  const [error, setError] = useState(initial.blocked ? 'Não foi possível recuperar o Feed local. Os dados guardados não foram substituídos.' : '');
  useEffect(() => {
    function refresh(event: StorageEvent) {
      if (event.key !== key || pendingUnsaved.current || initial.blocked) return;
      try { setState(readFeed(window.localStorage, key)); setError(''); }
      catch (error) {
        if (!(error instanceof Error)) throw error;
        setError('Não foi possível atualizar o Feed a partir da outra janela. O conteúdo aberto foi preservado.');
      }
    }
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [key, initial.blocked]);
  function save(next: FeedState, keepDraft = false) {
    if (initial.blocked) return false;
    try {
      writeFeed(window.localStorage, key, next);
      pendingUnsaved.current = false;
      setState(next); setError(''); return true;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (keepDraft) { setState(next); pendingUnsaved.current = true; }
      setError('Não foi possível guardar neste navegador. O texto continua aberto; copie-o antes de sair ou tente novamente.');
      return false;
    }
  }
  return { state, save, error, blocked: initial.blocked };
}
