// Shared automation trigger types and delay options
// Used by TemplateAutomationSection in template modals

export const TRIGGER_TYPES = [
  { value: 'lead_created', label: 'Novo Lead Criado' },
  { value: 'lead_status_changed', label: 'Lead Muda de Etapa' },
  { value: 'client_created', label: 'Novo Cliente Criado' },
  { value: 'client_status_changed', label: 'Cliente Muda de Estado' },
  { value: 'sale_status_changed', label: 'Venda Muda de Estado' },
  { value: 'sale_renewal_due_today', label: 'Renovação Vence Hoje' },
  { value: 'sale_renewal_due_in_2_days', label: 'Renovação Vence em 2 Dias' },
  { value: 'proposal_created', label: 'Nova Proposta Criada' },
  { value: 'proposal_status_changed', label: 'Proposta Muda de Estado' },
  // Templates selected by manual send actions.
  { value: 'invoice_email', label: 'Envio Manual: Fatura' },
  { value: 'invoice_receipt_email', label: 'Envio Manual: Fatura-Recibo' },
  { value: 'receipt_email', label: 'Envio Manual: Recibo' },
  { value: 'credit_note_email', label: 'Envio Manual: Nota de Crédito' },
  { value: 'proposal_email', label: 'Envio Manual: Proposta' },
  { value: 'lead_email', label: 'Envio Manual: Lead' },
  { value: 'event_invitation_email', label: 'Envio Manual: Convite de Reunião' },
  { value: 'team_access_email', label: 'Envio Manual: Acesso à Equipa' },
  // Ciclo de vida do trial (disparados pelo cron check-trial-status)
  { value: 'trial_started', label: 'Trial: Início (Boas-vindas)' },
  { value: 'trial_day_3', label: 'Trial: Dia 3' },
  { value: 'trial_day_7', label: 'Trial: Dia 7' },
  { value: 'trial_expiring_3d', label: 'Trial: Faltam 3 Dias' },
  { value: 'trial_expiring_1d', label: 'Trial: Último Dia' },
  { value: 'trial_expired', label: 'Trial: Expirou' },
  // Subscrição Stripe (disparados pelo stripe-webhook)
  { value: 'stripe_subscription_created', label: 'Subscrição: Ativada (pagou)' },
  { value: 'stripe_subscription_renewed', label: 'Subscrição: Renovada' },
  { value: 'stripe_subscription_past_due', label: 'Subscrição: Pagamento em Atraso' },
  { value: 'stripe_subscription_canceled', label: 'Subscrição: Cancelada' },
] as const;

export const DELAY_OPTIONS = [
  { value: 0, label: 'Imediato' },
  { value: 5, label: '5 minutos' },
  { value: 15, label: '15 minutos' },
  { value: 30, label: '30 minutos' },
  { value: 60, label: '1 hora' },
  { value: 360, label: '6 horas' },
  { value: 1440, label: '1 dia' },
  { value: 2880, label: '2 dias' },
  { value: 4320, label: '3 dias' },
  { value: 10080, label: '7 dias' },
] as const;
