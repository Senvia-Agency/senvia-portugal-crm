import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  FileDown,
  FileText,
  Loader2,
  Mail,
  RefreshCw,
  RotateCcw,
  Settings2,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import { openPdfInNewTab } from '@/lib/download';
import { RecurringFiscalSettings } from '@/components/sales/RecurringFiscalSettings';
import {
  DEFAULT_RECURRING_FISCAL_CONFIG,
  recurringFiscalConfigError,
  type RecurringFiscalConfig,
} from '@/types/recurring-fiscal';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import {
  useSaleCheckout,
  useCancelSaleRecurrence,
  useConfigureSaleRecurrenceFiscal,
  useReactivateSaleRecurrence,
  useRetryRecurringFiscalCycle,
  useSaleRecurrence,
  type BillingStatus,
  type CycleStatus,
  type FiscalCycleStatus,
  type FiscalEmailStatus,
  type ServiceStatus,
} from '@/hooks/useSaleRecurrence';

// Serviço e cobrança são apresentados como dois crachás separados, e não como um
// estado único, porque são mesmo coisas diferentes: um cliente pode estar em
// atraso e continuar a receber o serviço. Fundi-los num só rótulo era o que
// levava alguém a olhar para "Ativo" e concluir que estava tudo pago.
const SERVICE_LABEL: Record<ServiceStatus, string> = {
  pending: 'Por iniciar',
  active: 'Ativo',
  paused: 'Em pausa',
  inactive: 'Inativo',
  cancelled: 'Cancelado',
};

const BILLING_LABEL: Record<BillingStatus, string> = {
  not_started: 'Sem cobrança',
  current: 'Em dia',
  past_due: 'Em atraso',
  uncollectible: 'Incobrável',
};

const CYCLE_LABEL: Record<CycleStatus, string> = {
  pending: 'Por liquidar',
  paid: 'Liquidado',
  failed: 'Falhou',
  void: 'Anulado',
};

const FISCAL_LABEL: Record<FiscalCycleStatus, string> = {
  not_scheduled: 'Não agendado',
  pending: 'Por emitir',
  processing: 'A emitir',
  partial: 'Emissão parcial',
  completed: 'Concluído',
  retry: 'Nova tentativa agendada',
  failed: 'Falhou · requer revisão',
  manual_review: 'Revisão necessária',
};

const EMAIL_LABEL: Record<FiscalEmailStatus, string> = {
  not_requested: 'Não solicitado',
  pending: 'Por enviar',
  processing: 'A enviar',
  partial: 'Envio parcial',
  sent: 'Enviado',
  delivered: 'Entregue',
  bounced: 'Devolvido',
  blocked: 'Bloqueado',
  retry: 'Nova tentativa agendada',
  failed: 'Falhou · requer revisão',
  suppressed: 'Suprimido',
};

function fiscalTone(status: FiscalCycleStatus): string {
  if (status === 'completed') return 'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400';
  if (status === 'failed' || status === 'manual_review') return 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400';
  if (status === 'processing' || status === 'pending' || status === 'partial' || status === 'retry') {
    return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  }
  return 'border-border bg-muted/50 text-muted-foreground';
}

function emailTone(status: FiscalEmailStatus): string {
  if (status === 'sent' || status === 'delivered') return 'text-green-700 dark:text-green-400';
  if (status === 'failed' || status === 'bounced' || status === 'blocked') return 'text-red-700 dark:text-red-400';
  if (status === 'processing' || status === 'pending' || status === 'retry' || status === 'partial') {
    return 'text-amber-700 dark:text-amber-400';
  }
  return 'text-muted-foreground';
}

function serviceTone(status: ServiceStatus): string {
  if (status === 'active') return 'bg-green-500/10 text-green-600 border-green-500/20';
  if (status === 'cancelled' || status === 'inactive') return 'bg-muted/50 text-muted-foreground';
  return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
}

function billingTone(status: BillingStatus): string {
  if (status === 'current') return 'bg-green-500/10 text-green-600 border-green-500/20';
  if (status === 'not_started') return 'bg-muted/50 text-muted-foreground';
  return 'bg-red-500/10 text-red-600 border-red-500/20';
}

function CycleIcon({ status }: { status: CycleStatus }) {
  if (status === 'paid') return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === 'void') return <XCircle className="h-4 w-4 text-muted-foreground" />;
  return <Clock className="h-4 w-4 text-amber-600" />;
}

function monthLabel(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
}

export function RecurringSalePanel({ saleId }: { saleId: string }) {
  const { data: recurrence, isLoading } = useSaleRecurrence(saleId);
  const { createCheckout, isCreating } = useSaleCheckout();
  const cancelRecurrence = useCancelSaleRecurrence();
  const reactivateRecurrence = useReactivateSaleRecurrence();
  const configureFiscal = useConfigureSaleRecurrenceFiscal();
  const retryFiscalCycle = useRetryRecurringFiscalCycle();
  const { can } = usePermissions();
  const canConfigureFiscal = can('finance', 'invoices', 'issue');
  const { organization } = useAuth();
  const keyInvoiceActive = (organization?.integrations_enabled as Record<string, boolean> | null)?.keyinvoice === true
    && organization?.tem_keyinvoice_password === true
    && organization?.billing_provider === 'keyinvoice';
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [nextCycleDate, setNextCycleDate] = useState('');
  const [fiscalDraft, setFiscalDraft] = useState<RecurringFiscalConfig>(DEFAULT_RECURRING_FISCAL_CONFIG);
  const [fiscalDirty, setFiscalDirty] = useState(false);
  const [viewingFiscalDocumentId, setViewingFiscalDocumentId] = useState<string | null>(null);

  useEffect(() => {
    if (!recurrence) return;
    setFiscalDraft({
      fiscal_mode: recurrence.fiscal_mode,
      fiscal_document_policy: recurrence.fiscal_document_policy,
      fiscal_auto_email: recurrence.fiscal_auto_email,
      fiscal_email_config: recurrence.fiscal_email_config,
    });
    setFiscalDirty(false);
  }, [recurrence]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">A carregar recorrência...</span>
      </div>
    );
  }

  if (!recurrence) return null;

  const cycles = recurrence.cycles;
  const paid = cycles.filter((c) => c.status === 'paid');
  const outstanding = cycles.filter((c) => c.status === 'pending' || c.status === 'failed');
  const totalPaid = paid.reduce((sum, c) => sum + Number(c.amount), 0);
  const totalOutstanding = outstanding.reduce((sum, c) => sum + Number(c.amount), 0);

  const handleCheckout = async () => {
    const url = await createCheckout(recurrence.id);
    setCheckoutUrl(url);
    window.open(url, '_blank');
  };

  const isClosed = recurrence.service_status === 'cancelled' || recurrence.service_status === 'inactive';
  const handleReactivate = () => {
    if (!nextCycleDate) {
      toast.error('Escolhe a próxima data de renovação');
      return;
    }
    reactivateRecurrence.mutate(
      { saleId, nextCycleDate },
      { onSuccess: () => setNextCycleDate('') },
    );
  };

  const handleSaveFiscal = () => {
    const validationError = recurringFiscalConfigError(fiscalDraft);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    if (
      fiscalDraft.fiscal_auto_email
      && fiscalDraft.fiscal_email_config.recipient_mode === 'client'
      && !recurrence.client_email
      && !fiscalDraft.fiscal_email_config.fallback_email.trim()
    ) {
      toast.error('O cliente não tem email. Define um email alternativo para o envio fiscal.');
      return;
    }
    if (fiscalDraft.fiscal_auto_email) {
      const resolvedSenderEmail = fiscalDraft.fiscal_email_config.sender_email.trim()
        || organization?.brevo_sender_email?.trim();
      if (organization?.tem_brevo_api_key !== true || !resolvedSenderEmail) {
        toast.error('Liga a Brevo e configura um email de remetente antes de ativar o envio fiscal automático.');
        return;
      }
    }
    configureFiscal.mutate({ recurrenceId: recurrence.id, config: fiscalDraft });
  };

  const handleOpenFiscalPdf = async (documentId: string, pdfPath: string) => {
    setViewingFiscalDocumentId(documentId);
    try {
      await openPdfInNewTab(pdfPath);
    } catch {
      toast.error('Não foi possível abrir o PDF do documento fiscal.');
    } finally {
      setViewingFiscalDocumentId(null);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Recorrência mensal</span>
            </div>
            <p className="text-2xl font-semibold mt-1">
              {formatCurrency(Number(recurrence.amount))}
              <span className="text-sm font-normal text-muted-foreground">/mês</span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="outline" className={serviceTone(recurrence.service_status)}>
              {SERVICE_LABEL[recurrence.service_status]}
            </Badge>
            <Badge variant="outline" className={billingTone(recurrence.billing_status)}>
              {BILLING_LABEL[recurrence.billing_status]}
            </Badge>
          </div>
        </div>

        {/* Um cliente em atraso continua com o serviço ligado. Dizê-lo em voz
            alta evita a leitura errada de que "ativo" significa "pago". */}
        {recurrence.billing_status === 'past_due' && recurrence.service_status === 'active' && (
          <div className="flex gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Há cobranças em atraso, mas o serviço continua ativo. Suspender o serviço é uma
              decisão sua — não acontece automaticamente por um pagamento falhado.
            </p>
          </div>
        )}

        {isClosed ? (
          <div className="space-y-2 rounded-md border p-3">
            <label htmlFor={`reactivate-${saleId}`} className="text-sm font-medium">
              Próxima data de renovação
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={`reactivate-${saleId}`}
                type="date"
                value={nextCycleDate}
                onChange={(event) => setNextCycleDate(event.target.value)}
              />
              <Button
                type="button"
                onClick={handleReactivate}
                disabled={!nextCycleDate || reactivateRecurrence.isPending}
              >
                {reactivateRecurrence.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Reativar recorrência
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full text-destructive hover:text-destructive"
            onClick={() => cancelRecurrence.mutate(recurrence.id)}
            disabled={cancelRecurrence.isPending}
          >
            {cancelRecurrence.isPending
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <XCircle className="mr-2 h-4 w-4" />}
            Cancelar recorrência
          </Button>
        )}

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Liquidado</p>
            <p className="font-medium text-green-600">{formatCurrency(totalPaid)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Por liquidar</p>
            <p className={`font-medium ${totalOutstanding > 0 ? 'text-amber-600' : ''}`}>
              {formatCurrency(totalOutstanding)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Próximo ciclo</p>
            <p className="font-medium">
              {recurrence.next_cycle_date
                ? new Date(recurrence.next_cycle_date).toLocaleDateString('pt-PT')
                : '—'}
            </p>
          </div>
        </div>

        {recurrence.billing_provider === 'stripe' && !recurrence.stripe_subscription_id && (
          <div className="rounded-md border border-dashed p-3 space-y-2">
            <p className="text-sm font-medium">Subscrição por ativar</p>
            <p className="text-xs text-muted-foreground">
              O cliente ainda não concluiu o pagamento. Envie-lhe o link para a subscrição começar
              a ser cobrada automaticamente.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={handleCheckout} disabled={isCreating} className="gap-2">
                {isCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
                {checkoutUrl ? 'Gerar novo link' : 'Gerar link de pagamento'}
              </Button>
              {checkoutUrl && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    navigator.clipboard.writeText(checkoutUrl);
                    toast.success('Link copiado');
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copiar link
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-2.5">
              <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">
                  Faturação fiscal recorrente
                  {fiscalDirty && <span className="ml-2 text-xs font-normal text-amber-600">Alterações por guardar</span>}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Define o documento e o envio de email para cada ciclo desta venda.
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveFiscal}
              disabled={!fiscalDirty || configureFiscal.isPending || !canConfigureFiscal}
            >
              {configureFiscal.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Guardar
            </Button>
          </div>
          <RecurringFiscalSettings
            value={fiscalDraft}
            onChange={(next) => {
              setFiscalDraft(next);
              setFiscalDirty(true);
            }}
            clientEmail={recurrence.client_email}
            disabled={configureFiscal.isPending || !canConfigureFiscal}
            automaticDisabled={!keyInvoiceActive}
            compact
          />
          {!canConfigureFiscal && (
            <p className="text-xs text-muted-foreground">
              Precisas da permissão Financeiro → Faturas → Emitir para alterar esta configuração.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Ciclos ({cycles.length})
          </p>
          {cycles.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Ainda não há ciclos. O primeiro é criado na data de renovação.
            </p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {cycles.map((cycle) => (
                <div
                  key={cycle.id}
                  className="rounded-md border p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <CycleIcon status={cycle.status} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium capitalize">
                          {monthLabel(cycle.period_start)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {CYCLE_LABEL[cycle.status]}
                          {cycle.paid_at &&
                            ` · ${new Date(cycle.paid_at).toLocaleDateString('pt-PT')}`}
                          {cycle.failure_reason && ` · ${cycle.failure_reason}`}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-medium">
                      {formatCurrency(Number(cycle.amount))}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 border-t pt-3 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <Badge variant="outline" className={fiscalTone(cycle.fiscal_status)}>
                        {recurrence.fiscal_mode === 'manual' && cycle.fiscal_status === 'not_scheduled'
                          ? 'Emissão manual'
                          : cycle.fiscal_status === 'partial'
                            ? recurrence.fiscal_document_policy === 'invoice_then_receipt'
                              ? 'FT emitida · RC pendente'
                              : 'A aguardar pagamento integral'
                            : FISCAL_LABEL[cycle.fiscal_status]}
                      </Badge>
                    </div>

                    <div className={cn('flex min-w-0 items-center gap-1.5', emailTone(cycle.fiscal_email_status))}>
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {recurrence.fiscal_auto_email
                          ? EMAIL_LABEL[cycle.fiscal_email_status]
                          : 'Envio automático desativado'}
                      </span>
                    </div>

                    {(cycle.fiscal_status === 'retry' || cycle.fiscal_email_status === 'retry') && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => retryFiscalCycle.mutate(cycle.id)}
                        disabled={retryFiscalCycle.isPending || !canConfigureFiscal}
                      >
                        <RotateCcw className={cn('h-3.5 w-3.5', retryFiscalCycle.isPending && 'animate-spin')} />
                        Repetir agora
                      </Button>
                    )}
                  </div>

                  {cycle.fiscal_documents.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {cycle.fiscal_documents.map((document) => {
                        const reference = document.reference
                          || [document.provider_series, document.provider_document_number].filter(Boolean).join('/')
                          || `Documento ${document.id.slice(0, 8)}`;
                        return (
                          <div key={document.id} className="flex items-start gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate font-medium">{reference}</span>
                              </div>
                              {document.provider_atcud && (
                                <p className="mt-0.5 text-[11px] text-muted-foreground">ATCUD {document.provider_atcud}</p>
                              )}
                              {document.email_status && (
                                <p className={cn('mt-0.5 text-[11px]', emailTone(document.email_status))}>
                                  Email: {EMAIL_LABEL[document.email_status]}
                                </p>
                              )}
                            </div>
                            {document.pdf_path && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                title="Abrir PDF"
                                aria-label={`Abrir PDF de ${reference}`}
                                onClick={() => handleOpenFiscalPdf(document.id, document.pdf_path!)}
                                disabled={viewingFiscalDocumentId === document.id}
                              >
                                {viewingFiscalDocumentId === document.id
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <FileDown className="h-3.5 w-3.5" />}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {cycle.fiscal_last_error && (
                    <div className="mt-2 flex gap-2 rounded-md bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="break-words">{cycle.fiscal_last_error}</span>
                    </div>
                  )}
                  {cycle.fiscal_documents
                    .filter((document) => document.email_last_error)
                    .map((document) => (
                      <div key={`${document.id}-email-error`} className="mt-2 flex gap-2 rounded-md bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
                        <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="break-words">{document.email_last_error}</span>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
