import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Maximize2, MessageSquare } from 'lucide-react';
import { PortalContainerContext, DialogContainerContext, useDialogContainer } from '@/components/ui/portal-container';
import { Button } from '@/components/ui/button';
import { useInboxWorkspace } from './InboxWorkspaceContext';

const InboxContent = lazy(() => import('@/pages/Inbox').then((module) => ({ default: module.InboxContent })));

export function InboxWorkspaceSurface() {
  const workspace = useInboxWorkspace();
  const pageDialogContainer = useDialogContainer();
  const [host] = useState(() => {
    const node = document.createElement('div');
    node.className = 'relative flex h-full min-h-0 flex-col overflow-hidden bg-background';
    node.style.transform = 'translateZ(0)';
    return node;
  });
  const dockRef = useRef<HTMLDivElement>(null);
  const parkingRef = useRef<HTMLDivElement>(null);
  const visited = useRef(false);
  if (workspace?.onInbox) visited.current = true;
  const visiblePanel = !!workspace?.enabled && workspace.pinned && !workspace.onInbox && !workspace.popup && !workspace.minimized;
  useLayoutEffect(() => {
    if (!workspace) return;
    const target = workspace.popup?.document.body
      ?? (!workspace.minimized && workspace.onInbox ? workspace.slot : visiblePanel ? dockRef.current : parkingRef.current);
    if (target && host.parentElement !== target) target.append(host);
  }, [host, workspace, visiblePanel]);
  useLayoutEffect(() => () => { host.remove(); }, [host]);
  if (!workspace) return null;
  return <>
    <div ref={parkingRef} hidden />
    <aside aria-label="Inbox lateral" className={visiblePanel
      ? 'fixed inset-x-0 bottom-20 top-14 z-40 border-l bg-card shadow-lg lg:bottom-0 lg:left-auto lg:top-0 lg:w-[28rem]'
      : 'hidden'} ref={dockRef} />
    {workspace.enabled && ((workspace.pinned && !workspace.onInbox) || workspace.minimized || workspace.popup) && !visiblePanel &&
      <div data-inbox-workspace-control className="fixed bottom-24 right-4 z-[60] flex max-w-[calc(100vw-2rem)] items-center gap-1 rounded-xl border bg-card p-2 shadow-lg">
        <Button variant="ghost" size="sm" onClick={workspace.restore}><MessageSquare className="mr-2 h-4 w-4" />{workspace.popup ? 'Trazer Inbox para aqui' : 'Retomar Inbox'}</Button>
        <Button variant="ghost" size="icon" aria-label="Voltar ao Inbox" onClick={workspace.returnToInbox}><Maximize2 className="h-4 w-4" /></Button>
      </div>}
    {visited.current && createPortal(<PortalContainerContext.Provider value={workspace.popup?.document.body}><DialogContainerContext.Provider value={workspace.popup?.document.body ?? pageDialogContainer}><Suspense fallback={<Loader2 className="m-auto h-6 w-6 animate-spin" />}><InboxContent /></Suspense></DialogContainerContext.Provider></PortalContainerContext.Provider>, host)}
  </>;
}

export function InboxPageSlot() {
  const workspace = useInboxWorkspace();
  return <div className="h-dvh min-h-0" ref={workspace?.setSlot}>
    {(workspace?.popup || workspace?.minimized) && <p className="p-6 text-sm text-muted-foreground">O Inbox continua aberto. Usa “Retomar Inbox” para voltar.</p>}
  </div>;
}
