import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { usePushNotifications } from "@/hooks/usePushNotifications";

const SHOWN_KEY = "push-reactivation-shown-v1";

/**
 * When this device had notifications on but lost its subscription (iPhone and
 * iPad revoke it, and only a tap can renew it there), say so once per visit
 * with a "Reativar" button. Without it the device just went quiet, and the
 * only trace was "Notificações desativadas" deep in the settings.
 */
export function PushReactivationPrompt() {
  const push = usePushNotifications();
  const latest = useRef(push);
  latest.current = push;

  useEffect(() => {
    if (!push.needsReactivation) return;
    try {
      if (window.sessionStorage.getItem(SHOWN_KEY)) return;
      window.sessionStorage.setItem(SHOWN_KEY, "1");
    } catch { /* private mode: show it anyway */ }
    toast("As notificações deste aparelho foram desligadas", {
      description: "O aparelho deixou de as receber. Toque em Reativar para voltar a receber alertas.",
      duration: Infinity,
      action: { label: "Reativar", onClick: () => { void latest.current.subscribe(); } },
      cancel: { label: "Não quero", onClick: () => latest.current.declineReactivation() },
    });
  }, [push.needsReactivation]);

  return null;
}
