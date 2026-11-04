import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { DealImportSettings, NOBODY } from '@/components/shared/import/DealImportSettings';
import { ImportWizard, type ImportField, type ImportPlanRow, type ImportRecord } from '@/components/shared/import/ImportWizard';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers } from '@/hooks/useTeam';
import {
  DEAL_CLIENT_FIELDS, DEAL_REFERENCE_FIELD, DEAL_SELLER_FIELD,
  dealNotes, resolveDealClient, resolveSeller, runDealImport, type DealDraft,
} from '@/lib/import/deals';
import { formatImportDay, matchImportOption, parseImportDate, parseImportNumber } from '@/lib/import/parse';
import { loadClientIndex } from '@/lib/import/records';
import { PROPOSAL_TYPE_LABELS } from '@/types/proposals';
import {
  PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, SALE_STATUS_LABELS, SALE_STATUSES,
  TELECOM_STATUS_LABELS, TELECOM_STATUSES, TELECOM_TO_SALE_STATUS,
  type PaymentStatus, type SaleStatus, type TelecomStatus,
} from '@/types/sales';
import { useLanguage, intlLocale } from "@/i18n";

// How other systems name the sale states.
const SALE_STATUS_SYNONYMS: Record<string, string> = {
  'Em curso': 'in_progress', 'Pendente': 'in_progress', 'Aberta': 'in_progress', 'Em aberto': 'in_progress',
  'Concluído': 'delivered', 'Fechada': 'delivered', 'Ganha': 'delivered', 'Faturada': 'delivered',
  'Entregue': 'fulfilled', 'Cancelada': 'cancelled', 'Anulada': 'cancelled',
};
const TELECOM_STATUS_SYNONYMS: Record<string, string> = {
  'Instalada': 'instalado', 'Ativa': 'ativo', 'Concluída': 'instalado', 'Anulada': 'anulado', 'Cancelada': 'cancelado',
};

interface ImportSalesDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Past sales from a spreadsheet. They come in as history: no Fatura or receipt is
 * issued, nothing is emailed, no renewal or automation fires.
 */
export function ImportSalesDialog({ open, onOpenChange }: ImportSalesDialogProps) {
  const { t } = useLanguage();
  const { organization, user } = useAuth();
  const { data: team = [] } = useTeamMembers();
  const queryClient = useQueryClient();
  const isTelecom = organization?.niche === 'telecom';
  const [seller, setSeller] = useState(NOBODY);
  const [createClients, setCreateClients] = useState(true);
  const [defaultStatus, setDefaultStatus] = useState<string>(isTelecom ? 'instalado' : 'delivered');
  const [defaultPayment, setDefaultPayment] = useState<PaymentStatus>('paid');

  const statusLabels: Record<string, string> = isTelecom ? TELECOM_STATUS_LABELS : SALE_STATUS_LABELS;
  const statusKeys: readonly string[] = isTelecom ? TELECOM_STATUSES : SALE_STATUSES;

  const fields = useMemo<readonly ImportField[]>(() => [
    ...DEAL_CLIENT_FIELDS,
    { key: 'date', label: 'Data da venda', aliases: ['Data', 'Data da venda', 'Data venda', 'Date'], hint: 'Vazia: hoje.' },
    { key: 'status', label: 'Estado', aliases: ['Estado', 'Status', 'Situação'],
      hint: Object.values(isTelecom ? TELECOM_STATUS_LABELS : SALE_STATUS_LABELS).map((label) => t(label)).join(', ') + '.' },
    ...(isTelecom
      ? [
        { key: 'commission', label: 'Comissão (€)', aliases: ['Comissão', 'Comissao', 'Commission'] },
        { key: 'activation', label: 'Data de ativação', aliases: ['Data de ativação', 'Data ativação', 'Ativação', 'Data de adjudicação'] },
        { key: 'type', label: 'Tipo', aliases: ['Tipo', 'Tipo de venda', 'Type'], hint: 'Energia ou Outros serviços.' },
      ]
      : [
        { key: 'value', label: 'Valor (€)', aliases: ['Valor', 'Total', 'Valor total', 'Montante', 'Value'] },
        { key: 'payment', label: 'Pagamento', aliases: ['Pagamento', 'Estado do pagamento', 'Pago'], hint: 'Pendente, Parcial ou Pago.' },
        { key: 'method', label: 'Método de pagamento', aliases: ['Método', 'Metodo', 'Método de pagamento', 'Forma de pagamento'] },
        { key: 'invoice', label: 'Nº da fatura', aliases: ['Fatura', 'Nº fatura', 'Numero fatura', 'Invoice'] },
      ]),
    DEAL_SELLER_FIELD,
    DEAL_REFERENCE_FIELD,
    { key: 'notes', label: 'Notas', aliases: ['Notas', 'Observações', 'Observacoes', 'Descrição', 'Notes'] },
  ], [isTelecom, t]);

  const plan = async (records: ImportRecord[]): Promise<ImportPlanRow<DealDraft>[]> => {
    if (!organization || !user) throw new Error(t('Sem organização ativa.'));
    const index = await loadClientIndex(organization.id);
    const fallbackSeller = seller === NOBODY ? user.id : seller;
    const today = new Date().toISOString().slice(0, 10);
    return records.map((record, position) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const client = resolveDealClient(record, index, createClients, organization.id, errors, warnings);
      const date = parseImportDate(record.date);
      if (record.date && !date) errors.push(t('Data ilegível: {{value}}', { value: record.date }));
      const pickedStatus = record.status
        ? matchImportOption(record.status, statusLabels, isTelecom ? TELECOM_STATUS_SYNONYMS : SALE_STATUS_SYNONYMS)
        : defaultStatus;
      if (!pickedStatus) errors.push(t('Estado desconhecido: {{value}}', { value: record.status }));
      const owner = resolveSeller(record, team, fallbackSeller, warnings);
      const saleDate = date ?? today;

      const row: Record<string, unknown> = {
        organization_id: organization.id,
        sale_date: saleDate,
        notes: dealNotes(record),
        created_by: user.id,
        seller_id: owner,
        // History, not new business: no Fatura, receipt, email, renewal or Meta purchase event.
        fiscal_auto_invoices: false,
        fiscal_auto_receipts: false,
        fiscal_auto_email: false,
        has_recurring: false,
        meta_capi_purchase_sent_at: new Date().toISOString(),
      };
      let detail: (string | null)[] = [formatImportDay(saleDate)];

      if (isTelecom) {
        const telecom = pickedStatus as TelecomStatus | null;
        const commission = parseImportNumber(record.commission);
        if (record.commission && commission === null) errors.push(t('Comissão ilegível: {{value}}', { value: record.commission }));
        const activation = parseImportDate(record.activation);
        if (record.activation && !activation) errors.push(t('Data de ativação ilegível: {{value}}', { value: record.activation }));
        const type = record.type ? matchImportOption(record.type, PROPOSAL_TYPE_LABELS) : null;
        if (record.type && !type) warnings.push(t('Tipo desconhecido, fica sem tipo: {{value}}', { value: record.type }));
        Object.assign(row, {
          telecom_status: telecom,
          status: telecom ? TELECOM_TO_SALE_STATUS[telecom] : null,
          comissao: commission,
          activation_date: activation,
          proposal_type: type,
          total_value: 0,
          subtotal: 0,
          payment_status: 'pending',
        });
        detail = [formatImportDay(saleDate), telecom ? t(TELECOM_STATUS_LABELS[telecom]) : null, commission !== null ? t('comissão {{value}} €', { value: commission.toLocaleString(intlLocale()) }) : null];
      } else {
        const value = parseImportNumber(record.value);
        if (record.value && value === null) errors.push(t('Valor ilegível: {{value}}', { value: record.value }));
        // "Pago", "paid", or a yes/no column.
        const paymentStatus: PaymentStatus | null = !record.payment
          ? defaultPayment
          : matchImportOption(record.payment, PAYMENT_STATUS_LABELS)
            ?? matchImportOption(record.payment, { paid: 'Sim', pending: 'Não' } as Record<PaymentStatus, string>);
        if (!paymentStatus) errors.push(t('Pagamento desconhecido: {{value}}', { value: record.payment }));
        const method = record.method ? matchImportOption(record.method, PAYMENT_METHOD_LABELS) : null;
        if (record.method && !method) warnings.push(t('Método desconhecido, fica vazio: {{value}}', { value: record.method }));
        Object.assign(row, {
          status: pickedStatus as SaleStatus | null,
          total_value: value ?? 0,
          subtotal: value ?? 0,
          payment_status: paymentStatus,
          paid_date: paymentStatus === 'paid' ? saleDate : null,
          payment_method: method,
          invoice_reference: record.invoice || null,
        });
        detail = [formatImportDay(saleDate), pickedStatus ? t(SALE_STATUS_LABELS[pickedStatus as SaleStatus]) : null,
          value !== null ? `${value.toLocaleString(intlLocale())} €` : null, paymentStatus ? t(PAYMENT_STATUS_LABELS[paymentStatus]) : null];
      }

      const label = record.client_name || '—';
      return {
        line: position + 2,
        label,
        detail: detail.filter(Boolean).join(' · '),
        errors,
        warnings,
        data: errors.length || !client || !pickedStatus ? null : { client, label, row },
      };
    });
  };

  return (
    <ImportWizard<DealDraft>
      open={open}
      onOpenChange={onOpenChange}
      title={t("Importar vendas")}
      description={t("Carrega um Excel ou CSV com uma venda por linha. Entram como histórico: não emitem faturas nem recibos, não enviam emails e não disparam automações.")}
      noun="vendas"
      nounOne="venda"
      fields={fields}
      settingsKey={`${seller}|${createClients}|${defaultStatus}|${defaultPayment}`}
      settings={
        <DealImportSettings people={team} seller={seller} onSeller={setSeller} createClients={createClients} onCreateClients={setCreateClients}>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("Estado quando a linha não diz")}</Label>
            <Select value={defaultStatus} onValueChange={setDefaultStatus}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {statusKeys.map((status) => <SelectItem key={status} value={status}>{statusLabels[status]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {!isTelecom && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("Pagamento quando a linha não diz")}</Label>
              <Select value={defaultPayment} onValueChange={(value) => setDefaultPayment(value as PaymentStatus)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[]).map((status) => (
                    <SelectItem key={status} value={status}>{t(PAYMENT_STATUS_LABELS[status])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </DealImportSettings>
      }
      plan={plan}
      run={async (drafts, onProgress) => {
        const result = await runDealImport('sales', drafts, onProgress);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['sales'] }),
          queryClient.invalidateQueries({ queryKey: ['clients'] }),
        ]);
        return result;
      }}
    />
  );
}
