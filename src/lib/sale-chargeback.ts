/** An automatic chargeback stops applying as soon as its sale is active again. */
export function isSaleChargebackApplicable(row: {
  sale?: { telecom_status?: string | null } | null;
}): boolean {
  return row.sale?.telecom_status !== 'ativo' && row.sale?.telecom_status !== 'instalado';
}
