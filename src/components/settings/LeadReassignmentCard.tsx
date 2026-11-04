import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Repeat, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTeamMembers } from "@/hooks/useTeam";
import { cn } from "@/lib/utils";
import { tr, useLanguage } from "@/i18n";

interface Settings {
  enabled: boolean;
  timeout_minutes: number;
  window_start: string;
  window_end: string;
  days: number[];
  progress_rule: "stage_change" | "any_activity";
  pool: "form" | "list";
  pool_user_ids: string[];
  max_reassignments: number;
  after_max: "admin" | "keep";
  notify_email: boolean;
}

const DEFAULTS: Settings = {
  enabled: false, timeout_minutes: 120, window_start: "10:00", window_end: "22:00", days: [1, 2, 3, 4, 5, 6, 7],
  progress_rule: "stage_change", pool: "form", pool_user_ids: [], max_reassignments: 2, after_max: "admin", notify_email: true,
};

const WEEKDAYS = [[1, "Seg"], [2, "Ter"], [3, "Qua"], [4, "Qui"], [5, "Sex"], [6, "Sáb"], [7, "Dom"]] as const;

/** "Seg a Dom, das 10:00 às 22:00": what the example under the form says. */
function example(s: Settings): string {
  const h = Math.floor(s.timeout_minutes / 60);
  const m = s.timeout_minutes % 60;
  const span = `${h ? `${h} h` : ""}${h && m ? " " : ""}${m ? `${m} min` : ""}`;
  return tr("Uma lead sem mudar de etapa passa ao comercial seguinte ao fim de {{span}}, contados só entre as {{start}} e as {{end}}. Uma lead que entra fora deste horário espera pela abertura (às {{start}}) e só aí começa a contar.", { span, start: s.window_start, end: s.window_end });
}

/**
 * Redistribuição de leads: when a salesperson leaves a lead untouched past the
 * deadline (inside the working window), it moves to the next one. Escolha
 * Inteligente's idea; every organization sets its own.
 */
export function LeadReassignmentCard() {
  const { organization } = useAuth();
  const qc = useQueryClient();
  const team = useTeamMembers();
  const { t } = useLanguage();
  const [s, setS] = useState<Settings>(DEFAULTS);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS(prev => ({ ...prev, [key]: value }));

  const { data, isLoading } = useQuery({
    queryKey: ["lead-reassignment-settings", organization?.id],
    enabled: !!organization?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("lead_reassignment_settings").select("*").eq("organization_id", organization!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => {
    if (!data) return;
    setS({
      ...DEFAULTS, ...data,
      window_start: data.window_start.slice(0, 5), window_end: data.window_end.slice(0, 5),
      progress_rule: data.progress_rule as Settings["progress_rule"], pool: data.pool as Settings["pool"], after_max: data.after_max as Settings["after_max"],
    });
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (s.window_end <= s.window_start) throw new Error(t("O fim do horário tem de ser depois do início."));
      if (s.days.length === 0) throw new Error(t("Escolha pelo menos um dia."));
      if (s.pool === "list" && s.pool_user_ids.length < 2) throw new Error(t("Escolha pelo menos dois comerciais para a rotação."));
      const { error } = await supabase.from("lead_reassignment_settings").upsert({ organization_id: organization!.id, ...s }, { onConflict: "organization_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-reassignment-settings"] });
      toast.success(s.enabled ? t("Redistribuição ligada. Vale para as leads atribuídas a partir de agora.") : t("Definições guardadas."));
    },
    onError: e => toast.error(e instanceof Error ? e.message : t("Não foi possível guardar.")),
  });

  const members = (team.data ?? []).filter(m => !m.is_banned);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Repeat className="h-4 w-4" />{t("Redistribuição de leads")}</CardTitle>
        <CardDescription>{t('Se o comercial não der andamento a uma lead a tempo, ela passa para o comercial seguinte.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <label className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
          <span>
            <span className="block text-sm font-medium">{t('Passar leads sem andamento a outro comercial')}</span>
            <span className="block text-xs text-muted-foreground">{t('Só as leads atribuídas depois de ligar contam.')}</span>
          </span>
          <Switch checked={s.enabled} onCheckedChange={v => set("enabled", v)} disabled={isLoading} />
        </label>

        <div className={cn("space-y-5", !s.enabled && "pointer-events-none opacity-50")}>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="lr-timeout">{t('Prazo (minutos)')}</Label>
              <Input id="lr-timeout" type="number" min={15} max={1440} step={15} value={s.timeout_minutes}
                onChange={e => set("timeout_minutes", Math.min(1440, Math.max(15, Number(e.target.value) || 15)))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lr-start">{t('Conta a partir das')}</Label>
              <Input id="lr-start" type="time" value={s.window_start} onChange={e => set("window_start", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lr-end">{t('Até às')}</Label>
              <Input id="lr-end" type="time" value={s.window_end} onChange={e => set("window_end", e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('Dias em que conta')}</Label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map(([n, label]) => {
                const on = s.days.includes(n);
                return (
                  <button key={n} type="button" aria-pressed={on} onClick={() => set("days", on ? s.days.filter(d => d !== n) : [...s.days, n].sort())}
                    className={cn("h-9 w-12 rounded-full border text-sm font-medium transition-colors",
                      on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted")}>
                    {t(label)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('O que conta como andamento')}</Label>
              <Select value={s.progress_rule} onValueChange={v => set("progress_rule", v as Settings["progress_rule"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stage_change">{t('Mudar a lead de etapa')}</SelectItem>
                  <SelectItem value="any_activity">{t('Mudar de etapa, marcar evento ou criar proposta')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('Para quem passa')}</Label>
              <Select value={s.pool} onValueChange={v => set("pool", v as Settings["pool"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="form">{t('Seguinte na rotação do formulário da lead')}</SelectItem>
                  <SelectItem value="list">{t('Seguinte numa lista escolhida')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {s.pool === "list" && (
            <div className="space-y-1.5">
              <Label>{t('Comerciais da rotação')}</Label>
              <div className="grid gap-1.5 rounded-lg border p-3 sm:grid-cols-2">
                {members.map(m => (
                  <label key={m.user_id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={s.pool_user_ids.includes(m.user_id)}
                      onCheckedChange={c => set("pool_user_ids", c ? [...s.pool_user_ids, m.user_id] : s.pool_user_ids.filter(id => id !== m.user_id))} />
                    {m.full_name || m.email}
                  </label>
                ))}
              </div>
            </div>
          )}
          {s.pool === "form" && (
            <p className="text-xs text-muted-foreground">{t('Usa os destinatários do formulário de onde a lead veio. Se a lead não tiver formulário, usa a lista escolhida (vazia por defeito: a lead fica).')}</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lr-max">{t('Máximo de trocas por lead')}</Label>
              <Input id="lr-max" type="number" min={1} max={10} value={s.max_reassignments}
                onChange={e => set("max_reassignments", Math.min(10, Math.max(1, Number(e.target.value) || 1)))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('Depois do máximo')}</Label>
              <Select value={s.after_max} onValueChange={v => set("after_max", v as Settings["after_max"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t('Passa para um administrador')}</SelectItem>
                  <SelectItem value="keep">{t('Fica com o último comercial')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={s.notify_email} onCheckedChange={c => set("notify_email", !!c)} />
            {t('Enviar email ao novo comercial (além da notificação)')}
          </label>

          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{example(s)}</p>
        </div>

        <Button onClick={() => save.mutate()} disabled={save.isPending || isLoading} className="w-full sm:w-auto">
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {t('Guardar redistribuição')}
        </Button>
      </CardContent>
    </Card>
  );
}
