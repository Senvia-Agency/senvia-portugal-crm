import { Zap } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TRIGGER_TYPES, DELAY_OPTIONS } from '@/hooks/useAutomations';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { SALE_STATUS_LABELS, SALE_STATUSES } from '@/types/sales';
import { PROPOSAL_STATUS_LABELS, type ProposalStatus } from '@/types/proposals';
import { EMAIL_TEMPLATE_TRIGGER_LABELS } from '@/lib/email-template-triggers';

const PROPOSAL_STATUSES_LIST: ProposalStatus[] = ['draft', 'sent', 'negotiating', 'accepted', 'rejected', 'expired'];

interface TemplateAutomationSectionProps {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  triggerType: string;
  onTriggerTypeChange: (v: string) => void;
  fromStatus: string;
  onFromStatusChange: (v: string) => void;
  toStatus: string;
  onToStatusChange: (v: string) => void;
  delayMinutes: number;
  onDelayMinutesChange: (v: number) => void;
}

export function TemplateAutomationSection({
  enabled,
  onEnabledChange,
  triggerType,
  onTriggerTypeChange,
  fromStatus,
  onFromStatusChange,
  toStatus,
  onToStatusChange,
  delayMinutes,
  onDelayMinutesChange,
}: TemplateAutomationSectionProps) {
  const { data: stages } = usePipelineStages();

  const showStatusConfig = ['lead_status_changed', 'client_status_changed', 'sale_status_changed', 'proposal_status_changed'].includes(triggerType);
  const usesPipelineStages = triggerType === 'lead_status_changed' || triggerType === 'client_status_changed';
  const isRenewalTrigger = ['sale_renewal_due_today', 'sale_renewal_due_in_2_days'].includes(triggerType);
  const isManualSendTrigger = Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATE_TRIGGER_LABELS, triggerType);

  const renderStatusOptions = () => {
    if (usesPipelineStages) {
      return stages?.map(s => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>);
    }
    if (triggerType === 'sale_status_changed') {
      return SALE_STATUSES.map(s => <SelectItem key={s} value={s}>{SALE_STATUS_LABELS[s]}</SelectItem>);
    }
    return PROPOSAL_STATUSES_LIST.map(s => <SelectItem key={s} value={s}>{PROPOSAL_STATUS_LABELS[s]}</SelectItem>);
  };

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
            <Label className="text-base font-medium">{isManualSendTrigger ? 'Uso no envio manual' : 'Automação'}</Label>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {enabled && (
        <div className="space-y-4 pt-2">
          <div>
            <Label className="text-sm">Gatilho</Label>
            <Select value={triggerType} onValueChange={onTriggerTypeChange}>
              <SelectTrigger><SelectValue placeholder="Selecionar gatilho" /></SelectTrigger>
              <SelectContent>
                {TRIGGER_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showStatusConfig && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">De qual estado?</Label>
                <Select value={fromStatus} onValueChange={onFromStatusChange}>
                  <SelectTrigger><SelectValue placeholder="Qualquer" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Qualquer</SelectItem>
                    {renderStatusOptions()}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">Para qual estado?</Label>
                <Select value={toStatus} onValueChange={onToStatusChange}>
                  <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>
                    {renderStatusOptions()}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div>
            <Label className="text-sm">Atraso antes de enviar</Label>
            <Select value={String(delayMinutes)} onValueChange={v => onDelayMinutesChange(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DELAY_OPTIONS.map(d => (
                  <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground">
            {isManualSendTrigger
              ? 'Este template fica disponível para o tipo de envio selecionado e não é enviado automaticamente.'
              : 'O email será enviado automaticamente para o contacto associado ao gatilho, incluindo vendas recorrentes e avisos de renovação.'}
          </p>
        </div>
      )}
    </div>
  );
}
