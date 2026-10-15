import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { DialogContainerContext, WorkspaceDialogContext } from '@/components/ui/portal-container';
import { useSidebarStore } from '@/stores/useSidebarStore';
import { useInboxWorkspace } from './InboxWorkspaceContext';

// A stable portal owner preserves open forms when the inbox is minimized.
export function InboxDialogBoundary({ children }: { readonly children: ReactNode }) {
  const workspace = useInboxWorkspace();
  const collapsed = useSidebarStore(state => state.collapsed);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const change = () => setDesktop(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  const docked = desktop && !!workspace?.enabled && workspace.pinned && !workspace.onInbox && !workspace.popup && !workspace.minimized;
  return <WorkspaceDialogContext.Provider value={docked}>
    <DialogContainerContext.Provider value={container ?? undefined}>{children}</DialogContainerContext.Provider>
    <div ref={setContainer} data-inbox-dialog-layer={docked ? 'docked' : undefined}
      className="pointer-events-none fixed inset-y-0 left-0 z-50"
      style={{ left: docked ? (collapsed ? '4rem' : '16rem') : 0, right: docked ? '28rem' : 0, transform: 'translateZ(0)', overflow: docked ? 'hidden' : undefined }} />
  </WorkspaceDialogContext.Provider>;
}
