import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList, ArrowRight, CalendarClock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useOpenInboxTasks, isTaskOverdue } from "@/hooks/useInboxTasks";
import { useTeamMembers } from "@/hooks/useTeam";
import { InboxTasksModal } from "@/components/inbox/InboxTasksModal";
import { cn } from "@/lib/utils";
import { intlLocale, tr, useLanguage } from "@/i18n";

function dueLabel(dueAt: string): string {
  const d = new Date(dueAt);
  const now = new Date();
  const time = d.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return tr("Hoje {{time}}", { time });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return tr("Amanhã {{time}}", { time });
  return d.toLocaleDateString(intlLocale(), { day: "2-digit", month: "short" });
}

// Dashboard widget: my open conversation tasks (overdue first). Clicking a task
// deep-links into the conversation. Renders nothing when there are no tasks.
export function TasksWidget() {
  // Aliased: the task callbacks below use `t` for the task.
  const { t: translate } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: openTasks = [] } = useOpenInboxTasks();
  const { data: teamMembers = [] } = useTeamMembers();
  const [tasksModalOpen, setTasksModalOpen] = useState(false);

  const myTasks = useMemo(() => {
    const mine = openTasks.filter(
      (t) => t.assigned_to === user?.id || (!t.assigned_to && t.created_by === user?.id),
    );
    // Overdue first, then nearest due date, then no-date.
    return mine.sort((a, b) => {
      const oa = isTaskOverdue(a) ? 0 : 1;
      const ob = isTaskOverdue(b) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      const da = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const db = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      return da - db;
    });
  }, [openTasks, user?.id]);

  const overdue = myTasks.filter(isTaskOverdue).length;
  if (myTasks.length === 0) return null;

  return (
    <Card data-module="tasks">
      <CardHeader className="px-4 pb-1.5 pt-3.5">
        <CardTitle className="flex items-center justify-between text-sm font-semibold">
          <span className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            {translate("As minhas tarefas")}
            {overdue > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                {translate(overdue > 1 ? "{{n}} atrasadas" : "{{n}} atrasada", { n: overdue })}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setTasksModalOpen(true)}
            className="flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
          >
            {translate("Abrir")} <ArrowRight className="h-3 w-3" />
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        <div className="space-y-0.5">
          {myTasks.slice(0, 5).map((t) => {
            // Five at most: the rest are one click away in "Abrir".
            const late = isTaskOverdue(t);
            return (
              <Link
                key={t.id}
                to={t.contact_phone ? `/inbox?phone=${encodeURIComponent(t.contact_phone)}` : "/inbox"}
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-[13px] hover:bg-accent"
              >
                <span className="min-w-0">
                  <span className="block truncate">{t.title}</span>
                  {t.contact_name && (
                    <span className="block truncate text-[11px] text-muted-foreground">{t.contact_name}</span>
                  )}
                </span>
                {t.due_at && (
                  <span className={cn("flex shrink-0 items-center gap-1 text-xs", late ? "font-semibold text-red-600" : "text-muted-foreground")}>
                    <CalendarClock className="h-3 w-3" />
                    {late ? translate("Atrasada") : dueLabel(t.due_at)}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </CardContent>

      <InboxTasksModal
        open={tasksModalOpen}
        onOpenChange={setTasksModalOpen}
        tasks={openTasks}
        teamMembers={teamMembers}
        currentUserId={user?.id}
        onOpenConversation={(phone) => {
          if (phone) navigate(`/inbox?phone=${encodeURIComponent(phone)}`);
        }}
      />
    </Card>
  );
}
