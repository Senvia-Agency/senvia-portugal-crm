import { useState } from 'react';
import { GoalSettings, readExitGoal, exitGoalValid } from './GoalSettings';
import { AutomationFailurePolicy } from './AutomationFailurePolicy';
import { Clock, Folder, RotateCcw, ShieldAlert, BellRing } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { NO_AUTOMATION_FOLDER, automationFolderIdFromSelection } from '@/lib/automation-folder-selection';
import type { AutomationFlow, AutomationFolder, AutomationNodeConfig, AutomationReentryPolicy, QuietHours } from '@/types/automations';
import { useLanguage } from '@/i18n';

interface FlowSettingsProps {
  flow: AutomationFlow;
  folders: AutomationFolder[];
  onFolderChange: (folderId: string | null) => void;
  onSave: (patch: {
    trigger_config: AutomationNodeConfig;
    folder_id: string | null;
    quiet_hours: QuietHours | null;
    reentry_policy: AutomationReentryPolicy;
    max_steps_per_run: number;
  }) => void;
  isSaving?: boolean;
}

const REENTRY_LABELS: Record<AutomationReentryPolicy, { label: string; hint: string }> = {
  once: {
    label: 'Uma só vez',
    hint: 'Cada contacto entra neste fluxo uma vez e nunca mais. É a opção segura.',
  },
  after_completion: {
    label: 'Depois de terminar',
    hint: 'Pode voltar a entrar, mas só depois de ter chegado ao fim da vez anterior.',
  },
  always: {
    label: 'Sempre',
    hint: 'Entra de cada vez que o gatilho dispara. Só para fluxos muito curtos — com sequências longas, a mesma pessoa recebe tudo repetido.',
  },
};

export function FlowSettings({ flow, folders, onFolderChange, onSave, isSaving }: FlowSettingsProps) {
  const { t } = useLanguage();
  const [failurePolicy, setFailurePolicy] = useState<unknown>(flow.trigger_config?.failure_policy ?? null);
  const [failureAlertEnabled, setFailureAlertEnabled] = useState(flow.trigger_config?.failure_alert_enabled === true);
  const [goal, setGoal] = useState(() => readExitGoal(flow.trigger_config?.goal));
  const [quietEnabled, setQuietEnabled] = useState(!!flow.quiet_hours?.start);
  const [start, setStart] = useState(flow.quiet_hours?.start ?? '21:00');
  const [end, setEnd] = useState(flow.quiet_hours?.end ?? '09:00');
  const [reentry, setReentry] = useState<AutomationReentryPolicy>(flow.reentry_policy);
  const [cooldownDays, setCooldownDays] = useState(String(flow.trigger_config?.reentry_cooldown_days ?? 0));
  const cooldownValid = reentry !== 'after_completion' || (cooldownDays.trim() !== '' && Number.isInteger(Number(cooldownDays)) && Number(cooldownDays) >= 0 && Number(cooldownDays) <= 3660);
  const [maxSteps, setMaxSteps] = useState(String(flow.max_steps_per_run ?? 100));
  const [folderId, setFolderId] = useState(flow.folder_id ?? NO_AUTOMATION_FOLDER);

  const failurePolicyValid = !failurePolicy || (typeof failurePolicy === 'object' && [
    { key: 'threshold_percent', min: 1, max: 100, fallback: 20 },
    { key: 'min_runs', min: 2, max: 10000, fallback: 10 },
    { key: 'window_minutes', min: 5, max: 1440, fallback: 60 },
  ].every(({ key, min, max, fallback }) => {
    const value = Reflect.get(failurePolicy, key) ?? fallback;
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
  }));

  const handleSave = () => {
    if (!failurePolicyValid || !cooldownValid) return;
    onSave({
      trigger_config: { ...flow.trigger_config, goal: goal ?? null, failure_alert_enabled: failureAlertEnabled, failure_policy: failurePolicy, reentry_cooldown_days: reentry === 'after_completion' ? Number(cooldownDays) : flow.trigger_config?.reentry_cooldown_days ?? 0 },
      folder_id: automationFolderIdFromSelection(folderId),
      quiet_hours: quietEnabled ? { start, end } : null,
      reentry_policy: reentry,
      max_steps_per_run: Math.min(500, Math.max(1, Number(maxSteps) || 100)),
    });
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 md:p-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Folder className="h-4 w-4 text-primary" />
            {t('Pasta')}
          </CardTitle>
          <CardDescription>
            {t('Escolha onde esta automação aparece na lista. A pasta não altera o gatilho nem o que ela envia.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={folderId}
            onValueChange={(selection) => {
              setFolderId(selection);
              onFolderChange(automationFolderIdFromSelection(selection));
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('Sem pasta')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_AUTOMATION_FOLDER}>{t('Sem pasta')}</SelectItem>
              {folders.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-warning" />
            {t('Horário de silêncio')}
          </CardTitle>
          <CardDescription>
            {t('Mensagens que calhem dentro desta janela não são canceladas — ficam à espera e saem assim que ela termina. Evita enviar às 3 da manhã.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="quiet-toggle" className="font-normal">
              {t('Não enviar durante a noite')}
            </Label>
            <Switch id="quiet-toggle" checked={quietEnabled} onCheckedChange={setQuietEnabled} />
          </div>

          {quietEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quiet-start" className="text-xs text-muted-foreground">
                  {t('A partir das')}
                </Label>
                <Input
                  id="quiet-start"
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quiet-end" className="text-xs text-muted-foreground">
                  {t('Até às')}
                </Label>
                <Input
                  id="quiet-end"
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                {t('Hora de Portugal continental.')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="h-4 w-4 text-primary" />
            {t('Quem pode voltar a entrar')}
          </CardTitle>
          <CardDescription>
            {t('O que acontece quando o gatilho dispara outra vez para um contacto que já passou por aqui.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Select value={reentry} onValueChange={(v) => setReentry(v as AutomationReentryPolicy)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(REENTRY_LABELS) as AutomationReentryPolicy[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {t(REENTRY_LABELS[key].label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t(REENTRY_LABELS[reentry].hint)}</p>
          {reentry === 'after_completion' && (
            <div className="mt-3 space-y-1.5">
              <Label htmlFor="reentry-cooldown">Intervalo mínimo entre entradas (dias)</Label>
              <Input id="reentry-cooldown" type="number" min={0} max={3660} step={1}
                value={cooldownDays} onChange={(event) => setCooldownDays(event.target.value)}
                aria-invalid={!cooldownValid} aria-describedby={cooldownValid ? 'reentry-cooldown-help' : 'reentry-cooldown-error'}
                className="max-w-[140px]" />
              <p id="reentry-cooldown-help" className="text-xs text-muted-foreground">
                Conta a partir do fim do último percurso real. Use 0 para permitir nova entrada assim que terminar.
              </p>
              {!cooldownValid && <p id="reentry-cooldown-error" role="alert" className="text-sm text-destructive">Indique um número inteiro entre 0 e 3660 dias.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            {t('Limite de passos')}
          </CardTitle>
          <CardDescription>
            {t('Travão de segurança: se um contacto passar por mais passos do que este número, o percurso é interrompido e marcado com erro. Protege contra fluxos que voltam sobre si próprios em ciclo.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            type="number"
            min={1}
            max={500}
            value={maxSteps}
            onChange={(e) => setMaxSteps(e.target.value)}
            className="max-w-[140px]"
          />
        </CardContent>
      </Card>

      <GoalSettings goal={goal} onChange={setGoal} />
      <AutomationFailurePolicy value={failurePolicy} onChange={setFailurePolicy} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><BellRing className="h-4 w-4 text-primary" />Avisos de falha</CardTitle>
          <CardDescription>Avise o dono da automação quando um percurso terminar com erro, para que possa consultar o histórico e resolver a causa.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <Label htmlFor="failure-alert-toggle" className="font-normal">Avisar quando um percurso falhar</Label>
          <Switch id="failure-alert-toggle" checked={failureAlertEnabled} onCheckedChange={setFailureAlertEnabled} />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving || !failurePolicyValid || !cooldownValid}>
          {t('Guardar definições')}
        </Button>
      </div>
    </div>
  );
}
