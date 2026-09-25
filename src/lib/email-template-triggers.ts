export const EMAIL_TEMPLATE_TRIGGERS = {
  invoice: 'invoice_email',
  invoice_receipt: 'invoice_receipt_email',
  receipt: 'receipt_email',
  credit_note: 'credit_note_email',
  proposal: 'proposal_email',
  lead: 'lead_email',
  eventInvitation: 'event_invitation_email',
  teamAccess: 'team_access_email',
} as const;

export const EMAIL_TEMPLATE_TRIGGER_LABELS: Record<string, string> = {
  [EMAIL_TEMPLATE_TRIGGERS.invoice]: 'Fatura',
  [EMAIL_TEMPLATE_TRIGGERS.invoice_receipt]: 'Fatura-Recibo',
  [EMAIL_TEMPLATE_TRIGGERS.receipt]: 'Recibo',
  [EMAIL_TEMPLATE_TRIGGERS.credit_note]: 'Nota de Crédito',
  [EMAIL_TEMPLATE_TRIGGERS.proposal]: 'Proposta',
  [EMAIL_TEMPLATE_TRIGGERS.lead]: 'Email manual para Lead',
  [EMAIL_TEMPLATE_TRIGGERS.eventInvitation]: 'Convite de reunião',
  [EMAIL_TEMPLATE_TRIGGERS.teamAccess]: 'Acesso à equipa',
};

export function getFiscalEmailTrigger(documentType: keyof Pick<typeof EMAIL_TEMPLATE_TRIGGERS, 'invoice' | 'invoice_receipt' | 'receipt' | 'credit_note'>): string {
  return EMAIL_TEMPLATE_TRIGGERS[documentType];
}

export function isManualEmailTrigger(triggerType: string): boolean {
  return Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATE_TRIGGER_LABELS, triggerType);
}
