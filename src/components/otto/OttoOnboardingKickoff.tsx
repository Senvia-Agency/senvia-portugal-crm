import { Button } from "@/components/ui/button";
import { OttoAvatar } from "./OttoAvatar";
import { SetupTaskIcon } from "./SetupTaskIcon";
import { useRunSetupTask } from "./useRunSetupTask";
import { useOttoOnboarding } from "@/hooks/useOttoOnboarding";
import { useLanguage } from "@/i18n";

// The proactive "let's set up your CRM" menu Otto shows in the chat on first
// access. Lists the pending setup tasks for the org's active modules; each button
// launches the matching guide (shared with the dashboard card via useRunSetupTask).
export function OttoOnboardingKickoff() {
  const { showBadge, pending } = useOttoOnboarding();
  const run = useRunSetupTask();
  const { t } = useLanguage();

  if (!showBadge) return null;

  return (
    <div className="space-y-3">
      <div className="flex gap-2.5">
        <OttoAvatar expression="happy" size="md" />
        <div className="rounded-2xl rounded-tl-md bg-muted px-3.5 py-2.5 text-sm">
          <p className="font-medium">{t("Boas-vindas ao Senvia OS! 👋")}</p>
          <p className="mt-1 text-muted-foreground">
            {t("Vamos pôr os teus módulos a postos, é rápido. Por onde queres começar?")}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 pl-9">
        {pending.map((task) => (
          <Button
            key={task.key}
            variant="outline"
            size="sm"
            className="h-auto w-full justify-start gap-2 rounded-xl py-2 px-3 text-xs"
            onClick={() => run(task)}
          >
            <SetupTaskIcon icon={task.icon} className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
            {t(task.label)}
          </Button>
        ))}
        <p className="mt-1 text-[11px] text-muted-foreground">{t("Ou escreve-me o que precisares.")}</p>
      </div>
    </div>
  );
}
