import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { ImportWizard, type ImportField, type ImportPlanRow, type ImportRecord } from '@/components/shared/import/ImportWizard';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers } from '@/hooks/useTeam';
import { cleanImportEmail, cleanImportNif, cleanImportText, isValidImportEmail } from '@/lib/import/parse';
import { findPerson, insertSilently, loadClientIndex } from '@/lib/import/records';
import { useLanguage } from "@/i18n";

const FIELDS: readonly ImportField[] = [
  { key: 'name', label: 'Nome', required: true, aliases: ['Nome', 'Name', 'Cliente', 'Nome do cliente', 'Nome completo'] },
  { key: 'email', label: 'Email', aliases: ['Email', 'E-mail', 'Mail', 'Correio eletrónico'] },
  { key: 'phone', label: 'Telefone', aliases: ['Telefone', 'Telemóvel', 'Telemovel', 'Phone', 'Contacto', 'Tel'] },
  { key: 'company', label: 'Empresa', aliases: ['Empresa', 'Company', 'Nome da empresa', 'Organização'] },
  { key: 'nif', label: 'NIF', aliases: ['NIF', 'Contribuinte', 'NIF pessoal', 'VAT'] },
  { key: 'company_nif', label: 'NIF da empresa', aliases: ['NIPC', 'NIF empresa', 'NIF da empresa'] },
  { key: 'address_line1', label: 'Morada', aliases: ['Morada', 'Endereço', 'Endereco', 'Address', 'Rua'] },
  { key: 'postal_code', label: 'Código postal', aliases: ['Código postal', 'Codigo postal', 'CP', 'Postal code'] },
  { key: 'city', label: 'Localidade', aliases: ['Localidade', 'Cidade', 'City', 'Concelho'] },
  { key: 'assigned', label: 'Comercial', aliases: ['Comercial', 'Responsável', 'Responsavel', 'Vendedor', 'Consultor'],
    hint: 'Nome ou email de alguém da equipa.' },
  { key: 'notes', label: 'Notas', aliases: ['Notas', 'Observações', 'Observacoes', 'Notes', 'Obs'] },
];

const NOBODY = '__nobody__';

interface ClientDraft {
  readonly row: Record<string, unknown>;
}

interface ImportClientsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** Clients from any spreadsheet, for any organization; existing clients (same NIF or email) are left alone. */
export function ImportClientsDialog({ open, onOpenChange }: ImportClientsDialogProps) {
  const { t } = useLanguage();
  const { organization } = useAuth();
  const { data: team = [] } = useTeamMembers();
  const queryClient = useQueryClient();
  const [defaultOwner, setDefaultOwner] = useState(NOBODY);

  const plan = async (records: ImportRecord[]): Promise<ImportPlanRow<ClientDraft>[]> => {
    if (!organization) throw new Error(t('Sem organização ativa.'));
    const index = await loadClientIndex(organization.id);
    const seen = new Set<string>();
    return records.map((record, position) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const name = cleanImportText(record.name);
      const email = cleanImportEmail(record.email);
      const nif = cleanImportNif(record.nif);
      const companyNif = cleanImportNif(record.company_nif);
      if (!name) errors.push(t('Sem nome.'));
      if (email && !isValidImportEmail(email)) errors.push(t('Email inválido: {{email}}', { email }));

      const existing = index.find({ nif: nif || companyNif, email });
      if (existing) errors.push(t('Já existe: {{name}}.', { name: `${existing.name}${existing.code ? ` (#${existing.code})` : ''}` }));
      const keys = [nif && `n${nif}`, companyNif && `n${companyNif}`, email && `e${email}`].filter(Boolean) as string[];
      if (keys.some((key) => seen.has(key))) errors.push(t('Repetido no ficheiro (mesmo NIF ou email).'));
      keys.forEach((key) => seen.add(key));

      let owner = defaultOwner === NOBODY ? null : defaultOwner;
      if (record.assigned) {
        const person = findPerson(team, record.assigned);
        if (person) owner = person.user_id;
        else warnings.push(owner
          ? t('Comercial "{{name}}" não está na equipa; fica o comercial por omissão.', { name: record.assigned })
          : t('Comercial "{{name}}" não está na equipa.', { name: record.assigned }));
      }
      if (nif && nif.length !== 9) warnings.push(t('NIF com {{n}} dígitos.', { n: nif.length }));

      return {
        line: position + 2,
        label: name,
        detail: [email, cleanImportText(record.phone), nif || companyNif].filter(Boolean).join(' · '),
        errors,
        warnings,
        data: errors.length ? null : {
          row: {
            organization_id: organization.id,
            name,
            email,
            phone: cleanImportText(record.phone) || null,
            company: cleanImportText(record.company) || null,
            nif,
            company_nif: companyNif,
            address_line1: cleanImportText(record.address_line1) || null,
            postal_code: cleanImportText(record.postal_code) || null,
            city: cleanImportText(record.city) || null,
            notes: cleanImportText(record.notes) || null,
            assigned_to: owner,
            status: 'active',
            source: 'import',
          },
        },
      };
    });
  };

  return (
    <ImportWizard<ClientDraft>
      open={open}
      onOpenChange={onOpenChange}
      title={t("Importar clientes")}
      description={t("Carrega um Excel ou CSV. Os clientes que já existem (mesmo NIF ou email) ficam como estão, e a importação não dispara automações.")}
      noun="clientes"
      nounOne="cliente"
      fields={FIELDS}
      settingsKey={defaultOwner}
      settings={
        <div className="max-w-sm space-y-1.5">
          <Label className="text-xs">{t("Comercial quando a linha não diz")}</Label>
          <Select value={defaultOwner} onValueChange={setDefaultOwner}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NOBODY}>{t("Sem comercial")}</SelectItem>
              {team.filter((member) => !member.is_banned).map((member) => (
                <SelectItem key={member.user_id} value={member.user_id}>{member.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
      plan={plan}
      run={async (drafts, onProgress) => {
        const result = await insertSilently('crm_clients', drafts.map((draft) => draft.row), onProgress, (row) => String(row.name));
        await queryClient.invalidateQueries({ queryKey: ['clients'] });
        return result;
      }}
    />
  );
}
