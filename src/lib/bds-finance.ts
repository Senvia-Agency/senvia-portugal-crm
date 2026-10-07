export const BDS_ORGANIZATION_NAME = 'BDS Telecomunicações';

export function isBdsOrganization(name: string | null | undefined): boolean {
  return name === BDS_ORGANIZATION_NAME;
}

export function parseChargebackAmount(value: string): number | null {
  const normalized = value.trim().replace(/\s|€/g, '').replace(',', '.');
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}
