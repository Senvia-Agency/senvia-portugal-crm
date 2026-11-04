import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { OttoAvatar } from "./OttoAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useInterfaceStore } from "@/stores/useInterfaceStore";
import { useOttoStore } from "@/stores/useOttoStore";
import { useTourStore } from "@/stores/useTourStore";
import { useLanguage } from "@/i18n";
import { cn } from "@/lib/utils";

// Per person, on this browser — like the language and the interface version.
// "off": "Não mostrar mais", or the tour was taken to its last step.
const storageKey = (userId: string) => `senvia2-guide-v2:${userId}`;
// "Agora não" only until the next session.
const laterKey = (userId: string) => `senvia2-guide-later-v2:${userId}`;

// The page the person was on when the tour began: it walks through several
// modules, then brings them back here.
let returnTo: string | null = null;

/** Whether the welcome card is on screen, so other Otto bubbles wait their turn. */
export const useSenvia2GuideCard = create<{ visible: boolean; setVisible: (visible: boolean) => void }>((set) => ({
  visible: false,
  setVisible: (visible) => set({ visible }),
}));

/**
 * Starts the Senvia 2.0 tour (desktop or phone version). It only counts as seen
 * once finished (see Senvia2Guide); left halfway — closed, or cut short by a
 * reload — the welcome card comes back next session.
 */
export function startSenvia2Guide(userId: string | undefined, isMobile: boolean) {
  if (userId) {
    try { sessionStorage.setItem(laterKey(userId), "1"); } catch { /* private mode */ }
  }
  returnTo = window.location.pathname + window.location.search;
  useSenvia2GuideCard.getState().setVisible(false);
  useOttoStore.getState().setOpen(false);
  useTourStore.getState().start(isMobile ? "senvia_2_mobile" : "senvia_2");
}

/**
 * The first time someone uses the new interface, Otto offers a one-minute tour.
 * Shown until they take it or choose "Não mostrar mais"; "Agora não" brings it
 * back next session. Can be replayed from the account menu.
 */
export function Senvia2Guide() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const legacy = useInterfaceStore((s) => s.legacy);
  const ottoOpen = useOttoStore((s) => s.isOpen);
  const touring = useTourStore((s) => !!s.tourId);
  const { visible, setVisible } = useSenvia2GuideCard();
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();

  // Tour over — finished or left halfway: back to where it started.
  useEffect(() => useTourStore.subscribe((state, prev) => {
    if (!prev.tourId?.startsWith("senvia_2") || state.tourId || !returnTo) return;
    const back = returnTo;
    returnTo = null;
    if (window.location.pathname + window.location.search !== back) navigate(back);
  }), [navigate]);

  // Finished to the last step: done for good.
  useEffect(() => useTourStore.subscribe((state, prev) => {
    if (!user?.id || state.completed === prev.completed || !state.completed?.startsWith("senvia_2")) return;
    try { localStorage.setItem(storageKey(user.id), "off"); } catch { /* private mode */ }
    setPending(false);
  }), [user?.id]);

  useEffect(() => {
    if (!user?.id) { setPending(false); return; }
    try {
      setPending(localStorage.getItem(storageKey(user.id)) !== "off" && sessionStorage.getItem(laterKey(user.id)) !== "1");
    } catch {
      setPending(false);
    }
  }, [user?.id]);

  // A short pause after the page settles, so the card does not land mid-load.
  const shouldShow = pending && !legacy && !ottoOpen && !touring;
  useEffect(() => {
    if (!shouldShow) { setVisible(false); return; }
    const timer = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(timer);
  }, [shouldShow, setVisible]);

  const later = () => {
    if (user?.id) { try { sessionStorage.setItem(laterKey(user.id), "1"); } catch { /* private mode */ } }
    setPending(false);
  };
  const never = () => {
    if (user?.id) { try { localStorage.setItem(storageKey(user.id), "off"); } catch { /* private mode */ } }
    setPending(false);
  };
  const start = () => {
    setPending(false);
    startSenvia2Guide(user?.id, isMobile);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 320, damping: 26 } }}
          exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.15 } }}
          className={cn(
            "fixed z-40 w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl",
            isMobile ? "bottom-24 right-3" : "bottom-6 right-6",
          )}
          role="dialog"
          aria-label={t("Guia do Senvia 2.0")}
        >
          <div className="h-1 w-full bg-gradient-to-r from-primary via-violet-500 to-fuchsia-500" />
          <div className="p-4">
            <button
              type="button"
              onClick={later}
              aria-label={t("Agora não")}
              className="absolute right-2 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex gap-3">
              <OttoAvatar expression="happy" size="md" />
              <div className="min-w-0 flex-1 pr-4">
                <p className="text-sm font-semibold text-foreground">{t("Bem-vindo ao novo Senvia OS")}</p>
                <p className="mt-1 text-sm leading-snug text-muted-foreground">
                  {t("Mudámos o visual. Mostro-lhe onde está tudo em menos de 1 minuto?")}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={never}
                className="mr-auto text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {t("Não mostrar mais")}
              </button>
              <button
                type="button"
                onClick={later}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
              >
                {t("Agora não")}
              </button>
              <button
                type="button"
                onClick={start}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t("Mostrar guia")}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
