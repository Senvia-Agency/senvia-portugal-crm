import { useEffect } from "react";
import { createPortal } from "react-dom";
import { OttoChatWindow } from "./OttoChatWindow";
import { AnimatePresence } from "framer-motion";
import { useOttoStore } from "@/stores/useOttoStore";

// The Otto side panel portal. The floating action button was removed — Otto
// opens from the top bar, the sidebar/bottom-nav "Suporte / Otto" entry, or
// Ctrl+J (useOttoStore).
export function OttoFAB() {
  const { isOpen, setOpen } = useOttoStore();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        useOttoStore.getState().setOpen(!useOttoStore.getState().isOpen);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      <div className="pointer-events-auto">
        <AnimatePresence>{isOpen && <OttoChatWindow onClose={() => setOpen(false)} />}</AnimatePresence>
      </div>
    </div>,
    document.body
  );
}
