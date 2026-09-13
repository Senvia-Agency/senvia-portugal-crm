export interface StripePlan {
  id: string;
  name: string;
  priceId: string;
  productId: string;
  priceMonthly: number;
  // Annual total (EUR). The monthly-equivalent shown to the user is priceYearly/12.
  priceYearly: number;
  // Stripe price id for the annual plan. Empty until configured in Stripe — the
  // UI shows the annual price but blocks annual checkout while this is missing.
  priceIdYearly?: string;
  description: string;
  features: string[];
  modules: string[];
  integrations: string[];
  limits: { users: string; forms: string; inboxes: string };
  highlighted?: boolean;
}

// Caixas de entrada são multicanal: cada caixa pode ligar WhatsApp, Instagram,
// Facebook (Messenger) ou Email, e todas as conversas chegam num só lugar.
export const INBOX_EXPLAINER =
  "Caixas de entrada de email. Os canais WhatsApp, Instagram e Messenger estão em preparação.";

// Annual billing is ~35% cheaper than paying month-to-month.
export const YEARLY_DISCOUNT_PCT = 0;

export type BillingPeriod = "monthly" | "yearly";

// What the customer effectively pays per month on each plan/period.
export const monthlyPrice = (plan: StripePlan, period: BillingPeriod) =>
  period === "yearly" ? Math.round(plan.priceYearly / 12) : plan.priceMonthly;

export const SENVIA_OS_PLAN: StripePlan = {
  id: "starter", name: "SENVIA OS",
  priceId: "price_1T2uHzLWnA81DzXTHdexakfL", productId: "prod_U0wAc7Tuy8w6gA",
  priceMonthly: 49, priceYearly: 588,
  description: "Todas as funcionalidades, com uma equipa à tua medida.",
  modules: ["Leads e clientes", "Calendário e propostas", "Vendas e comissões", "Marketing", "Financeiro", "Prospects", "Caixa de entrada de email"],
  integrations: ["Meta Pixels", "Faturação (KeyInvoice, InvoiceXpress)", "Pagamentos (Stripe)"],
  limits: { users: "Até 5", forms: "Formulários ilimitados", inboxes: "Caixas ilimitadas" },
  features: ["Todas as funcionalidades", "5 utilizadores incluídos", "Utilizadores adicionais a 5 €/mês", "Formulários e caixas de entrada ilimitados"],
};
export const STRIPE_PLANS: StripePlan[] = [SENVIA_OS_PLAN];
export const getPlanById = (id: string) => ['basic', 'starter', 'pro', 'elite'].includes(id) ? STRIPE_PLANS[0] : undefined;
export const getPlanByProductId = (id: string) => ['prod_U0wAc7Tuy8w6gA', 'prod_U0wGoA4odOBHOZ', 'prod_U0wG6doz0zgZFV'].includes(id) ? STRIPE_PLANS[0] : undefined;
