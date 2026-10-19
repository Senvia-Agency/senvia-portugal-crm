import { useState } from 'react';
import type { ReactNode } from 'react';
import { DialogContainerContext, WorkspaceDialogContext } from '@/components/ui/portal-container';
import { useInboxWorkspace } from './InboxWorkspaceContext';
import { useSidebarStore } from '@/stores/useSidebarStore';

// A stable portal owner preserves open forms when the inbox is minimized.
export function InboxDialogBoundary({ children }: { readonly children: ReactNode }) {
  const workspace = useInboxWorkspace();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const docked = !!workspace?.docked;
  const sidebarCollapsed = useSidebarStore((state) => state.collapsed);
  return <WorkspaceDialogContext.Provider value={docked}>
    <DialogContainerContext.Provider value={container ?? undefined}>{children}</DialogContainerContext.Provider>
    <div ref={setContainer} data-inbox-dialog-layer={docked ? 'docked' : undefined}
      className="pointer-events-none fixed inset-y-0 left-0 z-50"
      style={{ left: docked ? (sidebarCollapsed ? '4rem' : '16rem') : 0, right: docked ? '28rem' : 0, transform: 'translateZ(0)', overflow: docked ? 'hidden' : undefined }} />
  </WorkspaceDialogContext.Provider>;
}
