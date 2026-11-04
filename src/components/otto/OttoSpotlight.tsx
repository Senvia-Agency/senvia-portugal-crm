import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate, useLocation } from "react-router-dom";
import { useTourStore } from "@/stores/useTourStore";
import { useModalStore } from "@/stores/useModalStore";
import { getTour, type SpotlightStep } from "./tours";
import { OttoStepCard } from "./OttoStepCard";

interface Rect { top: number; left: number; width: number; height: number; }

// The same button can exist twice (the desktop top bar stays in the page, hidden,
// on a phone): only the one actually on screen counts.
function findTarget(id: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>(`[data-otto-target="${id}"]`)].find((el) => el.getClientRects().length > 0) ?? null;
}

// Opening and closing go through the button itself, the way a person would:
// Radix ignores a synthetic Escape or outside click, but its trigger toggles.
// Radix menus toggle on pointerdown, popovers and Otto on click, and the search
// (which only opens on click) toggles with its own Ctrl K.
const isSearch = (el: HTMLElement) => el.hasAttribute("data-workspace-search");
const isOpen = (el: HTMLElement) => isSearch(el)
  ? !!document.querySelector("[cmdk-root]")
  : el.getAttribute("aria-expanded") === "true" || el.getAttribute("aria-pressed") === "true";
function toggleTarget(el: HTMLElement) {
  if (isSearch(el)) document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  else if (el.getAttribute("aria-haspopup") === "menu") el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" }));
  else el.click();
}
function openTarget(el: HTMLElement) { if (!isOpen(el)) toggleTarget(el); }
function closeTarget(el: HTMLElement | null) {
  if (!el?.isConnected || !isOpen(el)) return;
  // The search dialog has its own close button: safer than a toggle that may
  // still be animating closed.
  const close = isSearch(el)
    ? document.querySelector("[cmdk-root]")?.closest('[role="dialog"]')?.querySelector<HTMLButtonElement>("button:last-of-type")
    : null;
  if (close) close.click();
  else toggleTarget(el);
}

const PADDING = 8;           // halo around the target
const FIND_TIMEOUT = 3500;   // give the target this long to mount after navigation
const OPTIONAL_TIMEOUT = 1500; // an optional step's target is either there quickly or not at all

// Renders the active tour: a dimmed page with a hole on the target, or — for a
// step that opens something — the opened menu/page itself with a ring on the
// button and the card at the bottom. Resilient: a target that never mounts falls
// back to a centered card, or is skipped when the step is optional.
export function OttoSpotlight() {
  const { tourId, step, next, prev, stop, complete, direction } = useTourStore();
  const openModal = useModalStore((s) => s.openModal);
  const navigate = useNavigate();
  const location = useLocation();

  const [rect, setRect] = useState<Rect | null>(null);
  const [resolved, setResolved] = useState(false); // step setup finished (found or fallback)
  const targetElRef = useRef<HTMLElement | null>(null);

  const tourDef = tourId ? getTour(tourId) : null;
  // Steps are dropped when the tour starts if what they need is not on screen
  // (an admin-only button, a module this organization does not use), so the
  // count the person sees (3 / 7) matches what they will be shown.
  const [steps, setSteps] = useState<SpotlightStep[] | null>(null);
  useEffect(() => {
    setSteps(tourDef ? tourDef.steps.filter((s) => {
      const need = s.requires ?? (s.skipIfMissing ? s.targetId : undefined);
      return !need || !!findTarget(need);
    }) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);
  const tour = tourDef && steps ? { ...tourDef, steps } : null;
  const stepDef = tour ? tour.steps[step] : null;

  // Auto-stop if the step index runs past the end.
  useEffect(() => {
    if (tour && step >= tour.steps.length) stop();
  }, [tour, step, stop]);

  const handleNext = useCallback(() => {
    if (!tour) return;
    if (step >= tour.steps.length - 1) complete();
    else next();
  }, [tour, step, next, complete]);

  // Run per-step setup: navigate, open modal, then locate (and maybe open) the target.
  useEffect(() => {
    if (!tour || !stepDef) return;
    let cancelled = false;
    setResolved(false);
    setRect(null);
    targetElRef.current = null;

    // 1. Navigate if needed.
    const alreadyThere = !stepDef.navigateTo || location.pathname + location.search === stepDef.navigateTo;
    if (!alreadyThere) navigate(stepDef.navigateTo!);
    // 2. Open a managed modal if needed.
    if (stepDef.openModal) openModal(stepDef.openModal);

    // 3. If no target, this is a centered card — resolve immediately.
    if (!stepDef.targetId) {
      setResolved(true);
      return;
    }

    // 4. Poll for the target to mount (handles route change + lazy render).
    const started = Date.now();
    const timeout = stepDef.optional && alreadyThere ? OPTIONAL_TIMEOUT : FIND_TIMEOUT;
    const tick = () => {
      if (cancelled) return;
      const el = findTarget(stepDef.targetId!);
      if (el) {
        targetElRef.current = el;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        if (stepDef.openTarget) openTarget(el);
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        setResolved(true);
        return;
      }
      if (Date.now() - started > timeout) {
        // Not for this person (an admin-only button): pass it, in the direction they are going.
        if (stepDef.optional) { if (direction === -1 && step > 0) prev(); else handleNext(); }
        else setResolved(true);             // give up → centered fallback
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (stepDef.openTarget) closeTarget(targetElRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId, step, steps]);

  // Keep the hole aligned on scroll/resize.
  useEffect(() => {
    if (!rect || !targetElRef.current) return;
    const update = () => {
      const el = targetElRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [rect]);

  // Advance when the user clicks the highlighted element.
  useEffect(() => {
    if (!stepDef?.advanceOnClick || !targetElRef.current) return;
    const el = targetElRef.current;
    const onClick = () => setTimeout(handleNext, 150);
    el.addEventListener("click", onClick, { once: true });
    return () => el.removeEventListener("click", onClick);
  }, [stepDef, resolved, handleNext]);

  if (!tour || !stepDef || !resolved) return null;

  const hole = rect
    ? { top: rect.top - PADDING, left: rect.left - PADDING, width: rect.width + PADDING * 2, height: rect.height + PADDING * 2 }
    : null;
  // A step that opened something shows it as it is: no dim, the card out of the way.
  const showOpened = !!stepDef.openTarget && !!hole;

  // Card placement, in pixels: the card animates its own transform, so a
  // translate here would be lost. Card is 300px wide (90vw on a phone).
  const cardWidth = Math.min(300, window.innerWidth * 0.9);
  const cardStyle: React.CSSProperties = showOpened
    ? { position: "fixed", bottom: 24, left: (window.innerWidth - cardWidth) / 2, zIndex: 100001 }
    : hole && stepDef.placement === "right"
    ? (() => {
        // Beside the target, level with its middle (a sidebar item, or the whole sidebar).
        const left = Math.min(hole.left + hole.width + 16, window.innerWidth - 312);
        const top = Math.min(Math.max(12, hole.top + hole.height / 2 - 80), window.innerHeight - 200);
        return { position: "fixed", top, left, zIndex: 100001 };
      })()
    : hole
    ? (() => {
        const below = hole.top + hole.height + 12;
        const fitsBelow = below + 160 < window.innerHeight;
        const top = fitsBelow ? below : Math.max(12, hole.top - 12 - 160);
        let left = hole.left + hole.width / 2 - 150;
        left = Math.max(12, Math.min(left, window.innerWidth - 312));
        return { position: "fixed", top, left, zIndex: 100001 };
      })()
    : { position: "fixed", top: Math.max(12, window.innerHeight / 2 - 90), left: (window.innerWidth - cardWidth) / 2, zIndex: 100001 };

  return createPortal(
    <div className="fixed inset-0 z-[100000]" style={{ pointerEvents: "none" }}>
      {/* Dim + spotlight hole. Box-shadow paints the dim. */}
      {showOpened ? null : hole ? (
        <motion.div
          key={`${tourId}-${step}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute rounded-xl otto-spotlight-hole"
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/60" style={{ pointerEvents: "auto" }} />
      )}

      {/* A step that only explains keeps the page still: a click on the highlighted
          button (or anywhere) would open its menu underneath the card. Steps that
          advance on a click, or show something opened, let the page be used. */}
      {hole && !showOpened && !stepDef.advanceOnClick && (
        <div className="absolute inset-0" style={{ pointerEvents: "auto" }} aria-hidden="true" />
      )}

      {/* Pulsing ring on the target. */}
      {hole && (
        <div
          className={`absolute rounded-xl ${stepDef.action === "glow" ? "otto-glow" : "otto-pulse"}`}
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
        />
      )}

      <AnimatePresence mode="wait">
        <OttoStepCard
          key={`${tourId}-${step}`}
          step={stepDef}
          index={step}
          total={tour.steps.length}
          onNext={handleNext}
          onBack={step > 0 ? prev : undefined}
          onExit={stop}
          style={cardStyle}
        />
      </AnimatePresence>
    </div>,
    document.body,
  );
}
