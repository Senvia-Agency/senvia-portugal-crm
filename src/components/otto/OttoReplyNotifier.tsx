import { useEffect } from "react";
import { toast } from "sonner";
import { useOttoStore } from "@/stores/useOttoStore";
import { tr } from "@/i18n";

// Otto's action markers ([botao:…], [link:…|…], …) and markdown, out of a preview line.
function preview(content: string) {
  return content
    .replace(/\[(botao|link|whatsapp|tour|modal):[^\]]*\]/g, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
}

/**
 * Otto keeps answering with the panel closed. When that answer is done, the
 * top-bar button starts blinking (store `unread`) and a toast offers to open it.
 * Always mounted, on every layout, so the notice never depends on the panel.
 */
export function OttoReplyNotifier() {
  useEffect(() => useOttoStore.subscribe((state, prev) => {
    if (!prev.isLoading || state.isLoading || state.isOpen || state.scope !== prev.scope) return;
    const last = state.messages[state.messages.length - 1];
    if (last?.role !== "assistant" || !last.content.trim()) return;
    state.setUnread(true);
    toast(tr("O Otto respondeu"), {
      id: "otto-reply",
      description: preview(last.content) || undefined,
      duration: 10_000,
      action: { label: tr("Ver"), onClick: () => useOttoStore.getState().setOpen(true) },
    });
  }), []);

  return null;
}
