import { useState } from 'react';
import { ChevronDown, FileCheck2, Mail, ReceiptText } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type {
  RecurringFiscalConfig,
  RecurringFiscalDocumentPolicy,
  RecurringFiscalMode,
} from '@/types/recurring-fiscal';

interface RecurringFiscalSettingsProps {
  value: RecurringFiscalConfig;
  onChange: (value: RecurringFiscalConfig) => void;
  clientEmail?: string | null;
  disabled?: boolean;
  compact?: boolean;
  automaticDisabled?: boolean;
  automaticDisabledReason?: string;
}

export function RecurringFiscalSettings({
  value,
  onChange,
  clientEmail,
  disabled = false,
  compact = false,
  automaticDisabled = false,
  automaticDisabledReason,
}: RecurringFiscalSettingsProps) {
  const [messageOpen, setMessageOpen] = useState(false);

  const setMode = (fiscal_mode: RecurringFiscalMode) => onChange({
    ...value,
    fiscal_mode,
    fiscal_auto_email: fiscal_mode === 'manual' ? false : value.fiscal_auto_email,
  });
  const setPolicy = (fiscal_document_policy: RecurringFiscalDocumentPolicy) =>
    onChange({ ...value, fiscal_document_policy });
  const setEmail = (patch: Partial<RecurringFiscalConfig['fiscal_email_config']>) =>
    onChange({
      ...value,
      fiscal_email_config: { ...value.fiscal_email_config, ...patch },
    });

  return (
    <div className={cn('space-y-5', compact && 'space-y-4')}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label>Emissão fiscal</Label>
          {value.fiscal_mode === 'automatic' && (
            <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
              Automática
            </Badge>
          )}
        </div>
        <RadioGroup
          value={value.fiscal_mode}
          onValueChange={(next) => setMode(next as RecurringFiscalMode)}
          disabled={disabled}
          className="grid gap-2 sm:grid-cols-2"
        >
          <Label
            htmlFor="fiscal-mode-manual"
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
              value.fiscal_mode === 'manual' && 'border-primary/40 bg-primary/5',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <RadioGroupItem id="fiscal-mode-manual" value="manual" className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Manual</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                A equipa decide quando emitir cada documento.
              </span>
            </span>
          </Label>
          <Label
            htmlFor="fiscal-mode-automatic"
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
              value.fiscal_mode === 'automatic' && 'border-primary/40 bg-primary/5',
              (disabled || automaticDisabled) && 'cursor-not-allowed opacity-60',
            )}
          >
            <RadioGroupItem id="fiscal-mode-automatic" value="automatic" className="mt-0.5" disabled={disabled || automaticDisabled} />
            <span>
              <span className="block text-sm font-medium">Automática</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                O ciclo fiscal acompanha a cobrança sem intervenção manual.
              </span>
            </span>
          </Label>
        </RadioGroup>
        {automaticDisabled && !disabled && (
          <p className="text-xs text-muted-foreground">
            {automaticDisabledReason || 'Liga e configura o KeyInvoice para disponibilizar a emissão automática.'}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="fiscal-document-policy">Política de documentos</Label>
        <Select
          value={value.fiscal_document_policy}
          onValueChange={(next) => setPolicy(next as RecurringFiscalDocumentPolicy)}
          disabled={disabled}
        >
          <SelectTrigger id="fiscal-document-policy">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="invoice_then_receipt">Fatura e recibo (FT + RC)</SelectItem>
            <SelectItem value="invoice_receipt_when_paid">Fatura-recibo quando totalmente pago (FR)</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5 overflow-x-auto rounded-md border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
          {value.fiscal_document_policy === 'invoice_then_receipt' ? (
            <>
              <span>Ciclo criado</span><span aria-hidden>→</span>
              <span className="inline-flex items-center gap-1 font-medium text-foreground"><ReceiptText className="h-3.5 w-3.5" /> FT</span>
              <span aria-hidden>→</span><span>Pagamento confirmado</span><span aria-hidden>→</span>
              <span className="inline-flex items-center gap-1 font-medium text-foreground"><FileCheck2 className="h-3.5 w-3.5" /> RC</span>
            </>
          ) : (
            <>
              <span>Pagamento integral confirmado</span><span aria-hidden>→</span>
              <span className="inline-flex items-center gap-1 font-medium text-foreground"><FileCheck2 className="h-3.5 w-3.5" /> FR</span>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {value.fiscal_document_policy === 'invoice_then_receipt'
            ? 'Cada pagamento parcial confirmado gera o respetivo RC; pagamentos pendentes nunca geram recibo.'
            : 'A FR só é emitida quando a soma dos pagamentos confirmados cobre o valor integral do ciclo.'}
        </p>
        <p className="text-xs text-muted-foreground">
          Reembolsos e notas de crédito ficam em revisão manual quando não existe um reembolso confirmado e ligado ao documento original.
        </p>
      </div>

      <div className="rounded-lg border p-3.5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-2.5">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <Label htmlFor="fiscal-auto-email" className="cursor-pointer">Enviar PDF automaticamente</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {value.fiscal_mode === 'automatic'
                  ? 'Dispara depois de o fornecedor confirmar a emissão do documento.'
                  : 'Disponível quando a emissão fiscal automática estiver ativa.'}
              </p>
            </div>
          </div>
          <Switch
            id="fiscal-auto-email"
            checked={value.fiscal_auto_email}
            onCheckedChange={(fiscal_auto_email) => onChange({ ...value, fiscal_auto_email })}
            disabled={disabled || value.fiscal_mode !== 'automatic'}
          />
        </div>

        {value.fiscal_auto_email && (
          <div className="mt-4 space-y-4 border-t pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Destinatário</Label>
                <Select
                  value={value.fiscal_email_config.recipient_mode}
                  onValueChange={(recipient_mode: 'client' | 'custom') => setEmail({ recipient_mode })}
                  disabled={disabled}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="client">Email do cliente</SelectItem>
                    <SelectItem value="custom">Email específico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {value.fiscal_email_config.recipient_mode === 'custom' ? (
                <div className="space-y-2">
                  <Label htmlFor="fiscal-recipient-email">Email específico</Label>
                  <Input
                    id="fiscal-recipient-email"
                    type="email"
                    value={value.fiscal_email_config.recipient_email}
                    onChange={(event) => setEmail({ recipient_email: event.target.value })}
                    placeholder="faturacao@cliente.pt"
                    disabled={disabled}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="fiscal-fallback-email">Email alternativo</Label>
                  <Input
                    id="fiscal-fallback-email"
                    type="email"
                    value={value.fiscal_email_config.fallback_email}
                    onChange={(event) => setEmail({ fallback_email: event.target.value })}
                    placeholder="Usado se o cliente não tiver email"
                    disabled={disabled}
                  />
                </div>
              )}
            </div>
            {value.fiscal_email_config.recipient_mode === 'client' && (
              <p className="text-xs text-muted-foreground">
                Email atual do cliente: {clientEmail || 'não definido — preencha o alternativo'}.
              </p>
            )}

            <Collapsible open={messageOpen} onOpenChange={setMessageOpen}>
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md py-1 text-sm font-medium">
                Assunto e mensagem
                <ChevronDown className={cn('h-4 w-4 transition-transform', messageOpen && 'rotate-180')} />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="fiscal-sender-name">Nome do remetente</Label>
                    <Input
                      id="fiscal-sender-name"
                      value={value.fiscal_email_config.sender_name}
                      onChange={(event) => setEmail({ sender_name: event.target.value })}
                      placeholder="Nome da organização"
                      disabled={disabled}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fiscal-sender-email">Email do remetente</Label>
                    <Input
                      id="fiscal-sender-email"
                      type="email"
                      value={value.fiscal_email_config.sender_email}
                      onChange={(event) => setEmail({ sender_email: event.target.value })}
                      placeholder="Remetente Brevo da organização"
                      disabled={disabled}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fiscal-reply-to">Responder para</Label>
                  <Input
                    id="fiscal-reply-to"
                    type="email"
                    value={value.fiscal_email_config.reply_to}
                    onChange={(event) => setEmail({ reply_to: event.target.value })}
                    placeholder="Por omissão, o email do remetente"
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fiscal-subject-template">Assunto</Label>
                  <Input
                    id="fiscal-subject-template"
                    value={value.fiscal_email_config.subject_template}
                    onChange={(event) => setEmail({ subject_template: event.target.value })}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fiscal-body-template">Mensagem</Label>
                  <Textarea
                    id="fiscal-body-template"
                    rows={5}
                    value={value.fiscal_email_config.body_template}
                    onChange={(event) => setEmail({ body_template: event.target.value })}
                    disabled={disabled}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Variáveis: {'{{client_name}}'}, {'{{document_type}}'} e {'{{document_number}}'}. Se o remetente ficar vazio, é usado o remetente Brevo da organização; qualquer remetente personalizado tem de estar verificado na Brevo.
                </p>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </div>
    </div>
  );
}
