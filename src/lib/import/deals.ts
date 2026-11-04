// What proposals and sales imports share: which client each line belongs to,
// creating the clients that do not exist yet, and who sold it.
import type { ImportField, ImportRecord, ImportRunResult } from '@/components/shared/import/ImportWizard';
import { cleanImportEmail, cleanImportNif, cleanImportText, isValidImportEmail, normalizeHeader } from '@/lib/import/parse';
import { ClientIndex, findPerson, insertSilently, type ImportClientRef, type ImportPerson, type ImportTable } from '@/lib/import/records';

export const DEAL_CLIENT_FIELDS: readonly ImportField[] = [
  { key: 'client_name', label: 'Cliente', required: true, aliases: ['Cliente', 'Nome do cliente', 'Nome cliente', 'Nome', 'Empresa'] },
  { key: 'client_nif', label: 'NIF do cliente', aliases: ['NIF', 'NIPC', 'Contribuinte', 'NIF cliente'],
    hint: 'Ajuda a encontrar o cliente certo.' },
  { key: 'client_email', label: 'Email do cliente', aliases: ['Email', 'E-mail', 'Email cliente'] },
  { key: 'client_phone', label: 'Telefone do cliente', aliases: ['Telefone', 'Telemóvel', 'Telemovel', 'Contacto'] },
  { key: 'client_code', label: 'Código do cliente', aliases: ['Código cliente', 'Codigo cliente', 'Nº cliente'] },
];

export const DEAL_SELLER_FIELD: ImportField = {
  key: 'seller', label: 'Comercial', aliases: ['Comercial', 'Vendedor', 'Consultor', 'Responsável', 'Responsavel'],
  hint: 'Nome ou email de alguém da equipa.',
};

export const DEAL_REFERENCE_FIELD: ImportField = {
  key: 'reference', label: 'Nº no sistema antigo', aliases: ['Código', 'Codigo', 'Nº', 'Numero', 'Número', 'Referência', 'Referencia', 'ID'],
  hint: 'Fica nas notas; o número no Senvia é dado de novo.',
};

/** The client a line belongs to: one that exists, or one to create before the line. */
export type DealClient =
  | { readonly kind: 'existing'; readonly client: ImportClientRef }
  | { readonly kind: 'new'; readonly key: string; readonly row: Record<string, unknown> };

export interface DealDraft {
  readonly client: DealClient;
  /** The proposal or sale, without client_id (known only once new clients exist). */
  readonly row: Record<string, unknown>;
  readonly label: string;
}

/** Finds the line's client, or describes the one to create; pushes what is wrong into errors. */
export function resolveDealClient(
  record: ImportRecord,
  index: ClientIndex,
  createMissing: boolean,
  organizationId: string,
  errors: string[],
  warnings: string[],
): DealClient | null {
  const name = cleanImportText(record.client_name);
  const nif = cleanImportNif(record.client_nif);
  const email = cleanImportEmail(record.client_email);
  if (email && !isValidImportEmail(email)) warnings.push(`Email do cliente inválido, não usado: ${email}`);
  const usableEmail = email && isValidImportEmail(email) ? email : null;
  const existing = index.find({ code: record.client_code, nif, email: usableEmail, name });
  if (existing) return { kind: 'existing', client: existing };
  if (!name) {
    errors.push('Sem cliente.');
    return null;
  }
  if (!createMissing) {
    errors.push(`Cliente "${name}" não existe.`);
    return null;
  }
  warnings.push(`Cliente novo: ${name}.`);
  return {
    kind: 'new',
    // Lines of the same new client share it.
    key: nif ? `nif:${nif}` : usableEmail ? `email:${usableEmail}` : `name:${normalizeHeader(name)}`,
    row: {
      organization_id: organizationId,
      name,
      email: usableEmail,
      phone: cleanImportText(record.client_phone) || null,
      nif,
      status: 'active',
      source: 'import',
    },
  };
}

/** The seller named on the line, else the default; pushes a warning when the name is unknown. */
export function resolveSeller(record: ImportRecord, people: readonly ImportPerson[], fallback: string | null, warnings: string[]): string | null {
  if (!record.seller) return fallback;
  const person = findPerson(people, record.seller);
  if (person) return person.user_id;
  warnings.push(`Comercial "${record.seller}" não está na equipa; fica ${fallback ? 'o comercial por omissão' : 'sem comercial'}.`);
  return fallback;
}

/** Notes plus the old system's number, so the record can still be found by it. */
export function dealNotes(record: ImportRecord): string | null {
  const notes = cleanImportText(record.notes);
  const reference = cleanImportText(record.reference);
  return [notes, reference && `Nº no sistema antigo: ${reference}`].filter(Boolean).join('\n') || null;
}

/** Creates the new clients first, then the proposals or sales pointing at them. */
export async function runDealImport(
  table: Extract<ImportTable, 'proposals' | 'sales'>,
  drafts: readonly DealDraft[],
  onProgress: (done: number, total: number) => void,
): Promise<ImportRunResult> {
  const newClients = new Map<string, Record<string, unknown>>();
  for (const draft of drafts) {
    if (draft.client.kind === 'new' && !newClients.has(draft.client.key)) newClients.set(draft.client.key, draft.client.row);
  }

  const total = newClients.size + drafts.length;
  const errors: string[] = [];
  let failed = 0;
  const idByKey = new Map<string, ImportClientRef>();
  if (newClients.size > 0) {
    const keys = [...newClients.keys()];
    const created = await insertSilently('crm_clients', [...newClients.values()], (done) => onProgress(done, total), (row) => `Cliente ${String(row.name)}`);
    errors.push(...created.errors);
    // Match each created client back to its key the way the key was made.
    const createdIndex = new ClientIndex(created.rows as unknown as ImportClientRef[]);
    for (const key of keys) {
      const [kind, value] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      const row = newClients.get(key)!;
      const client = createdIndex.find(kind === 'nif' ? { nif: value } : kind === 'email' ? { email: value } : { name: String(row.name) });
      if (client) idByKey.set(key, client);
    }
  }

  const rows: Record<string, unknown>[] = [];
  const labels = new Map<Record<string, unknown>, string>();
  for (const draft of drafts) {
    const client = draft.client.kind === 'existing' ? draft.client.client : idByKey.get(draft.client.key);
    if (!client) {
      failed += 1;
      continue;
    }
    const row = { ...draft.row, client_id: client.id, lead_id: client.lead_id ?? null };
    rows.push(row);
    labels.set(row, draft.label);
  }
  if (failed > 0) errors.push(`${failed} linhas sem cliente: não foi possível criá-lo.`);

  const result = await insertSilently(table, rows, (done) => onProgress(newClients.size + done, total),
    (row) => labels.get(row) || 'linha');
  return { inserted: result.inserted, failed: failed + result.failed, errors: [...errors, ...result.errors] };
}
