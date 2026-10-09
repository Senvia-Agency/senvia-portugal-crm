import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useNativeTaskSuggestions } from '@/hooks/useNativeTaskSuggestions';
import { useMetaMessages } from '@/hooks/useMetaInbox';
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import {
  useConversationTasks, useCreateInboxTask, useToggleInboxTask, useUpdateInboxTask,
  useDeleteInboxTask, useAcceptSuggestedTask, useAiTasksEnabled, useSaveAiTasksEnabled,
  isTaskOverdue, type InboxTask,
} from "@/hooks/useInboxTasks";
import { cn } from "@/lib/utils";
import {
  CalendarClock, Check, ChevronDown, ChevronRight, ClipboardList, Loader2, MoreVertical, Plus, Sparkles, Trash2, X,
} from "lucide-react";

interface TeamMemberLite {
  user_id: string;
  full_name: string | null;
}

interface ConversationTasksProps {
  phone: string;
  contactName: string;
  /** Chatwoot-era conversation id; the native inbox (uuid) has none. */
  conversationId?: number | null;
  nativeConversationId?: string;
  channelId?: string;
  leadId?: string | null;
  clientId?: string | null;
  teamMembers: TeamMemberLite[];
  /** Pre-fill the quick-add (e.g. "transformar mensagem em tarefa"). */
  prefill?: string | null;
  onPrefillConsumed?: () => void;
}

// ---- due-date helpers ----

function presetToDate(preset: string, custom: string): Date | null {
  const d = new Date();
  switch (preset) {
    case "1h":
      d.setHours(d.getHours() + 1, 0, 0, 0);
      return d;
    case "today": {
      d.setHours(18, 0, 0, 0);
      if (d.getTime() < Date.now()) d.setHours(new Date().getHours() + 1, 0, 0, 0);
      return d;
    }
    case "tonight": {
      d.setHours(21, 0, 0, 0);
      if (d.getTime() < Date.now()) d.setHours(new Date().getHours() + 1, 0, 0, 0);
      return d;
    }
    case "tomorrow":
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    case "monday": {
      const day = d.getDay();
      const add = ((8 - day) % 7) || 7;
      d.setDate(d.getDate() + add);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    case "custom":
      return custom ? new Date(custom) : null;
    default:
      return null;
  }
}

function formatDue(dueAt: string): { label: string; tone: "overdue" | "today" | "later" } {
  const d = new Date(dueAt);
  const now = new Date();
  const time = d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  if (d.getTime() < now.getTime()) {
    const sameDay = d.toDateString() === now.toDateString();
    return { label: sameDay ? `Venceu às ${time}` : `Venceu ${d.toLocaleDateString("pt-PT", { day: "2-digit", month: "short" })}`, tone: "overdue" };
  }
  if (d.toDateString() === now.toDateString()) return { label: `Hoje ${time}`, tone: "today" };
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return { label: `Amanhã ${time}`, tone: "later" };
  return { label: d.toLocaleDateString("pt-PT", { day: "2-digit", month: "short" }), tone: "later" };
}

function firstName(name: string | null | undefined): string {
  return (name || "").trim().split(/\s+/)[0] || "";
}

// ISO timestamp -> value for <input type="datetime-local"> (local time).
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---- component ----

export function ConversationTasks({
  phone, contactName, conversationId, nativeConversationId, channelId, leadId, clientId, teamMembers, prefill, onPrefillConsumed,
}: ConversationTasksProps) {
  const { user } = useAuth();
  const { data: tasks = [], isError: tasksFailed } = useConversationTasks(phone, channelId);
  const createTask = useCreateInboxTask();
  const toggleTask = useToggleInboxTask();
  const updateTask = useUpdateInboxTask();
  const deleteTask = useDeleteInboxTask();
  const acceptSuggestion = useAcceptSuggestedTask();
  const { data: aiEnabled = false, isError: aiConfigFailed } = useAiTasksEnabled(channelId);
  const saveAiEnabled = useSaveAiTasksEnabled(channelId);
  const { data: nativeMessages = [] } = useMetaMessages(nativeConversationId ?? null);
  const analysis = useNativeTaskSuggestions(nativeConversationId, nativeMessages[nativeMessages.length - 1]?.id, aiEnabled);

  const [title, setTitle] = useState("");
  // Presets adapt to the clock: "Hoje (18h)" disappears once 18h is near/past
  // (replaced by "Hoje à noite (21h)" until ~20h30; after that, tomorrow).
  // Recomputed each render (not memoized once at mount) so a long-open panel
  // doesn't keep stale options across the 18h/21h boundaries.
  const duePresetOptions: Array<[string, string]> = (() => {
    const now = new Date();
    const h = now.getHours() + now.getMinutes() / 60;
    const opts: Array<[string, string]> = [["1h", "Daqui a 1 hora"]];
    if (h < 17.5) opts.push(["today", "Hoje (18h)"]);
    else if (h < 20.5) opts.push(["tonight", "Hoje à noite (21h)"]);
    opts.push(["tomorrow", "Amanhã (9h)"], ["monday", "Segunda (9h)"], ["custom", "Data à escolha…"], ["none", "Sem prazo"]);
    return opts;
  })();
  const [duePreset, setDuePreset] = useState(() => {
    const h = new Date().getHours();
    return h < 17 ? "today" : "tomorrow";
  });
  const [customDue, setCustomDue] = useState("");
  const [assignee, setAssignee] = useState("me");
  const [showDone, setShowDone] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Detail modal (view/edit/complete/delete a task).
  const [editing, setEditing] = useState<InboxTask | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editAssignee, setEditAssignee] = useState("none");

  const openDetail = (t: InboxTask) => {
    setEditing(t);
    setEditTitle(t.title);
    setEditDesc(t.description ?? "");
    setEditDue(t.due_at ? toLocalInput(t.due_at) : "");
    setEditAssignee(t.assigned_to ?? "none");
  };

  // "Transformar mensagem em tarefa" lands here pre-filled.
  useEffect(() => {
    if (prefill != null && prefill !== "") {
      setTitle(prefill.slice(0, 160));
      inputRef.current?.focus();
      onPrefillConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const suggestions = tasks.filter((t) => t.suggested && !t.done_at);
  const open = tasks.filter((t) => !t.done_at && !t.suggested);
  const done = tasks.filter((t) => !!t.done_at);

  const handleAdd = () => {
    const text = title.trim();
    if (!text || createTask.isPending) return;
    createTask.mutate(
      {
        title: text,
        dueAt: presetToDate(duePreset, customDue),
        assignedTo: assignee === "me" ? user?.id ?? null : assignee === "none" ? null : assignee,
        conversationId,
        sourceChannelId: channelId,
        contactPhone: phone,
        contactName,
        leadId: leadId ?? null,
        clientId: clientId ?? null,
      },
      { onSuccess: () => setTitle("") },
    );
  };

  const snooze = (t: InboxTask, kind: "1h" | "1d" | "1w" | "clear") => {
    if (kind === "clear") return updateTask.mutate({ id: t.id, dueAt: null });
    const base = t.due_at && new Date(t.due_at).getTime() > Date.now() ? new Date(t.due_at) : new Date();
    if (kind === "1h") base.setHours(base.getHours() + 1);
    if (kind === "1d") { base.setDate(base.getDate() + 1); base.setHours(9, 0, 0, 0); }
    if (kind === "1w") { base.setDate(base.getDate() + 7); base.setHours(9, 0, 0, 0); }
    updateTask.mutate({ id: t.id, dueAt: base });
  };

  const memberName = (id: string | null) => {
    if (!id) return null;
    if (id === user?.id) return "Eu";
    return firstName(teamMembers.find((m) => m.user_id === id)?.full_name) || null;
  };

  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ClipboardList className="h-3.5 w-3.5" />
        Tarefas{open.length > 0 ? ` (${open.length})` : ""}
        <button
          type="button"
          title={aiEnabled ? "Sugestões por IA: ligadas (clica para desligar)" : "Sugestões por IA: desligadas (clica para ligar)"}
          onClick={() => {
            const next = !aiEnabled;
            saveAiEnabled.mutate(next, {
              onSuccess: () =>
                toast({
                  title: next ? "✨ Sugestões por IA ligadas" : "Sugestões por IA desligadas",
                  description: next
                    ? "A IA vai sugerir tarefas a partir de promessas e pedidos nas conversas."
                    : "A IA deixa de sugerir tarefas nesta organização.",
                }),
              onError: (err) =>
                toast({ title: "Não foi possível alterar", description: (err as Error).message, variant: "destructive" }),
            });
          }}
          className={cn(
            "ml-auto flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium normal-case tracking-normal transition-colors",
            aiEnabled
              ? "bg-violet-500/10 text-violet-600 hover:bg-violet-500/20"
              : "bg-muted text-muted-foreground/60 hover:text-muted-foreground",
          )}
        >
          <Sparkles className="h-3 w-3" />
          {aiEnabled ? "IA on" : "IA off"}
        </button>
      </p>

      {(tasksFailed || aiConfigFailed) && (
        <p role="alert" className="mb-2 text-xs text-destructive">Não foi possível carregar as tarefas ou as definições da IA.</p>
      )}
      {analysis.isFetching && <p role="status" className="mb-2 text-xs text-muted-foreground">A IA está a analisar as mensagens…</p>}
      {analysis.isError && aiEnabled && (
        <div role="alert" className="mb-2 text-xs text-destructive">
          Não foi possível analisar esta conversa.
          <Button variant="link" size="sm" className="h-auto px-1 text-xs" onClick={() => void analysis.refetch()}>Tentar novamente</Button>
        </div>
      )}
      {aiEnabled && analysis.data?.hasMore && !analysis.isError && (
        <Button variant="link" size="sm" className="mb-2 h-10 px-0 text-xs" disabled={analysis.isFetching} onClick={() => void analysis.refetch()}>Analisar mais mensagens</Button>
      )}
      {/* AI suggestions — accepted becomes a real task, dismissed disappears */}
      {suggestions.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {suggestions.map((t) => {
            const due = t.due_at ? formatDue(t.due_at) : null;
            return (
              <div key={t.id} className="rounded-lg border border-violet-200 bg-violet-500/5 p-2">
                <p className="flex items-start gap-1.5 text-xs leading-snug">
                  <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-violet-500" />
                  <span className="min-w-0 break-words font-medium">{t.title}</span>
                </p>
                {t.source_message && (
                  <p className="mt-1 truncate pl-[18px] text-[10px] italic text-muted-foreground">“{t.source_message}”</p>
                )}
                {due && (
                  <div className="mt-1.5 pl-[18px]">
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                      <CalendarClock className="h-2.5 w-2.5" />
                      {due.label}
                    </span>
                  </div>
                )}
                <div className="mt-1.5 flex items-center gap-1.5 pl-[18px]">
                  <Button
                    size="sm"
                    className="h-6 flex-1 bg-violet-600 px-2 text-[11px] hover:bg-violet-700"
                    disabled={acceptSuggestion.isPending}
                    onClick={() => acceptSuggestion.mutate(t.id)}
                  >
                    <Check className="mr-1 h-3 w-3" />
                    Aceitar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 flex-1 px-2 text-[11px] text-muted-foreground"
                    onClick={() => deleteTask.mutate(t.id)}
                  >
                    <X className="mr-1 h-3 w-3" />
                    Ignorar
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Open tasks */}
      <div className="space-y-1">
        {open.map((t) => {
          const due = t.due_at ? formatDue(t.due_at) : null;
          const assigned = memberName(t.assigned_to);
          return (
            <div key={t.id} className="group flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-accent/50">
              <button
                type="button"
                title="Concluir"
                onClick={() => toggleTask.mutate({ id: t.id, done: true })}
                className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-muted-foreground/40 text-transparent transition-colors hover:border-emerald-500 hover:text-emerald-500"
              >
                <Check className="h-3 w-3" />
              </button>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openDetail(t)} title="Ver detalhes">
                <p className="break-words text-xs leading-snug">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{t.description}</p>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  {due && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                        due.tone === "overdue" && "bg-red-100 text-red-700",
                        due.tone === "today" && "bg-amber-100 text-amber-700",
                        due.tone === "later" && "bg-muted text-muted-foreground",
                      )}
                    >
                      <CalendarClock className="h-2.5 w-2.5" />
                      {due.label}
                    </span>
                  )}
                  {assigned && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{assigned}</span>
                  )}
                </div>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100">
                    <MoreVertical className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => snooze(t, "1h")}>Adiar 1 hora</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => snooze(t, "1d")}>Adiar para amanhã (9h)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => snooze(t, "1w")}>Adiar 1 semana</DropdownMenuItem>
                  {t.due_at && <DropdownMenuItem onClick={() => snooze(t, "clear")}>Remover prazo</DropdownMenuItem>}
                  <DropdownMenuSeparator />
                  {teamMembers.map((m) => (
                    <DropdownMenuItem key={m.user_id} onClick={() => updateTask.mutate({ id: t.id, assignedTo: m.user_id })}>
                      Atribuir a {firstName(m.full_name) || "membro"}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onClick={() => deleteTask.mutate(t.id)}>
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Apagar
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
        {open.length === 0 && (
          <p className="px-1 text-[11px] text-muted-foreground">Sem tarefas — adiciona uma para não esqueceres o combinado.</p>
        )}
      </div>

      {/* Quick add */}
      <div className="mt-2 space-y-1.5">
        <div className="flex items-end gap-1.5">
          <Textarea
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAdd(); } }}
            placeholder="Adicionar tarefa..."
            rows={Math.min(4, Math.max(1, Math.ceil(title.length / 32)))}
            className="min-h-[32px] resize-none px-2 py-1.5 text-xs"
          />
          <Button size="icon" className="h-8 w-8 shrink-0" disabled={!title.trim() || createTask.isPending} onClick={handleAdd}>
            {createTask.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Select value={duePreset} onValueChange={setDuePreset}>
            <SelectTrigger className="h-7 flex-1 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {duePresetOptions.map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={assignee} onValueChange={setAssignee}>
            <SelectTrigger className="h-7 flex-1 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="me">Para mim</SelectItem>
              {teamMembers.filter((m) => m.user_id !== user?.id).map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>{firstName(m.full_name) || "Membro"}</SelectItem>
              ))}
              <SelectItem value="none">Sem responsável</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {duePreset === "custom" && (
          <Input
            type="datetime-local"
            value={customDue}
            onChange={(e) => setCustomDue(e.target.value)}
            className="h-8 text-xs"
          />
        )}
      </div>

      {/* Done (collapsed) */}
      {done.length > 0 && (
        <div className="mt-2 border-t pt-2">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {showDone ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Concluídas ({done.length})
          </button>
          {showDone && (
            <div className="mt-1 space-y-0.5">
              {done.map((t) => (
                <div key={t.id} className="group flex items-center gap-2 rounded px-1 py-0.5">
                  <button
                    type="button"
                    title="Reabrir"
                    onClick={() => toggleTask.mutate({ id: t.id, done: false })}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-emerald-500 bg-emerald-500 text-white"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground line-through" onClick={() => openDetail(t)}>
                    {t.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteTask.mutate(t.id)}
                    className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detail modal: view/edit/complete/delete a task */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4" />
              Detalhes da tarefa
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Tarefa</p>
              <Textarea value={editTitle} onChange={(e) => setEditTitle(e.target.value)} rows={2} className="resize-none text-sm" />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Descrição</p>
              <Textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={4}
                placeholder="Detalhes, contexto, passos..."
                className="text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Prazo</p>
                <Input type="datetime-local" value={editDue} onChange={(e) => setEditDue(e.target.value)} className="h-9 text-xs" />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Responsável</p>
                <Select value={editAssignee} onValueChange={setEditAssignee}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem responsável</SelectItem>
                    {teamMembers.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.user_id === user?.id ? "Eu" : firstName(m.full_name) || "Membro"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {editing?.source_message && (
              <p className="rounded-lg bg-muted/60 p-2 text-[11px] italic text-muted-foreground">“{editing.source_message}”</p>
            )}
          </div>
          <DialogFooter className="flex-row items-center gap-1.5 sm:justify-between">
            {/* Ações sobre a tarefa (à esquerda) vs guardar a edição (à direita) */}
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="px-2 text-destructive hover:text-destructive"
                onClick={() => { if (editing) deleteTask.mutate(editing.id); setEditing(null); }}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Apagar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="px-2 text-emerald-600 hover:text-emerald-700"
                onClick={() => {
                  if (editing) toggleTask.mutate({ id: editing.id, done: !editing.done_at });
                  setEditing(null);
                }}
              >
                <Check className="mr-1.5 h-3.5 w-3.5" />
                {editing?.done_at ? "Reabrir tarefa" : "Marcar concluída"}
              </Button>
            </div>
            <Button
              size="sm"
              disabled={!editTitle.trim() || updateTask.isPending}
              onClick={() => {
                if (!editing) return;
                updateTask.mutate({
                  id: editing.id,
                  title: editTitle,
                  description: editDesc,
                  dueAt: editDue ? new Date(editDue) : null,
                  assignedTo: editAssignee === "none" ? null : editAssignee,
                });
                setEditing(null);
              }}
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Export for reuse in the "Minhas tarefas" views (popover + dashboard widget).
export { formatDue, firstName as taskFirstName };
export { isTaskOverdue };
