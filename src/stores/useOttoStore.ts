import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type OttoMessage = {
  role: "user" | "assistant";
  content: string;
  attachmentPaths?: string[];
};

interface OttoStore {
  scope: string | null;
  setScope: (scope: string | null) => void;
  isOpen: boolean;
  messages: OttoMessage[];
  isLoading: boolean;
  pendingAttachments: File[];
  setOpen: (open: boolean) => void;
  addMessage: (msg: OttoMessage) => void;
  updateLastMessage: (content: string) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
  addAttachment: (file: File) => void;
  removeAttachment: (index: number) => void;
  clearAttachments: () => void;
}

export const useOttoStore = create<OttoStore>()(
  persist(
    (set) => ({
      scope: null,
      setScope: (scope) => set(s => s.scope === scope ? {} : { scope, messages: [], pendingAttachments: [], isLoading: false }),
      isOpen: false,
      messages: [],
      isLoading: false,
      pendingAttachments: [],
      setOpen: (open) => set({ isOpen: open }),
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
      clearMessages: () => set({ messages: [], pendingAttachments: [] }),
      setLoading: (loading) => set({ isLoading: loading }),
      addAttachment: (file) => set((s) => ({ pendingAttachments: [...s.pendingAttachments, file] })),
      removeAttachment: (index) => set((s) => ({
        pendingAttachments: s.pendingAttachments.filter((_, i) => i !== index),
      })),
      clearAttachments: () => set({ pendingAttachments: [] }),
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
