import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ErrorBoundary, reloadOnce } from "./components/ErrorBoundary";
import { PaidTrafficFilterProvider } from "@/contexts/PaidTrafficFilterContext";
import { loadSenviaPixel } from "@/lib/senvia-pixel";

// When a lazily-loaded chunk fails to preload (e.g. a new deploy replaced the
// hashed files while this tab was open), Vite fires `vite:preloadError`.
// Auto-reload (once) instead of leaving the user on a blank screen.
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (e) => {
    e.preventDefault();
    reloadOnce();
  });

  // Log unhandled async errors to console AND localStorage so they survive a
  // browser freeze (console is inaccessible when the tab hangs).
  const saveErrorLog = (label: string, err: unknown) => {
    try {
      const msg = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err);
      const entry = `[${new Date().toISOString()}] ${label}: ${msg}`;
      console.error(entry);
      const prev = sessionStorage.getItem("app:error-log") ?? "";
      sessionStorage.setItem("app:error-log", (prev + "\n" + entry).slice(-4000));
    } catch { /* noop */ }
  };
  window.addEventListener("unhandledrejection", (e) => saveErrorLog("UnhandledRejection", e.reason));
  window.addEventListener("error", (e) => { if (e.error) saveErrorLog("GlobalError", e.error); });
}

// Register a lightweight push-notification service worker — production only.
// Skipped in dev: skipWaiting()+clients.claim() interfere with Vite HMR
// (the SW takes control of the page mid-session, breaking the WS connection
// and resetting React state). Push notifications don't exist in dev anyway.
if (typeof window !== "undefined" && "serviceWorker" in navigator && !import.meta.env.DEV) {
  (async () => {
    try {
      // Unregister any legacy SW that isn't our push worker
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        if (r.active?.scriptURL && !r.active.scriptURL.endsWith("/sw.js")) {
          await r.unregister().catch(() => {});
        }
      }
      // Register with updateViaCache:'none' to force network fetch (bypass CDN/browser cache)
      await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
    } catch {
      // Non-critical — app works without SW, just no push notifications
    }
  })();
} else if (import.meta.env.DEV && typeof window !== "undefined" && "serviceWorker" in navigator) {
  // In dev: unregister any SW that might have been left over from a previous
  // production build served locally, so it doesn't interfere with HMR.
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  }).catch(() => {});
}

// Senvia's Meta pixel — never on a client's public form (see senvia-pixel.ts).
loadSenviaPixel();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <PaidTrafficFilterProvider>
      <App />
    </PaidTrafficFilterProvider>
  </ErrorBoundary>
);
