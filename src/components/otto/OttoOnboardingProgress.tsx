import { CheckCircle2, Circle } from "lucide-react";
import { useOttoOnboarding } from "@/hooks/useOttoOnboarding";
import { useLanguage } from "@/i18n";

// Rich onboarding panel shown at the top of the Otto chat while the org is still
// setting up. Gives a visual "X of Y" progress so onboarding feels guided rather
// than a wall of text.
export function OttoOnboardingProgress() {
  const { showBadge, steps, progress, loading } = useOttoOnboarding();
  const { t } = useLanguage();

  // Only show while there is genuinely setup pending (same signal as the badge).
  if (loading || !showBadge) return null;

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-3.5 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{t("Configuração inicial")}</p>
        <span className="text-xs text-muted-foreground">{progress.done}/{progress.total}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ul className="space-y-1">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-xs">
            {s.done ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
            ) : (
              <Circle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            )}
            <span className={s.done ? "text-muted-foreground line-through" : "text-foreground"}>{t(s.label)}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">{t("Pede-me ajuda para configurar qualquer um destes passos.")}</p>
    </div>
  );
}
