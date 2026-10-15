import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

export function useInboxWindow() {
  const [popup, setPopup] = useState<Window | null>(null);
  const popupRef = useRef<Window | null>(null);
  const open = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
      return;
    }
    const next = window.open('', '', 'popup,width=720,height=850');
    if (!next) {
      toast.error('O navegador bloqueou a janela. Permite pop-ups para este site e tenta novamente.');
      return;
    }
    next.document.title = 'Inbox — Senvia OS';
    next.document.documentElement.lang = 'pt';
    next.document.documentElement.className = document.documentElement.className;
    const base = next.document.createElement('base');
    base.href = document.baseURI;
    next.document.head.append(base);
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      next.document.head.append(node.cloneNode(true));
    });
    const viewport = next.document.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width, initial-scale=1';
    next.document.head.append(viewport);
    next.document.body.className = 'm-0 h-dvh overflow-hidden bg-background text-foreground';
    popupRef.current = next;
    next.addEventListener('beforeunload', () => {
      if (popupRef.current !== next) return;
      popupRef.current = null;
      setPopup(null);
    }, { once: true });
    setPopup(next);
  }, []);
  const close = useCallback(() => {
    const current = popupRef.current;
    popupRef.current = null;
    setPopup(null);
    current?.close();
  }, []);
  useEffect(() => {
    const cleanup = () => {
      popupRef.current?.close();
      popupRef.current = null;
    };
    window.addEventListener('beforeunload', cleanup);
    return () => {
      window.removeEventListener('beforeunload', cleanup);
      cleanup();
    };
  }, []);
  return { popup, open, close };
}
