const SALE_BILLING_TRIGGERS = new Set([
  "sale_renewal_due_in_2_days",
  "sale_renewal_due_today",
  "sale_renewal_overdue",
]);

export function requiresSingleBillingEnrollment(triggerType: string): boolean {
  return SALE_BILLING_TRIGGERS.has(triggerType);
}
