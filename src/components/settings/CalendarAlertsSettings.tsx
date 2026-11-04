import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Calendar, Clock, Loader2 } from 'lucide-react';
import { useLanguage } from '@/i18n';


const HOURS_OPTIONS = [
  { value: null, label: 'Nunca' },
  { value: 1, label: '1 hora antes' },
  { value: 2, label: '2 horas antes' },
  { value: 3, label: '3 horas antes' },
  { value: 4, label: '4 horas antes' },
  { value: 6, label: '6 horas antes' },
  { value: 12, label: '12 horas antes' },
];

const DAYS_OPTIONS = [
  { value: null, label: 'Nunca' },
  { value: 1, label: '1 dia antes' },
  { value: 2, label: '2 dias antes' },
  { value: 3, label: '3 dias antes' },
  { value: 7, label: '7 dias antes' },
];

interface CalendarAlertSettings {
  auto_reminder_meetings: boolean;
  auto_reminder_hours: number | null;
  auto_reminder_days: number | null;
}

const DEFAULT_SETTINGS: CalendarAlertSettings = {
  auto_reminder_meetings: true,
  auto_reminder_hours: 1,
  auto_reminder_days: null,
};

export function CalendarAlertsSettings() {
  const { organization } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState<CalendarAlertSettings>(DEFAULT_SETTINGS);
  const { t } = useLanguage();

  useEffect(() => {
    async function fetch() {
      if (!organization?.id) return;
      const { data } = await supabase
        .from('organizations')
        .select('calendar_alert_settings')
        .eq('id', organization.id)
        .single();

      if (data) {
        const raw = (data as any).calendar_alert_settings as Record<string, any> | null;
      if (raw && typeof raw === 'object') {
          // Migration: convert old auto_reminder_minutes to new fields
          let hours: number | null = raw.auto_reminder_hours ?? null;
          let days: number | null = raw.auto_reminder_days ?? null;
          if (hours === null && days === null && raw.auto_reminder_minutes != null) {
            const mins = raw.auto_reminder_minutes as number;
            if (mins >= 1440) {
              days = Math.round(mins / 1440);
            } else {
              hours = Math.round(mins / 60) || 1;
            }
          }
          setSettings({
            auto_reminder_meetings: raw.auto_reminder_meetings ?? true,
            auto_reminder_hours: hours,
            auto_reminder_days: days,
          });
        }
      }
      setIsLoading(false);
    }
    fetch();
  }, [organization?.id]);

  const handleSave = async () => {
    if (!organization?.id) return;
    setIsSaving(true);
    const { error } = await supabase
      .from('organizations')
      .update({ calendar_alert_settings: settings as any })
      .eq('id', organization.id);

    setIsSaving(false);
    if (error) {
      toast.error(t('Erro ao guardar definições'));
    } else {
      toast.success(t('Definições de calendário guardadas'));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          {t('Alertas de Calendário')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('Configure lembretes automáticos para eventos e reuniões.')}
        </p>
      </div>

      {/* Auto Reminders */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {t('Lembretes Automáticos')}
          </CardTitle>
          <CardDescription>
            {t('Aplique automaticamente um lembrete a eventos que não tenham lembrete configurado manualmente.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t('Lembrete automático')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('Ativo para reuniões e chamadas sem lembrete definido')}
              </p>
            </div>
            <Switch
              checked={settings.auto_reminder_meetings}
              onCheckedChange={(v) =>
                setSettings((s) => ({ ...s, auto_reminder_meetings: v }))
              }
            />
          </div>

          {settings.auto_reminder_meetings && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('Lembrar horas antes')}</Label>
                <Select
                  value={settings.auto_reminder_hours?.toString() ?? 'never'}
                  onValueChange={(v) =>
                    setSettings((s) => ({ ...s, auto_reminder_hours: v === 'never' ? null : Number(v) }))
                  }
                >
                  <SelectTrigger className="w-full sm:w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value ?? 'never'} value={opt.value?.toString() ?? 'never'}>
                        {t(opt.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('Lembrar dias antes')}</Label>
                <Select
                  value={settings.auto_reminder_days?.toString() ?? 'never'}
                  onValueChange={(v) =>
                    setSettings((s) => ({ ...s, auto_reminder_days: v === 'never' ? null : Number(v) }))
                  }
                >
                  <SelectTrigger className="w-full sm:w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value ?? 'never'} value={opt.value?.toString() ?? 'never'}>
                        {t(opt.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={isSaving} className="w-full sm:w-auto">
        {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {t('Guardar Definições')}
      </Button>
    </div>
  );
}
