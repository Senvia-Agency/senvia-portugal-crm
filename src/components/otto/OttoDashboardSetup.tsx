import { motion } from "framer-motion";
import { ChevronRight, CheckCircle2, X } from "lucide-react";
import { OttoAvatar } from "./OttoAvatar";
import { SetupTaskIcon } from "./SetupTaskIcon";
import { useRunSetupTask } from "./useRunSetupTask";
import { useOttoOnboarding } from "@/hooks/useOttoOnboarding";
import { useLanguage } from "@/i18n";

// Large dashboard hero where Otto walks the admin through configuring every ACTIVE
// module. Disappears on its own once everything is set up, or when the admin closes
// it (dismissal persisted per org, server-side — see useOttoOnboarding). If a new
// module is enabled later, its task appears here again.
export function OttoDashboardSetup() {
  const { loading, showSetupCard, pending, progress, dismissSetup } = useOttoOnboarding();
  const run = useRunSetupTask();
  const { t } = useLanguage();

  if (loading || !showSetupCard) return null;

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative mb-6 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background p-5 sm:p-6"
    >
      <button
        type="button"
        onClick={dismissSetup}
        // A dispensa é definitiva (guardada no servidor), por isso o botão diz-o
        // por extenso — um X sozinho lê-se como "fechar por agora".
        className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
      >
        {t("Não mostrar mais")}<X className="h-3.5 w-3.5" />
      </button>

      <div className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between sm:pr-40 sm:pt-0">
        <div className="flex items-center gap-3">
          <OttoAvatar expression="happy" size="lg" />
          <div>
            <h2 className="text-lg font-bold text-foreground">{t("Vamos configurar o teu Senvia OS")}</h2>
            <p className="text-sm text-muted-foreground">
              {pending.length === 1
                ? t("Falta 1 passo. Carrega para eu te guiar.")
                : t("Faltam {{n}} passos. Carrega num para eu te guiar.", { n: pending.length })}
            </p>
          </div>
        </div>
        <div className="min-w-[140px]">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("Progresso")}</span>
            <span>{progress.done}/{progress.total}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pending.map((task) => (
            <button
              key={task.key}
              onClick={() => run(task)}
              className="group flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-all hover:border-primary/50 hover:shadow-md"
            >
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <SetupTaskIcon icon={task.icon} className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{t(task.label)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t(task.description)}</p>
              </div>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </button>
          ))}
      </div>

      {progress.done > 0 && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          {t(progress.done === 1 ? "{{n}} passo concluído." : "{{n}} passos concluídos.", { n: progress.done })}
        </p>
      )}
    </motion.section>
  );
}
