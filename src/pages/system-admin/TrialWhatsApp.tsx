import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MessageCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/system-admin/AdminShell";
import { useLanguage } from "@/i18n";

// Only the Senvia agency sends trial nudges, so the config is scoped to it for now.
const SENVIA_ORG_ID = "06fe9e1d-9670-45b0-8717-c5a6e90be380";

interface WaConfig {
  enabled: boolean;
  threshold_days: number;
  cooldown_days: number;
  max_count: number;
  messages: string[];
}

const DEFAULT_CONFIG: WaConfig = {
  enabled: true,
  threshold_days: 1,
  cooldown_days: 2,
  max_count: 4,
  messages: [],
};

export default function SystemAdminTrialWhatsApp() {
  const qc = useQueryClient();
  const { t } = useLanguage();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["trial-whatsapp-config"],
    retry: false,
    queryFn: async (): Promise<WaConfig | null> => {
      const { data, error } = await (supabase as any)
        .from("trial_whatsapp_config")
        .select("enabled, threshold_days, cooldown_days, max_count, messages")
        .eq("organization_id", SENVIA_ORG_ID)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        enabled: data.enabled,
        threshold_days: data.threshold_days,
        cooldown_days: data.cooldown_days,
        max_count: data.max_count,
        messages: Array.isArray(data.messages) ? data.messages : [],
      };
    },
  });

  const [form, setForm] = useState<WaConfig>(DEFAULT_CONFIG);
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("trial_whatsapp_config").upsert(
        {
          organization_id: SENVIA_ORG_ID,
          enabled: form.enabled,
          threshold_days: form.threshold_days,
          cooldown_days: form.cooldown_days,
          max_count: form.max_count,
          messages: form.messages,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trial-whatsapp-config"] });
      toast.success(t("Configuração guardada"));
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Opt-outs: trials that asked to stop (or were stopped by the team).
  const { data: optouts = [] } = useQuery({
    queryKey: ["trial-whatsapp-optouts"],
    retry: false,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await (supabase as any)
        .from("organizations")
        .select("id, name")
        .eq("wa_nudge_optout", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const reactivate = useMutation({
    mutationFn: async (orgId: string) => {
      const { error } = await (supabase as any)
        .from("organizations")
        .update({ wa_nudge_optout: false })
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trial-whatsapp-optouts"] });
      toast.success(t("Org reativada para mensagens"));
    },
    onError: (e: any) => toast.error(e.message),
  });

  const setMsg = (i: number, value: string) =>
    setForm((f) => ({ ...f, messages: f.messages.map((m, idx) => (idx === i ? value : m)) }));

  return (
    <AdminShell
      title={t("WhatsApp de Trials")}
      description={t("Sequência de reativação por WhatsApp para trials inativos. Ligada à Senvia Agency.")}
      icon={MessageCircle}
      maxWidth="4xl"
      action={
        <Button onClick={() => save.mutate()} disabled={save.isPending || isLoading || isError} size="sm">
          {save.isPending ? t("A guardar...") : t("Guardar")}
        </Button>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("A configuração ainda não está disponível na base de dados. Falta aplicar a migração")}
            <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">20260622140000_trial_whatsapp_config</code>
            {t("em produção. Até lá, a sequência corre com os valores predefinidos.")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Master toggle */}
          <Card>
            <CardContent className="flex items-center justify-between gap-4 py-5">
              <div>
                <p className="text-sm font-medium text-foreground">{t("Sequência ativa")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("Quando desligada, nenhuma mensagem é enviada (o cron continua agendado mas não envia nada).")}
                </p>
              </div>
              <Switch checked={form.enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
            </CardContent>
          </Card>

          {/* Timing */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("Regras de envio")}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <NumberField
                label={t("Inatividade (dias)")}
                hint={t("Dias sem usar que disparam a 1ª mensagem")}
                value={form.threshold_days}
                onChange={(n) => setForm((f) => ({ ...f, threshold_days: n }))}
              />
              <NumberField
                label={t("Intervalo (dias)")}
                hint={t("Espaço mínimo entre mensagens")}
                value={form.cooldown_days}
                onChange={(n) => setForm((f) => ({ ...f, cooldown_days: n }))}
              />
              <NumberField
                label={t("Máximo de mensagens")}
                hint={t("Teto por trial (segurança)")}
                value={form.max_count}
                onChange={(n) => setForm((f) => ({ ...f, max_count: n }))}
              />
            </CardContent>
          </Card>

          {/* Messages */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("Mensagens")}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {t("Use")} <code className="rounded bg-muted px-1 py-0.5">{"{primeiro_nome}"}</code>{" "}{t("para inserir o primeiro nome real do cliente. Se não houver nome, a saudação ajusta-se sozinha.")}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {form.messages.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("Sem mensagens definidas.")}</p>
              )}
              {form.messages.map((m, i) => (
                <div key={i} className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t("Mensagem {{n}}", { n: i + 1 })}</Label>
                  <Textarea
                    value={m}
                    onChange={(e) => setMsg(i, e.target.value)}
                    rows={3}
                    className="min-h-[88px] text-sm leading-relaxed"
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Opt-outs */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("Opt-outs ({{n}})", { n: optouts.length })}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {t("Orgs que pediram para não receber. Marque manualmente o opt-out quando vir um \"SAIR\" no inbox.")}
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {optouts.length === 0 ? (
                <p className="px-6 py-6 text-sm text-muted-foreground">{t("Ninguém em opt-out.")}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {optouts.map((o) => (
                    <li key={o.id} className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm font-medium">{o.name}</span>
                      <Button variant="ghost" size="sm" onClick={() => reactivate.mutate(o.id)}>
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {t("Reativar")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AdminShell>
  );
}

function NumberField({
  label, hint, value, onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
      />
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
