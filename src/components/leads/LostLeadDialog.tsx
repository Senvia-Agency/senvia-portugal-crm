import { useState } from "react";
import { addDays, format } from "date-fns";
import { dateLocale, useLanguage } from "@/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarClock, Phone, Users } from "lucide-react";
import { REMINDER_OPTIONS } from "@/types/calendar";

const LOSS_REASONS = [
  { value: "price", label: "Preço" },
  { value: "competition", label: "Concorrência" },
  { value: "no_response", label: "Sem resposta" },
  { value: "timing", label: "Timing / Não é o momento" },
  { value: "other", label: "Outro" },
] as const;

const EVENT_TYPES = [
  { value: "call", label: "Chamada", icon: Phone },
  { value: "meeting", label: "Reunião", icon: Users },
] as const;

interface LostLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadName: string;
  isTelecom?: boolean;
  onConfirm: (data: {
    lossReason: string;
    notes: string;
    followUpDate: string;
    followUpTime: string;
    eventType: "call" | "meeting";
    scheduleFollowUp: boolean;
    reminderMinutes: number | null;
  }) => void;
}

export function LostLeadDialog({
  open,
  onOpenChange,
  leadName,
  isTelecom = false,
  onConfirm,
}: LostLeadDialogProps) {
  const { t } = useLanguage();
  const [lossReason, setLossReason] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpTime, setFollowUpTime] = useState("10:00");
  const [eventType, setEventType] = useState<"call" | "meeting">("call");
  const [reminderMinutes, setReminderMinutes] = useState<string>("");

  const handleQuickDate = (days: number) => {
    const date = addDays(new Date(), days);
    setFollowUpDate(format(date, "yyyy-MM-dd"));
  };

  const handleConfirm = () => {
    if (!lossReason || !followUpDate) return;
    onConfirm({
      lossReason,
      notes,
      followUpDate,
      followUpTime,
      eventType,
      scheduleFollowUp: true,
      reminderMinutes: reminderMinutes ? parseInt(reminderMinutes) : null,
    });
    // Reset
    setLossReason("");
    setNotes("");
    setFollowUpDate("");
    setFollowUpTime("10:00");
    setEventType("call");
    setReminderMinutes("");
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setLossReason("");
      setNotes("");
      setFollowUpDate("");
      setFollowUpTime("10:00");
      setEventType("call");
      setReminderMinutes("");
    }
    onOpenChange(open);
  };

  const canMarkLost = !!lossReason;
  const canSchedule = !!lossReason && !!followUpDate;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent variant="fullScreen" className="p-0 gap-0 flex flex-col">
        {/* Header fixo */}
        <div className="border-b p-4 md:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-warning" />
              {t("Agendar Recontacto")}
            </DialogTitle>
            <DialogDescription>
              {t("Agende um recontacto para {{name}}. O lead permanecerá na etapa atual até decidir movê-lo.", { name: leadName })}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Corpo scrollável */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="space-y-4 max-w-lg">
            {/* Loss Reason */}
            <div className="space-y-2">
              <Label>{t("Motivo da perda *")}</Label>
              <Select value={lossReason} onValueChange={setLossReason}>
                <SelectTrigger>
                  <SelectValue placeholder={t("Selecionar motivo")} />
                </SelectTrigger>
                <SelectContent>
                  {LOSS_REASONS.map((reason) => (
                    <SelectItem key={reason.value} value={reason.value}>
                      {t(reason.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>{t("Notas adicionais")}</Label>
              <Textarea
                placeholder={t("Detalhes sobre a perda...")}
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="resize-none"
              />
            </div>

            {/* Follow-up Date */}
            <div className="space-y-2">
              <Label>{t("Data de recontacto")} {isTelecom ? '*' : ''}</Label>
              <div className="flex gap-2 mb-2">
                {[
                  { days: 15, label: "15 dias" },
                  { days: 30, label: "30 dias" },
                  { days: 45, label: "45 dias" },
                ].map(({ days, label }) => (
                  <Button
                    key={days}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => handleQuickDate(days)}
                  >
                    {t(label)}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1">{t("Data")} {isTelecom ? '*' : ''}</Label>
                  <Input
                    type="date"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    min={format(addDays(new Date(), 1), "yyyy-MM-dd")}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1">{t("Hora *")}</Label>
                  <Input
                    type="time"
                    value={followUpTime}
                    onChange={(e) => setFollowUpTime(e.target.value)}
                  />
                </div>
              </div>
              {followUpDate && (
                <p className="text-xs text-muted-foreground">
                  {t("Recontacto a {{date}} às {{time}}", { date: format(new Date(followUpDate + "T12:00:00"), t("d 'de' MMMM 'de' yyyy"), { locale: dateLocale() }), time: followUpTime })}
                </p>
              )}
            </div>

            {/* Event Type */}
            <div className="space-y-2">
              <Label>{t("Tipo de evento")}</Label>
              <div className="flex gap-2">
                {EVENT_TYPES.map(({ value, label, icon: Icon }) => (
                  <Button
                    key={value}
                    type="button"
                    variant={eventType === value ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => setEventType(value as "call" | "meeting")}
                  >
                    <Icon className="h-4 w-4 mr-1.5" />
                    {t(label)}
                  </Button>
                ))}
              </div>
            </div>

            {/* Reminder */}
            <div className="space-y-2">
              <Label>{t("Lembrete")}</Label>
              <Select value={reminderMinutes || "none"} onValueChange={(v) => setReminderMinutes(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t("Sem lembrete")} />
                </SelectTrigger>
                <SelectContent>
                  {REMINDER_OPTIONS.map((option) => (
                    <SelectItem key={option.value ?? 'none'} value={option.value?.toString() ?? 'none'}>
                      {t(option.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Footer fixo */}
        <div className="border-t p-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => handleClose(false)} className="w-full sm:w-auto">
            {t("Cancelar")}
          </Button>
          <Button
            variant="destructive"
            disabled={!canMarkLost}
            className="w-full sm:w-auto"
            onClick={() => {
              if (!lossReason) return;
              onConfirm({
                lossReason,
                notes,
                followUpDate: "",
                followUpTime: "",
                eventType,
                scheduleFollowUp: false,
                reminderMinutes: null,
              });
              setLossReason("");
              setNotes("");
              setFollowUpDate("");
              setFollowUpTime("10:00");
              setEventType("call");
              setReminderMinutes("");
            }}
          >
            {t("Marcar como Perdido")}
          </Button>
          <Button onClick={handleConfirm} disabled={!canSchedule} className="w-full sm:w-auto">
            <CalendarClock className="h-4 w-4 mr-2" />{t("Agendar Recontacto")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
