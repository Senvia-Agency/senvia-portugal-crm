import { useOttoStore } from "@/stores/useOttoStore";
import { useOttoOnboarding } from "@/hooks/useOttoOnboarding";
import { useLanguage } from "@/i18n";
import { cn } from "@/lib/utils";

const ottoMascot = "/otto-mascot.svg";

/**
 * Opens and closes Otto's side panel from the top bar (also Ctrl+J, see OttoFAB).
 * With the panel closed it shows what Otto is doing: a soft pulse while he is
 * still answering, and a blinking green dot once the answer is waiting.
 */
export function OttoTopbarButton() {
  const { t } = useLanguage();
  const isOpen = useOttoStore((s) => s.isOpen);
  const setOpen = useOttoStore((s) => s.setOpen);
  const unread = useOttoStore((s) => s.unread);
  const working = useOttoStore((s) => s.isLoading) && !isOpen;
  const { showBadge } = useOttoOnboarding();

  const label = isOpen ? t("Fechar o Otto")
    : unread ? t("O Otto respondeu")
    : working ? t("O Otto está a responder…")
    : t("Perguntar ao Otto");

  return (
    <button
      type="button"
      data-otto-target="guide-otto"
      className={cn("workplace-header-icon relative", unread && "otto-topbar-unread")}
      aria-label={label}
      aria-pressed={isOpen}
      title={isOpen ? label : `${label} (Ctrl J)`}
      onClick={() => setOpen(!isOpen)}
    >
      <img src={ottoMascot} alt="" aria-hidden="true" className={cn("h-6 w-6 rounded-full object-cover", working && "animate-pulse")} />
      {unread ? (
        <span className="absolute right-1 top-1 flex h-2.5 w-2.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#10172a]" />
        </span>
      ) : working ? (
        <span className="absolute right-1 top-1 h-2 w-2 animate-pulse rounded-full bg-sky-400 ring-2 ring-[#10172a]" aria-hidden="true" />
      ) : showBadge ? (
        <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-[#10172a]" aria-hidden="true" />
      ) : null}
    </button>
  );
}
