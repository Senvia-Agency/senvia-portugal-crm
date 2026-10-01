import { useState } from 'react';
import { Clock, Folder, RotateCcw, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { NO_AUTOMATION_FOLDER, automationFolderIdFromSelection } from '@/lib/automation-folder-selection';
import type { AutomationFlow, AutomationFolder, AutomationReentryPolicy, QuietHours } from '@/types/automations';

interface FlowSettingsProps {
  flow: AutomationFlow;
  folders: AutomationFolder[];
  onFolderChange: (folderId: string | null) => void;
  onSave: (patch: {
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
  const [quietEnabled, setQuietEnabled] = useState(!!flow.quiet_hours?.start);
  const [start, setStart] = useState(flow.quiet_hours?.start ?? '21:00');
  const [end, setEnd] = useState(flow.quiet_hours?.end ?? '09:00');
  const [reentry, setReentry] = useState<AutomationReentryPolicy>(flow.reentry_policy);
  const [maxSteps, setMaxSteps] = useState(String(flow.max_steps_per_run ?? 100));
  const [folderId, setFolderId] = useState(flow.folder_id ?? NO_AUTOMATION_FOLDER);

  const handleSave = () => {
    onSave({
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
            Pasta
          </CardTitle>
          <CardDescription>
            Escolha onde esta automação aparece na lista. A pasta não altera o gatilho nem o que ela envia.
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
              <SelectValue placeholder="Sem pasta" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_AUTOMATION_FOLDER}>Sem pasta</SelectItem>
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
            Horário de silêncio
          </CardTitle>
          <CardDescription>
            Mensagens que calhem dentro desta janela não são canceladas — ficam à espera e saem
            assim que ela termina. Evita enviar às 3 da manhã.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="quiet-toggle" className="font-normal">
              Não enviar durante a noite
            </Label>
            <Switch id="quiet-toggle" checked={quietEnabled} onCheckedChange={setQuietEnabled} />
          </div>

          {quietEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quiet-start" className="text-xs text-muted-foreground">
                  A partir das
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
                  Até às
                </Label>
                <Input
                  id="quiet-end"
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                Hora de Portugal continental.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="h-4 w-4 text-primary" />
            Quem pode voltar a entrar
          </CardTitle>
          <CardDescription>
            O que acontece quando o gatilho dispara outra vez para um contacto que já passou por
            aqui.
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
                  {REENTRY_LABELS[key].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{REENTRY_LABELS[reentry].hint}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            Limite de passos
          </CardTitle>
          <CardDescription>
            Travão de segurança: se um contacto passar por mais passos do que este número, o
            percurso é interrompido e marcado com erro. Protege contra fluxos que voltam sobre si
            próprios em ciclo.
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

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving}>
          Guardar definições
        </Button>
      </div>
    </div>
  );
}
