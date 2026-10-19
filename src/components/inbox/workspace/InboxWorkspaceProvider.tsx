import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { InboxWorkspaceContext } from './InboxWorkspaceContext';
import { InboxWorkspaceSurface } from './InboxWorkspaceSurface';
import { InboxDialogBoundary } from './InboxDialogBoundary';
import { useInboxWindow } from './useInboxWindow';

export function InboxWorkspaceProvider({ children, scope }: { readonly children: ReactNode; readonly scope: string }) {
  const preferenceKey = `senvia-inbox-workspace:${scope}`;
  const [enabled, setEnabled] = useState(() => localStorage.getItem(preferenceKey) !== 'off');
  const [pinned, setPinned] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [whatsappSelected, setWhatsAppSelected] = useState(false);
  const [dockEligible, setDockEligible] = useState(() => window.matchMedia('(min-width: 1440px)').matches);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const { popup, open, close } = useInboxWindow();
  const location = useLocation();
  const navigate = useNavigate();
  const onInbox = location.pathname === '/inbox' || location.pathname === '/inbox/';
  const docked = dockEligible && enabled && pinned && whatsappSelected && !onInbox && !minimized && !popup;
  useLayoutEffect(() => {
    const query = window.matchMedia('(min-width: 1440px)');
    const change = () => setDockEligible(query.matches);
    query.addEventListener('change', change);
    change();
    return () => query.removeEventListener('change', change);
  }, []);
  useLayoutEffect(() => { if (enabled && onInbox) setPinned(true); }, [enabled, onInbox]);
  const returnToInbox = useCallback(() => {
    close();
    setMinimized(false);
    navigate('/inbox');
  }, [close, navigate]);
  const toggleEnabled = useCallback(() => {
    const next = !enabled;
    localStorage.setItem(preferenceKey, next ? 'on' : 'off');
    setEnabled(next);
    setPinned(next);
    if (!next) {
      close();
      setPinned(false);
      setMinimized(false);
      navigate('/inbox');
    }
  }, [enabled, preferenceKey, close, navigate]);
  const value = useMemo(() => ({
    enabled, pinned, minimized, onInbox, popup, slot, setSlot, docked, whatsappSelected, setWhatsAppSelected,
    compact: !!popup || docked,
    pin: () => { setPinned(true); setMinimized(false); },
    minimize: () => { close(); setPinned(true); setMinimized(true); },
    restore: () => { close(); setMinimized(false); if (!dockEligible) navigate('/inbox'); },
    returnToInbox, toggleEnabled,
    openWindow: () => { setPinned(true); setMinimized(false); open(); },
  }), [enabled, pinned, minimized, onInbox, popup, slot, docked, dockEligible, whatsappSelected, navigate, close, open, returnToInbox, toggleEnabled]);
  return <InboxWorkspaceContext.Provider value={value}>
    <InboxDialogBoundary>{children}<InboxWorkspaceSurface /></InboxDialogBoundary>
  </InboxWorkspaceContext.Provider>;
}
