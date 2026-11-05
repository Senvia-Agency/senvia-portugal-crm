export interface AutomationPreviewContact {
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly company?: string | null;
  readonly companyNif?: string | null;
  readonly nif?: string | null;
  readonly source?: string | null;
}

export function automationPreviewVariables(runContext: Readonly<Record<string, unknown>>, contact: AutomationPreviewContact | null): Readonly<Record<string, unknown>> {
  if (!contact) return runContext;
  return {
    nome: contact.name.trim(), primeiro_nome: contact.name.trim().split(/\s+/)[0], name: contact.name,
    email: contact.email, telefone: contact.phone, phone: contact.phone,
    company: contact.company, company_name: contact.company, empresa: contact.company,
    company_nif: contact.companyNif, nif: contact.companyNif ?? contact.nif,
    source: contact.source, fonte: contact.source,
  };
}
