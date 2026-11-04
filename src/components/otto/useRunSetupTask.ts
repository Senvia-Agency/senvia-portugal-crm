import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTourStore } from "@/stores/useTourStore";
import { useModalStore, type OttoManagedModal } from "@/stores/useModalStore";
import { useOttoStore } from "@/stores/useOttoStore";
import { useOttoChat } from "@/hooks/useOttoChat";
import type { OttoSetupTask } from "@/hooks/useOttoOnboarding";
import { tr } from "@/i18n";

// Shared dispatcher for a setup task's action, used by both the dashboard card and
// the in-chat kickoff so they behave identically:
//  - modal: open the real config modal (e.g. WhatsApp QR), close the chat
//  - tour:  start a spotlight tour, close the chat
//  - nav:   navigate to a page, close the chat
//  - chat:  open the chat and ask Otto to handle it (faturação/Brevo)
export function useRunSetupTask() {
  const navigate = useNavigate();
  const startTour = useTourStore((s) => s.start);
  const openModal = useModalStore((s) => s.openModal);
  const setOpen = useOttoStore((s) => s.setOpen);
  const { sendMessage } = useOttoChat();

  return useCallback((task: OttoSetupTask) => {
    switch (task.kind) {
      case "modal": setOpen(false); openModal(task.target as Exclude<OttoManagedModal, null>); break;
      case "tour": setOpen(false); startTour(task.target); break;
      case "nav": setOpen(false); navigate(task.target); break;
      case "chat": setOpen(true); sendMessage(tr(task.target)); break;
    }
  }, [navigate, startTour, openModal, setOpen, sendMessage]);
}
