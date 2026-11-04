import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Loader2, Phone, StickyNote, Trash2, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { notePhoneKey, useAddContactNote, useContactNotes, useDeleteContactNote } from "@/hooks/useContactNotes";
import { cn } from "@/lib/utils";
import { EVENT_TYPE_LABELS, type EventType } from "@/types/calendar";
import type { Lead } from "@/types";
import { intlLocale, useLanguage } from "@/i18n";

interface LeadCalendarEvent {
  readonly id: string;
  readonly title: string;
  readonly start_time: string;
  readonly event_type: EventType;
  readonly status: string | null;
}

type ActivityItem =
  | { kind: "note"; id: string; at: string; text: string; who: string }
  | { kind: "event"; id: string; at: string; text: string; type: EventType; status: string | null }
  | { kind: "created"; id: string; at: string; text: string };

const when = (value: string) => new Date(value).toLocaleString(intlLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * What happened with a lead, newest first: the notes the team shares with the inbox
 * (keyed by phone), the lead's meetings and calls, and when it arrived.
 */
export function LeadActivity({ lead }: { lead: Lead }) {
  const { data: notes = [], isLoading } = useContactNotes(lead.phone);
  const addNote = useAddContactNote();
  const deleteNote = useDeleteContactNote();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [draft, setDraft] = useState("");
  const phoneKey = notePhoneKey(lead.phone);
  const canWrite = phoneKey.length >= 6;

  const events = useQuery({
    queryKey: ["lead-events", "lead", lead.id],
    queryFn: async (): Promise<LeadCalendarEvent[]> => {
      const { data, error } = await supabase.from("calendar_events")
        .select("id, title, start_time, event_type, status")
        .eq("lead_id", lead.id).order("start_time", { ascending: false }).limit(30);
      if (error) throw error;
      return (data ?? []) as LeadCalendarEvent[];
    },
  });

  const items = useMemo<ActivityItem[]>(() => {
    const list: ActivityItem[] = [
      ...notes.map((note): ActivityItem => ({
        kind: "note", id: note.id, at: note.created_at, text: note.content,
        who: note.author_name || (note.source === "import" ? t("Importada") : t("Equipa")),
      })),
      ...(events.data ?? []).map((event): ActivityItem => ({
        kind: "event", id: event.id, at: event.start_time, text: event.title, type: event.event_type, status: event.status,
      })),
    ];
    list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    list.push({ kind: "created", id: "created", at: lead.created_at, text: lead.source ? t("Lead criada · {{source}}", { source: lead.source }) : t("Lead criada") });
    return list;
  }, [notes, events.data, lead.created_at, lead.source, t]);

  const submit = () => {
    if (!draft.trim() || !lead.phone) return;
    addNote.mutate({ phone: lead.phone, content: draft.trim(), source: "crm" }, {
      onSuccess: () => setDraft(""),
      onError: (error) => toast({ title: t("Falha ao guardar a nota"), description: (error as Error).message, variant: "destructive" }),
    });
  };

  return <section aria-label={t("Atividade")} className="space-y-4">
    {canWrite ? <div className="rounded-2xl border bg-card p-2 focus-within:ring-2 focus-within:ring-primary/20">
      <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2}
        placeholder={t("Escrever uma nota sobre esta lead…")}
        className="min-h-[56px] resize-none border-0 bg-transparent p-2 text-sm shadow-none focus-visible:ring-0"
        onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); } }} />
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <span className="text-[11px] text-muted-foreground">{t("Ctrl+Enter para guardar · aparece também na Caixa de entrada")}</span>
        <Button size="sm" className="h-8 rounded-full" disabled={!draft.trim() || addNote.isPending} onClick={submit}>
          {addNote.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{t("Guardar nota")}
        </Button>
      </div>
    </div> : <p className="rounded-2xl border border-dashed p-3 text-xs text-muted-foreground">{t("Sem número de telefone, não é possível guardar notas.")}</p>}

    {isLoading ? <p className="text-xs text-muted-foreground">{t("A carregar atividade…")}</p>
      : <ol className="relative space-y-4 border-l border-border pl-6">
        {items.map((item) => {
          const future = item.kind === "event" && Date.parse(item.at) > Date.now();
          const Icon = item.kind === "note" ? StickyNote
            : item.kind === "created" ? UserPlus
            : item.type === "call" ? Phone
            : item.type === "meeting" ? Users
            : CalendarClock;
          return <li key={`${item.kind}-${item.id}`} className="group relative">
            <span className={cn("absolute -left-[37px] top-0 flex h-6 w-6 items-center justify-center rounded-full border bg-background",
              item.kind === "note" && "border-amber-300 text-amber-600 dark:border-amber-500/40",
              item.kind === "event" && (future ? "border-primary/40 text-primary" : "text-muted-foreground"),
              item.kind === "created" && "text-muted-foreground")} aria-hidden="true">
              <Icon className="h-3 w-3" />
            </span>
            {item.kind === "note" ? <>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.text}</p>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{t("Nota")} · {item.who} · {when(item.at)}</span>
                <button type="button" title={t("Apagar nota")} disabled={deleteNote.isPending}
                  className="rounded p-0.5 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => {
                    if (!window.confirm(t("Apagar esta nota?"))) return;
                    deleteNote.mutate({ id: item.id, phoneKey }, {
                      onError: (error) => toast({ title: t("Falha ao apagar"), description: (error as Error).message, variant: "destructive" }),
                    });
                  }}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </> : item.kind === "event" ? <>
              <p className="text-sm"><span className="font-medium">{EVENT_TYPE_LABELS[item.type] ? t(EVENT_TYPE_LABELS[item.type]) : t("Agendamento")}</span> · {item.text}</p>
              <p className={cn("mt-0.5 text-[11px]", future ? "text-primary" : "text-muted-foreground")}>
                {future ? t("Agendado para {{date}}", { date: when(item.at) }) : when(item.at)}
                {item.status === "completed" ? ` · ${t("concluído")}` : item.status === "cancelled" ? ` · ${t("cancelado")}` : !future ? ` · ${t("passou")}` : ""}
              </p>
            </> : <>
              <p className="text-sm text-muted-foreground">{item.text}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{when(item.at)}</p>
            </>}
          </li>;
        })}
      </ol>}
  </section>;
}
