import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Check, Clock, MessageSquare, ClipboardList, User, ArrowLeft } from "lucide-react";
import { InboxTask, isTaskOverdue, useToggleInboxTask, useUpdateInboxTask } from "@/hooks/useInboxTasks";
import type { TeamMember } from "@/hooks/useTeam";
import { intlLocale, tr, useLanguage } from "@/i18n";

interface InboxTasksModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: InboxTask[];
  teamMembers: TeamMember[];
  currentUserId: string | undefined;
  onOpenConversation: (phone: string | null) => void;
}

function dueLabel(due: string | null): string {
  if (!due) return tr("Sem prazo");
  return new Date(due).toLocaleString(intlLocale(), {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

// Larger tasks browser: filter by collaborator on the left rail, pick a task to
// see its full details on the right (description, contact, prazo, responsável,
// mensagem de origem) and act on it (concluir, reatribuir, abrir conversa).
export function InboxTasksModal({
  open, onOpenChange, tasks, teamMembers, currentUserId, onOpenConversation,
}: InboxTasksModalProps) {
  const { t: tt } = useLanguage();
  // 'all' | 'mine' | 'unassigned' | <userId>
  const [assignee, setAssignee] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const toggleTask = useToggleInboxTask();
  const updateTask = useUpdateInboxTask();

  const nameOf = (userId: string | null): string => {
    if (!userId) return tt("Sem responsável");
    return teamMembers.find((m) => m.user_id === userId)?.full_name || tt("Desconhecido");
  };

  const filtered = useMemo(() => {
    const byFilter = tasks.filter((t) => {
      if (assignee === "all") return true;
      if (assignee === "mine") return t.assigned_to === currentUserId || (!t.assigned_to && t.created_by === currentUserId);
      if (assignee === "unassigned") return !t.assigned_to;
      return t.assigned_to === assignee;
    });
    // Overdue first, then by due date (no-due last).
    return [...byFilter].sort((a, b) => {
      const ao = isTaskOverdue(a) ? 0 : 1;
      const bo = isTaskOverdue(b) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      const ad = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const bd = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      return ad - bd;
    });
  }, [tasks, assignee, currentUserId]);

  const selected = filtered.find((t) => t.id === selectedId) ?? filtered[0] ?? null;

  // Collaborators that actually have tasks, for the filter dropdown.
  const collaborators = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.assigned_to).filter(Boolean) as string[]);
    return teamMembers.filter((m) => ids.has(m.user_id));
  }, [tasks, teamMembers]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-w-[calc(100vw-1rem)] p-0 gap-0 overflow-hidden flex flex-col max-h-[90dvh] h-[80dvh]">
        <DialogHeader className="border-b px-5 py-3 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4 text-primary" />
            {tt("Tarefas")} {tasks.length > 0 && <span className="text-sm font-normal text-muted-foreground">{tt("({{n}} abertas)", { n: tasks.length })}</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Left: filter + list (hidden on mobile once a task is open) */}
          <div className={cn("flex min-h-0 flex-col border-b md:border-b-0 md:border-r md:w-[40%]", selectedId && "hidden md:flex")}>
            <div className="border-b p-3 shrink-0">
              <Select value={assignee} onValueChange={(v) => { setAssignee(v); setSelectedId(null); }}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={tt("Filtrar por colaborador")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tt("Todas as tarefas")}</SelectItem>
                  <SelectItem value="mine">{tt("As minhas tarefas")}</SelectItem>
                  <SelectItem value="unassigned">{tt("Sem responsável")}</SelectItem>
                  {collaborators.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">{tt("Sem tarefas abertas. 🎉")}</p>
              ) : (
                filtered.map((t) => {
                  const overdue = isTaskOverdue(t);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={cn(
                        "flex w-full flex-col items-start gap-1 border-b px-4 py-3 text-left transition-colors hover:bg-accent/50",
                        selected?.id === t.id && "bg-accent",
                      )}
                    >
                      <span className="w-full truncate text-sm font-medium">{t.title}</span>
                      <span className="flex w-full items-center gap-2 text-[11px] text-muted-foreground">
                        {t.contact_name && <span className="truncate">{t.contact_name}</span>}
                        <span className={cn("ml-auto flex shrink-0 items-center gap-1", overdue && "font-semibold text-red-600")}>
                          <Clock className="h-3 w-3" />
                          {dueLabel(t.due_at)}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: details (full-screen on mobile when a task is open) */}
          <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto p-5", selectedId ? "flex" : "hidden md:flex")}>
            {!selected ? (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                {tt("Seleciona uma tarefa para ver os detalhes.")}
              </div>
            ) : (
              <div className="space-y-5">
                <Button
                  variant="outline"
                  size="sm"
                  className="mb-1 md:hidden"
                  onClick={() => setSelectedId(null)}
                >
                  <ArrowLeft className="mr-1.5 h-4 w-4" /> {tt("Voltar às tarefas")}
                </Button>
                <div>
                  <h3 className="text-xl font-semibold leading-snug">{selected.title}</h3>
                  {selected.contact_name && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{selected.contact_name}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-lg border p-3">
                    <p className="text-[11px] text-muted-foreground">{tt("Prazo")}</p>
                    <p className={cn("font-medium mt-0.5", isTaskOverdue(selected) && "text-red-600")}>
                      {dueLabel(selected.due_at)}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-[11px] text-muted-foreground">{tt("Responsável")}</p>
                    <p className="truncate font-medium mt-0.5">{nameOf(selected.assigned_to)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-[11px] text-muted-foreground">{tt("Estado")}</p>
                    <p className="font-medium mt-0.5">
                      {isTaskOverdue(selected) ? tt("Atrasada") : tt("Aberta")}
                    </p>
                  </div>
                </div>

                {selected.description && (
                  <div>
                    <p className="mb-1 text-[11px] font-medium text-muted-foreground">{tt("Descrição")}</p>
                    <p className="whitespace-pre-wrap text-sm">{selected.description}</p>
                  </div>
                )}

                {selected.source_message && (
                  <div>
                    <p className="mb-1 text-[11px] font-medium text-muted-foreground">{tt("Mensagem de origem")}</p>
                    <p className="rounded-md bg-muted px-3 py-2 text-sm italic text-muted-foreground">
                      &ldquo;{selected.source_message}&rdquo;
                    </p>
                  </div>
                )}

                {/* Reatribuir */}
                <div>
                  <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                    <User className="h-3 w-3" /> {tt("Reatribuir")}
                  </p>
                  <Select
                    value={selected.assigned_to ?? "none"}
                    onValueChange={(v) => updateTask.mutate({ id: selected.id, assignedTo: v === "none" ? null : v })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tt("Sem responsável")}</SelectItem>
                      {teamMembers.filter((m) => !m.is_banned).map((m) => (
                        <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => toggleTask.mutate({ id: selected.id, done: true })}
                    disabled={toggleTask.isPending}
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" /> {tt("Concluir")}
                  </Button>
                  {selected.contact_phone && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { onOpenConversation(selected.contact_phone); onOpenChange(false); }}
                    >
                      <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> {tt("Abrir conversa")}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
