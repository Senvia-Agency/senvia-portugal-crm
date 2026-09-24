export interface SaleBillingClient {
  name?: string | null
  nif?: string | null
  company?: string | null
  company_nif?: string | null
  billing_target?: string | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  postal_code?: string | null
  country?: string | null
  company_address_line1?: string | null
  company_address_line2?: string | null
  company_city?: string | null
  company_postal_code?: string | null
  company_country?: string | null
}

export function saleBillingRecipient(sale: {
  billing_target?: string | null
  client?: SaleBillingClient | null
}): { target: 'client' | 'company'; name: string; nif: string; address: string; addressLine2: string; city: string; postalCode: string; country: string } {
  const client = sale.client
  // A per-sale choice is immutable for this sale. Only legacy sales use the
  // client-level preference; never pair a company name with a personal NIF.
  const target = (sale.billing_target ?? client?.billing_target) === 'company' ? 'company' : 'client'
  return {
    target,
    name: String((target === 'company' ? client?.company : client?.name) ?? '').trim(),
    nif: String((target === 'company' ? client?.company_nif : client?.nif) ?? '').trim(),
    address: String((target === 'company' ? client?.company_address_line1 : client?.address_line1) ?? '').trim(),
    addressLine2: String((target === 'company' ? client?.company_address_line2 : client?.address_line2) ?? '').trim(),
    city: String((target === 'company' ? client?.company_city : client?.city) ?? '').trim(),
    postalCode: String((target === 'company' ? client?.company_postal_code : client?.postal_code) ?? '').trim(),
    country: String((target === 'company' ? client?.company_country : client?.country) ?? '').trim(),
  }
}

export function requireCompanyFiscalAddress(recipient: ReturnType<typeof saleBillingRecipient>): void {
  if (recipient.target === 'company' && (!recipient.address || !recipient.city || !recipient.postalCode || !recipient.country)) {
    throw new Error('Preencha a morada fiscal, localidade, código postal e país da empresa na ficha do cliente antes de emitir.')
  }
}
