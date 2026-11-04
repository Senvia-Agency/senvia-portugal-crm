import { FileCheck2, Mail, ReceiptText } from 'lucide-react';

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
import { cn } from '@/lib/utils';
import type {
  RecurringFiscalConfig,
  RecurringFiscalDocumentPolicy,
  RecurringFiscalMode,
} from '@/types/recurring-fiscal';
import { useLanguage } from "@/i18n";

interface RecurringFiscalSettingsProps {
  value: RecurringFiscalConfig;
  onChange: (value: RecurringFiscalConfig) => void;
  clientEmail?: string | null;
  disabled?: boolean;
  compact?: boolean;
  automaticDisabled?: boolean;
  automaticDisabledReason?: string;
  /** The sale is being created: automatic issuance also covers its first month. */
  includesFirstMonth?: boolean;
}

export function RecurringFiscalSettings({
  value,
  onChange,
  clientEmail,
  disabled = false,
  compact = false,
  automaticDisabled = false,
  automaticDisabledReason,
  includesFirstMonth = false,
}: RecurringFiscalSettingsProps) {
  const { t } = useLanguage();
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
          <Label>{t("Emissão fiscal")}</Label>
          {value.fiscal_mode === 'automatic' && (
            <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
              {t("Automática")}
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
              <span className="block text-sm font-medium">{t("Manual")}</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                {t("A equipa decide quando emitir cada documento.")}
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
              <span className="block text-sm font-medium">{t("Automática")}</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                {t("O ciclo fiscal acompanha a cobrança sem intervenção manual.")}
              </span>
            </span>
          </Label>
        </RadioGroup>
        {automaticDisabled && !disabled && (
          <p className="text-xs text-muted-foreground">
            {automaticDisabledReason || t("Liga e configura o KeyInvoice para disponibilizar a emissão automática.")}
          </p>
        )}
        {value.fiscal_mode === 'automatic' && (
          <p className="text-xs text-muted-foreground">
            {includesFirstMonth
              ? t("Inclui o 1.º mês: o documento desta venda é emitido e enviado logo, como as renovações seguintes.")
              : t("A partir de agora, cada renovação é emitida e enviada sozinha.")}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="fiscal-document-policy">{t("Política de documentos")}</Label>
        <Select
          value={value.fiscal_document_policy}
          onValueChange={(next) => setPolicy(next as RecurringFiscalDocumentPolicy)}
          disabled={disabled}
        >
          <SelectTrigger id="fiscal-document-policy">
            <SelectValue />
          </SelectTrigger>
          {/* Each option says when each document comes out, so the difference reads in the list itself. */}
          <SelectContent>
            <SelectItem value="invoice_then_receipt">
              <span className="block">{t("Fatura logo, recibo quando pagar")}</span>
              <span className="block text-xs text-muted-foreground">{t("Fatura ao criar a venda; um recibo por cada pagamento.")}</span>
            </SelectItem>
            <SelectItem value="invoice_receipt_when_paid">
              <span className="block">{t("Só fatura-recibo, quando estiver pago")}</span>
              <span className="block text-xs text-muted-foreground">{t("Um único documento, quando o valor estiver todo pago.")}</span>
            </SelectItem>
          </SelectContent>
        </Select>

        <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
          {value.fiscal_document_policy === 'invoice_then_receipt' ? (
            <>
              <span>{t("Venda criada")}</span><span aria-hidden>→</span>
              <span className="inline-flex items-center gap-1 font-medium text-foreground"><ReceiptText className="h-3.5 w-3.5" />{t("Fatura")}</span>
              <span aria-hidden>→</span><span>{t("Pagamento recebido")}</span><span aria-hidden>→</span>
              <span className="inline-flex items-center gap-1 font-medium text-foreground"><FileCheck2 className="h-3.5 w-3.5" />{t("Recibo")}</span>
            </>
          ) : (
            <>
              <span>{t("Venda criada")}</span><span aria-hidden>→</span><span>{t("Pagamento recebido")}</span><span aria-hidden>→</span>
              <span className="inline-flex items-center gap-1 font-medium text-foreground"><FileCheck2 className="h-3.5 w-3.5" />{t("Fatura-recibo")}</span>
            </>
          )}
        </div>
      </div>

      <div className="rounded-lg border p-3.5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-2.5">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <Label htmlFor="fiscal-auto-email" className="cursor-pointer">{t("Enviar PDF automaticamente")}</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {value.fiscal_mode === 'automatic'
                  ? t("Envia o documento ao cliente assim que é emitido.")
                  : t("Liga a emissão automática para usar.")}
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
            {/* One list: the client's email, or another one typed in. */}
            <div className="space-y-2">
              <Label htmlFor="fiscal-recipient">{t("Enviar para")}</Label>
              <Select
                value={value.fiscal_email_config.recipient_mode}
                onValueChange={(recipient_mode: 'client' | 'custom') => setEmail({ recipient_mode })}
                disabled={disabled}
              >
                <SelectTrigger id="fiscal-recipient"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">{clientEmail ? `${clientEmail} (cliente)` : t("Email do cliente (ainda sem email)")}</SelectItem>
                  <SelectItem value="custom">{t("Outro email…")}</SelectItem>
                </SelectContent>
              </Select>
              {value.fiscal_email_config.recipient_mode === 'custom' && (
                <Input
                  id="fiscal-recipient-email"
                  type="email"
                  aria-label={t("Outro email")}
                  value={value.fiscal_email_config.recipient_email}
                  onChange={(event) => setEmail({ recipient_email: event.target.value })}
                  placeholder="faturacao@cliente.pt"
                  disabled={disabled}
                  autoFocus
                />
              )}
              {value.fiscal_email_config.recipient_mode === 'client' && !clientEmail && (
                <Input
                  id="fiscal-fallback-email"
                  type="email"
                  aria-label={t("Email a usar enquanto o cliente não tiver email")}
                  value={value.fiscal_email_config.fallback_email}
                  onChange={(event) => setEmail({ fallback_email: event.target.value })}
                  placeholder={t("O cliente não tem email: escreva um aqui")}
                  disabled={disabled}
                />
              )}
            </div>

            <div className="rounded-md bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              {t("O email usa o modelo ativo em")} <strong className="text-foreground">{t("Marketing → Templates")}</strong> {t("e leva o documento em PDF.")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
