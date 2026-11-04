// Writing imported records and finding what the lines refer to (clients, people).
import { supabase } from '@/integrations/supabase/client';
import { cleanImportNif, normalizeHeader } from '@/lib/import/parse';
import type { ImportRunResult } from '@/components/shared/import/ImportWizard';

export type ImportTable = 'crm_clients' | 'proposals' | 'sales';

type SilentImportRpc = (
  fn: 'import_records_silently',
  args: { p_table: ImportTable; p_rows: Record<string, unknown>[] },
) => Promise<{ data: unknown; error: { message: string } | null }>;

const CHUNK = 200;

const callImport = async (table: ImportTable, rows: Record<string, unknown>[]) => {
  // The function is newer than the generated Supabase types.
  const rpc = supabase.rpc.bind(supabase) as unknown as SilentImportRpc;
  const { data, error } = await rpc('import_records_silently', { p_table: table, p_rows: rows });
  if (error) {
    if (/import_records_silently/.test(error.message) && /(not find|does not exist)/i.test(error.message)) {
      throw new Error('Falta instalar a importação na base de dados (SQL 20261102120000_silent_record_import).');
    }
    throw new Error(error.message);
  }
  return (data ?? []) as Record<string, unknown>[];
};

/**
 * Inserts rows through import_records_silently, which keeps automations off.
 * A chunk that fails is retried line by line, so one bad line does not sink the others.
 */
export async function insertSilently(
  table: ImportTable,
  rows: Record<string, unknown>[],
  onProgress: (done: number, total: number) => void,
  describe: (row: Record<string, unknown>) => string,
): Promise<ImportRunResult & { readonly rows: Record<string, unknown>[] }> {
  const inserted: Record<string, unknown>[] = [];
  const errors: string[] = [];
  let failed = 0;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    try {
      inserted.push(...await callImport(table, chunk));
    } catch (chunkError) {
      if (chunkError instanceof Error && chunkError.message.startsWith('Falta instalar')) throw chunkError;
      for (const row of chunk) {
        try {
          inserted.push(...await callImport(table, [row]));
        } catch (rowError) {
          failed += 1;
          errors.push(`${describe(row)}: ${rowError instanceof Error ? rowError.message : 'erro'}`);
        }
      }
    }
    onProgress(Math.min(start + CHUNK, rows.length), rows.length);
  }
  return { inserted: inserted.length, failed, errors, rows: inserted };
}

export interface ImportClientRef {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly email: string | null;
  readonly nif: string | null;
  readonly company_nif: string | null;
  readonly lead_id: string | null;
}

/** Every client of the organization, indexed by code, NIF, email and name. */
export class ClientIndex {
  private readonly byKey = new Map<string, ImportClientRef>();

  constructor(clients: readonly ImportClientRef[]) {
    for (const client of clients) this.add(client);
  }

  add(client: ImportClientRef) {
    const keys = [
      client.code && `code:${normalizeHeader(client.code)}`,
      client.nif && `nif:${cleanImportNif(client.nif)}`,
      client.company_nif && `nif:${cleanImportNif(client.company_nif)}`,
      client.email && `email:${client.email.trim().toLowerCase()}`,
      client.name && `name:${normalizeHeader(client.name)}`,
    ];
    for (const key of keys) if (key && !this.byKey.has(key)) this.byKey.set(key, client);
  }

  /** The strongest identifier wins: code, then NIF, then email, then the exact name. */
  find(ref: { code?: string | null; nif?: string | null; email?: string | null; name?: string | null }): ImportClientRef | null {
    const keys = [
      ref.code && `code:${normalizeHeader(ref.code)}`,
      ref.nif && `nif:${cleanImportNif(ref.nif)}`,
      ref.email && `email:${ref.email.trim().toLowerCase()}`,
      ref.name && `name:${normalizeHeader(ref.name)}`,
    ];
    for (const key of keys) {
      const client = key ? this.byKey.get(key) : undefined;
      if (client) return client;
    }
    return null;
  }
}

export async function loadClientIndex(organizationId: string): Promise<ClientIndex> {
  const clients: ImportClientRef[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('crm_clients')
      .select('id, name, code, email, nif, company_nif, lead_id')
      .eq('organization_id', organizationId)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    clients.push(...(data ?? []) as ImportClientRef[]);
    if (!data || data.length < 1000) break;
  }
  return new ClientIndex(clients);
}

export interface ImportPerson {
  readonly user_id: string;
  readonly full_name: string | null;
  readonly email?: string | null;
}

/** A team member written in a cell by name, first name or email. */
export function findPerson(people: readonly ImportPerson[], raw: string): ImportPerson | null {
  const wanted = normalizeHeader(raw);
  if (!wanted) return null;
  return people.find((person) => normalizeHeader(person.full_name ?? '') === wanted || normalizeHeader(person.email ?? '') === wanted)
    ?? people.find((person) => normalizeHeader((person.full_name ?? '').split(' ')[0]) === wanted)
    ?? null;
}
