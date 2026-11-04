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
import { PROPOSAL_STATUS_LABELS, PROPOSAL_STATUSES, PROPOSAL_TYPE_LABELS, type ProposalStatus } from '@/types/proposals';
import { useLanguage, intlLocale } from "@/i18n";

// How other systems name the proposal states.
const PROPOSAL_STATUS_SYNONYMS: Record<string, ProposalStatus> = {
  'Negociação': 'negotiating', 'Pendente': 'sent', 'Em aberto': 'sent', 'Aberta': 'sent',
  'Aceita': 'accepted', 'Aprovada': 'accepted', 'Ganha': 'accepted', 'Adjudicada': 'accepted',
  'Rejeitada': 'rejected', 'Perdida': 'rejected', 'Recusado': 'rejected', 'Expirado': 'expired',
};

interface ImportProposalsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** Proposals from a spreadsheet: each line finds (or creates) its client; no automation fires. */
export function ImportProposalsDialog({ open, onOpenChange }: ImportProposalsDialogProps) {
  const { t } = useLanguage();
  const { organization, user } = useAuth();
  const { data: team = [] } = useTeamMembers();
  const queryClient = useQueryClient();
  const isTelecom = organization?.niche === 'telecom';
  const [seller, setSeller] = useState(NOBODY);
  const [createClients, setCreateClients] = useState(true);
  const [defaultStatus, setDefaultStatus] = useState<ProposalStatus>('sent');

  const fields = useMemo<readonly ImportField[]>(() => [
    ...DEAL_CLIENT_FIELDS,
    { key: 'date', label: 'Data da proposta', aliases: ['Data', 'Data da proposta', 'Data proposta', 'Date'], hint: 'Vazia: hoje.' },
    { key: 'status', label: 'Estado', aliases: ['Estado', 'Status', 'Situação'], hint: 'Rascunho, Enviada, Em negociação, Aceite, Recusada ou Expirada.' },
    { key: 'value', label: 'Valor (€)', aliases: ['Valor', 'Total', 'Valor total', 'Montante', 'Value'] },
    ...(isTelecom ? [{ key: 'type', label: 'Tipo', aliases: ['Tipo', 'Tipo de proposta', 'Type'], hint: 'Energia ou Outros serviços.' }] : []),
    DEAL_SELLER_FIELD,
    DEAL_REFERENCE_FIELD,
    { key: 'notes', label: 'Notas', aliases: ['Notas', 'Observações', 'Observacoes', 'Descrição', 'Notes'] },
  ], [isTelecom]);

  const plan = async (records: ImportRecord[]): Promise<ImportPlanRow<DealDraft>[]> => {
    if (!organization || !user) throw new Error(t('Sem organização ativa.'));
    const index = await loadClientIndex(organization.id);
    const fallbackSeller = seller === NOBODY ? user.id : seller;
    return records.map((record, position) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const client = resolveDealClient(record, index, createClients, organization.id, errors, warnings);
      const value = parseImportNumber(record.value);
      if (record.value && value === null) errors.push(t('Valor ilegível: {{value}}', { value: record.value }));
      const date = parseImportDate(record.date);
      if (record.date && !date) errors.push(t('Data ilegível: {{value}}', { value: record.date }));
      const status = record.status ? matchImportOption(record.status, PROPOSAL_STATUS_LABELS, PROPOSAL_STATUS_SYNONYMS) : defaultStatus;
      if (!status) errors.push(t('Estado desconhecido: {{value}}', { value: record.status }));
      const type = record.type ? matchImportOption(record.type, PROPOSAL_TYPE_LABELS) : null;
      if (record.type && !type) warnings.push(t('Tipo desconhecido, fica sem tipo: {{value}}', { value: record.type }));
      const owner = resolveSeller(record, team, fallbackSeller, warnings);
      const today = new Date().toISOString().slice(0, 10);
      const label = record.client_name || '—';
      return {
        line: position + 2,
        label,
        detail: [formatImportDay(date) ?? t('hoje'), status ? t(PROPOSAL_STATUS_LABELS[status]) : null, value !== null ? `${value.toLocaleString(intlLocale())} €` : null].filter(Boolean).join(' · '),
        errors,
        warnings,
        data: errors.length || !client || !status ? null : {
          client,
          label,
          row: {
            organization_id: organization.id,
            total_value: value ?? 0,
            status,
            proposal_date: date ?? today,
            accepted_at: status === 'accepted' ? date ?? today : null,
            proposal_type: type,
            notes: dealNotes(record),
            created_by: owner,
          },
        },
      };
    });
  };

  return (
    <ImportWizard<DealDraft>
      open={open}
      onOpenChange={onOpenChange}
      title={t("Importar propostas")}
      description={t("Carrega um Excel ou CSV com uma proposta por linha. Cada linha é ligada ao seu cliente, e a importação não dispara automações.")}
      noun="propostas"
      nounOne="proposta"
      fields={fields}
      settingsKey={`${seller}|${createClients}|${defaultStatus}`}
      settings={
        <DealImportSettings people={team} seller={seller} onSeller={setSeller} createClients={createClients} onCreateClients={setCreateClients}>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("Estado quando a linha não diz")}</Label>
            <Select value={defaultStatus} onValueChange={(value) => setDefaultStatus(value as ProposalStatus)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROPOSAL_STATUSES.map((status) => <SelectItem key={status} value={status}>{t(PROPOSAL_STATUS_LABELS[status])}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </DealImportSettings>
      }
      plan={plan}
      run={async (drafts, onProgress) => {
        const result = await runDealImport('proposals', drafts, onProgress);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['proposals'] }),
          queryClient.invalidateQueries({ queryKey: ['clients'] }),
        ]);
        return result;
      }}
    />
  );
}
