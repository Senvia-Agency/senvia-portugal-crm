import { useEffect, useState } from "react";
import { CalendarClock, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n";
import { DEFAULT_SCHEDULE, useMySchedule, useSaveMySchedule, type WorkSchedule } from "@/hooks/useTimeClock";

const WEEKDAYS = [
  { n: 1, label: "Seg" }, { n: 2, label: "Ter" }, { n: 3, label: "Qua" }, { n: 4, label: "Qui" },
  { n: 5, label: "Sex" }, { n: 6, label: "Sáb" }, { n: 7, label: "Dom" },
];

/** What the database also checks, said before saving. */
function problem(s: WorkSchedule): string | null {
  if (s.days.length === 0) return "Escolha pelo menos um dia.";
  if (s.end_time <= s.start_time) return "A saída tem de ser depois da entrada.";
  if (!!s.lunch_start !== !!s.lunch_end) return "Indique o início e o fim do almoço, ou nenhum.";
  if (s.lunch_start && s.lunch_end && !(s.lunch_start > s.start_time && s.lunch_end > s.lunch_start && s.lunch_end < s.end_time)) {
    return "O almoço tem de ficar dentro do horário.";
  }
  return null;
}

/** "O meu horário": the hours the Ponto reminders follow. */
export function WorkScheduleCard() {
  const { data, isLoading } = useMySchedule();
  const saveSchedule = useSaveMySchedule();
  const { t } = useLanguage();
  const [s, setS] = useState<WorkSchedule>(DEFAULT_SCHEDULE);
  useEffect(() => { if (data) setS(data); }, [data]);
  const set = <K extends keyof WorkSchedule>(key: K, value: WorkSchedule[K]) => setS(prev => ({ ...prev, [key]: value }));

  const save = async () => {
    const error = problem(s);
    if (error) { toast.error(t(error)); return; }
    try {
      await saveSchedule.mutateAsync({ ...s, lunch_start: s.lunch_start || null, lunch_end: s.lunch_end || null });
      toast.success(t("Horário guardado."));
    } catch {
      toast.error(t("Não foi possível guardar o horário."));
    }
  };

  const time = (id: string, label: string, key: "start_time" | "end_time" | "lunch_start" | "lunch_end") => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(label, { context: 'schedule' })}</Label>
      <Input id={id} type="time" value={s[key] ?? ""} onChange={e => set(key, e.target.value)} />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5" />{t("O meu horário")}</CardTitle>
        <CardDescription>{t("Usado nos lembretes do ponto: avisa se não registar a entrada, o almoço ou a saída.")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <label className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
          <span>
            <span className="block text-sm font-medium">{t("Lembretes de ponto")}</span>
            <span className="block text-xs text-muted-foreground">{t("Notificação no telemóvel ou no computador.")}</span>
          </span>
          <Switch checked={s.reminders} onCheckedChange={v => set("reminders", v)} disabled={isLoading} />
        </label>
        <div className="space-y-1.5">
          <Label>{t("Dias de trabalho")}</Label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map(d => {
              const on = s.days.includes(d.n);
              return (
                <button key={d.n} type="button" aria-pressed={on}
                  onClick={() => set("days", on ? s.days.filter(x => x !== d.n) : [...s.days, d.n].sort())}
                  className={cn("h-9 w-12 rounded-full border text-sm font-medium transition-colors",
                    on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted")}>
                  {t(d.label)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {time("ws-start", "Entrada", "start_time")}
          {time("ws-lunch-start", "Início do almoço", "lunch_start")}
          {time("ws-lunch-end", "Fim do almoço", "lunch_end")}
          {time("ws-end", "Saída", "end_time")}
        </div>
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="ws-tolerance">{t("Avisar se não registar até (minutos depois)")}</Label>
          <Input id="ws-tolerance" type="number" min={0} max={120} value={s.tolerance_min}
            onChange={e => set("tolerance_min", Math.min(120, Math.max(0, Number(e.target.value) || 0)))} />
        </div>
        <Button onClick={save} disabled={saveSchedule.isPending || isLoading} className="w-full sm:w-auto">
          {saveSchedule.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {t("Guardar horário")}
        </Button>
      </CardContent>
    </Card>
  );
}
