import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Ban, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAdminSaveEntry, useAdminSetStatus, useTimeClockHistory } from "@/hooks/useTimeClock";
import { ACTION_LABELS, STATUS_LABELS, formatClock, timeClockError, type PunchAction, type TimeClockEntry } from "@/lib/timeclock";
import { HistoryList } from "./HistoryList";
import { useLanguage } from "@/i18n";

export interface MemberOption { user_id: string; full_name: string }

/**
 * An admin's view of one entry: edit it, void or restore it, see its history.
 * With no entry it creates one ("Novo registo manual"). Every change needs a reason.
 */
export function EntryDialog({ open, onOpenChange, entry, members, defaultUserId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: TimeClockEntry | null;
  members: MemberOption[];
  defaultUserId?: string;
}) {
  const { t } = useLanguage();
  const save = useAdminSaveEntry();
  const setStatus = useAdminSetStatus();
  const history = useTimeClockHistory("", entry?.id, open && !!entry);
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState<PunchAction>("start");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setUserId(entry?.user_id ?? defaultUserId ?? "");
    setAction(entry?.action ?? "start");
    setDate(format(entry ? new Date(entry.punched_at) : new Date(), "yyyy-MM-dd"));
    setTime(entry ? formatClock(entry.punched_at) : format(new Date(), "HH:mm"));
    setNote(entry?.admin_note ?? "");
    setReason("");
  }, [open, entry, defaultUserId]);

  const name = members.find(m => m.user_id === (entry?.user_id ?? userId))?.full_name;
  const busy = save.isPending || setStatus.isPending;

  const submit = async () => {
    if (!userId) { toast.error(t("Escolha o colaborador.")); return; }
    try {
      await save.mutateAsync({
        entryId: entry?.id ?? null, userId: entry ? null : userId, action,
        punchedAt: new Date(`${date}T${time}`).toISOString(), reason: reason.trim(), note,
      });
      toast.success(entry ? t("Registo alterado.") : t("Registo criado."));
      onOpenChange(false);
    } catch (e) {
      toast.error(timeClockError(e));
    }
  };

  const changeStatus = async (status: "valid" | "voided") => {
    if (!entry) return;
    try {
      await setStatus.mutateAsync({ entryIds: [entry.id], status, reason: reason.trim() });
      toast.success(status === "voided" ? t("Registo anulado.") : entry.status === "pending" ? t("Registo aprovado.") : t("Registo restaurado."));
      onOpenChange(false);
    } catch (e) {
      toast.error(timeClockError(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex h-full flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 sm:px-6">
          <DialogTitle>{entry ? t("Editar registo") : t("Novo registo manual")}</DialogTitle>
          <DialogDescription>
            {entry ? `${name ?? t("Colaborador")} · ${t(STATUS_LABELS[entry.status])}` : t("Para quem se esqueceu de registar. Fica marcado como registado pelo administrador.")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="mx-auto grid w-full max-w-4xl gap-6 lg:grid-cols-[1fr_1fr]">
            <section className="space-y-4">
              {entry?.employee_note && (
                <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">{t("Observação do colaborador")}</p>
                  <p>{entry.employee_note}</p>
                </div>
              )}
              {!entry && (
                <div className="space-y-1.5">
                  <Label>{t("Colaborador")}</Label>
                  <Select value={userId} onValueChange={setUserId}>
                    <SelectTrigger><SelectValue placeholder={t("Escolher…")} /></SelectTrigger>
                    <SelectContent>
                      {members.map(m => <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>{t("Tipo")}</Label>
                <Select value={action} onValueChange={v => setAction(v as PunchAction)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ACTION_LABELS) as PunchAction[]).map(a => <SelectItem key={a} value={a}>{t(ACTION_LABELS[a])}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label htmlFor="entry-date">{t("Data")}</Label><Input id="entry-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="entry-time">{t("Hora")}</Label><Input id="entry-time" type="time" value={time} onChange={e => setTime(e.target.value)} /></div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="entry-note">{t("Notas")}</Label>
                <Textarea id="entry-note" rows={2} value={note} onChange={e => setNote(e.target.value.slice(0, 300))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="entry-reason">{t("Motivo da alteração *")}</Label>
                <Input id="entry-reason" value={reason} onChange={e => setReason(e.target.value.slice(0, 300))} placeholder={t("Ex.: esqueceu-se de registar a saída")} />
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button onClick={submit} disabled={busy}>{save.isPending ? t("A guardar…") : entry ? t("Guardar alterações") : t("Criar registo")}</Button>
                {entry && entry.status === "pending" && (
                  <Button variant="outline" onClick={() => changeStatus("valid")} disabled={busy}>{t("Aprovar")}</Button>
                )}
                {entry && entry.status !== "voided" && (
                  <Button variant="outline" className="text-destructive" onClick={() => changeStatus("voided")} disabled={busy}>
                    <Ban className="mr-1.5 h-4 w-4" />{entry.status === "pending" ? t("Rejeitar") : t("Anular")}
                  </Button>
                )}
                {entry && entry.status === "voided" && (
                  <Button variant="outline" onClick={() => changeStatus("valid")} disabled={busy}>
                    <RotateCcw className="mr-1.5 h-4 w-4" />{t("Restaurar")}
                  </Button>
                )}
              </div>
            </section>
            {entry && (
              <section>
                <h3 className="mb-2 text-sm font-semibold">{t("Histórico")}</h3>
                <HistoryList rows={history.data ?? []} loading={history.isLoading} />
              </section>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
