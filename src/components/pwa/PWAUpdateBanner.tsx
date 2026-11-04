import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useLanguage } from "@/i18n";

/**
 * Detects when the deployed bundle has changed (different /index.html hash)
 * and offers a one-click reload. No service worker required.
 */
const POLL_INTERVAL_MS = 5 * 60 * 1000;

async function fetchCurrentBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`/?_=${Date.now()}`, {
      cache: "no-store",
      credentials: "omit",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/\/assets\/index-[^"'\s]+\.js/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

export function PWAUpdateBanner() {
  const { t } = useLanguage();
  const [needRefresh, setNeedRefresh] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let baseline: string | null = null;

    const check = async () => {
      const current = await fetchCurrentBuildId();
      if (cancelled || !current) return;
      if (baseline === null) {
        baseline = current;
        return;
      }
      if (current !== baseline) setNeedRefresh(true);
    };

    void check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex justify-center px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-primary/30 bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur">
        <RefreshCw className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground">{t("Nova versão disponível")}</span>
        <Button size="sm" onClick={() => window.location.reload()}>
          {t("Atualizar agora")}
        </Button>
      </div>
    </div>
  );
}
