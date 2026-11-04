import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, ClipboardList, CalendarClock, ArrowRight } from "lucide-react";
import { useConversationTasks, useToggleInboxTask, isTaskOverdue } from "@/hooks/useInboxTasks";
import { cn } from "@/lib/utils";
import { intlLocale, useLanguage } from "@/i18n";

// Compact task list for a CRM record (lead/client detail views). Tasks are
// matched by the record's phone — the same key the inbox uses — so the ficha
// and the conversation always show the same list. Renders nothing without tasks.
export function RecordTasks({ phone }: { phone: string | null | undefined }) {
  const { t: tt } = useLanguage();
  const { data: tasks = [] } = useConversationTasks(phone);
  const toggleTask = useToggleInboxTask();
  const open = tasks.filter((t) => !t.done_at && !t.suggested);
  if (!phone || open.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm font-semibold">
          <span className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            {tt("Tarefas ({{n}})", { n: open.length })}
          </span>
          <Link
            to={`/inbox?phone=${encodeURIComponent(phone)}`}
            className="flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
          >
            {tt("Abrir conversa")} <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {open.map((t) => {
          const late = isTaskOverdue(t);
          return (
            <div key={t.id} className="flex items-start gap-2">
              <button
                type="button"
                title={tt("Concluir")}
                onClick={() => toggleTask.mutate({ id: t.id, done: true })}
                className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-muted-foreground/40 text-transparent transition-colors hover:border-emerald-500 hover:text-emerald-500"
              >
                <Check className="h-3 w-3" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm leading-snug">{t.title}</p>
                {t.due_at && (
                  <p className={cn("mt-0.5 flex items-center gap-1 text-xs", late ? "font-medium text-red-600" : "text-muted-foreground")}>
                    <CalendarClock className="h-3 w-3" />
                    {new Date(t.due_at).toLocaleString(intlLocale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {late ? tt(" — atrasada") : ""}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
