import { createContext, useContext } from 'react';

export interface InboxWorkspaceState {
  readonly enabled: boolean;
  readonly pinned: boolean;
  readonly minimized: boolean;
  readonly docked: boolean;
  readonly compact: boolean;
  readonly whatsappSelected: boolean;
  readonly setWhatsAppSelected: (selected: boolean) => void;
  readonly onInbox: boolean;
  readonly popup: Window | null;
  readonly slot: HTMLElement | null;
  readonly setSlot: (slot: HTMLElement | null) => void;
  readonly pin: () => void;
  readonly minimize: () => void;
  readonly restore: () => void;
  readonly returnToInbox: () => void;
  readonly toggleEnabled: () => void;
  readonly openWindow: () => void;
}

export const InboxWorkspaceContext = createContext<InboxWorkspaceState | null>(null);

export function useInboxWorkspace() {
  return useContext(InboxWorkspaceContext);
}
