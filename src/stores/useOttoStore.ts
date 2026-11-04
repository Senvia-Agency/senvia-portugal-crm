import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type OttoMessage = {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly attachmentPaths?: readonly string[];
};

export const OTTO_ACTION_STATUSES = ["succeeded", "failed", "denied", "expired", "cancelled"] as const;
export type OttoActionStatus = (typeof OTTO_ACTION_STATUSES)[number];

export type OttoActionPreview = {
  readonly confirmationId: string;
  readonly expiresAt: string;
  readonly title: string;
  readonly summary: string;
  readonly destination: string;
};

export type OttoActionResult = {
  readonly status: OttoActionStatus;
  readonly summary: string;
  readonly error?: string;
  readonly operation?: string;
  readonly resource?: {
    readonly type: string;
    readonly id: string;
    readonly route: string;
  };
  readonly invalidateQueryKeys?: readonly (readonly string[])[];
};

interface OttoStore {
  scope: string | null;
  setScope: (scope: string | null) => void;
  isOpen: boolean;
  /** A reply finished while the panel was closed and has not been seen yet. */
  unread: boolean;
  setUnread: (unread: boolean) => void;
  messages: OttoMessage[];
  isLoading: boolean;
  pendingAttachments: File[];
  pendingAction: OttoActionPreview | null;
  actionResult: OttoActionResult | null;
  setOpen: (open: boolean) => void;
  addMessage: (msg: OttoMessage) => void;
  updateLastMessage: (content: string) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
  addAttachment: (file: File) => void;
  removeAttachment: (index: number) => void;
  clearAttachments: () => void;
  setPendingAction: (action: OttoActionPreview, scope: string) => void;
  setActionResult: (result: OttoActionResult, scope: string) => void;
  clearActionState: () => void;
}

export const useOttoStore = create<OttoStore>()(
  persist(
    (set) => ({
      scope: null,
      setScope: (scope) => set(s => s.scope === scope ? {} : {
        scope,
        messages: [],
        pendingAttachments: [],
        isLoading: false,
        pendingAction: null,
        actionResult: null,
      }),
      isOpen: false,
      unread: false,
      setUnread: (unread) => set({ unread }),
      messages: [],
      isLoading: false,
      pendingAttachments: [],
      pendingAction: null,
      actionResult: null,
      setOpen: (open) => set(open ? { isOpen: true, unread: false } : { isOpen: false }),
      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      updateLastMessage: (content) =>
        set((s) => {
          const msgs = [...s.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant") {
            msgs[msgs.length - 1] = { ...last, content };
          } else {
            msgs.push({ role: "assistant", content });
          }
          return { messages: msgs };
        }),
      clearMessages: () => set({ messages: [], pendingAttachments: [], pendingAction: null, actionResult: null }),
      setLoading: (loading) => set({ isLoading: loading }),
      addAttachment: (file) => set((s) => ({ pendingAttachments: [...s.pendingAttachments, file] })),
      removeAttachment: (index) => set((s) => ({
        pendingAttachments: s.pendingAttachments.filter((_, i) => i !== index),
      })),
      clearAttachments: () => set({ pendingAttachments: [] }),
      setPendingAction: (action, scope) => set((state) => state.scope === scope
        ? { pendingAction: action, actionResult: null }
        : {}),
      setActionResult: (result, scope) => set((state) => state.scope === scope
        ? { actionResult: result, pendingAction: null }
        : {}),
      clearActionState: () => set({ pendingAction: null, actionResult: null }),
    }),
    {
      name: "otto-chat-store",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        scope: state.scope,
        isOpen: state.isOpen,
        messages: state.messages,
      }),
    }
  )
);
