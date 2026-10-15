import { createContext, useContext, useRef } from 'react';

export const PortalContainerContext = createContext<HTMLElement | undefined>(undefined);

export function usePortalContainer() {
  return useContext(PortalContainerContext);
}

export const WorkspaceDialogContext = createContext(false);
export function useWorkspaceDialog() { return useContext(WorkspaceDialogContext); }

export const DialogPresentationContext = createContext(false);
export function useDialogPresentation() { return useContext(DialogPresentationContext); }
export function useWorkspaceModalMode(open: boolean) {
  const docked = useWorkspaceDialog();
  const presentation = useRef(docked);
  if (!open) presentation.current = docked;
  return presentation.current;
}

export const DialogContainerContext = createContext<HTMLElement | undefined>(undefined);
export function useDialogContainer() {
  const dialog = useContext(DialogContainerContext);
  const fallback = usePortalContainer();
  return dialog ?? fallback;
}
