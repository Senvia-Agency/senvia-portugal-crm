export type ConfirmationCopy = {
  readonly title: string;
  readonly summary: string;
  readonly destination: `/${string}`;
};

export const CONFIRMATION_COPY: Readonly<Record<string, ConfirmationCopy>> = {
  create_lead: {
    title: "Criar lead",
    summary: "O Otto vai criar uma lead no CRM com os dados revistos.",
    destination: "/leads",
  },
  create_client: {
    title: "Criar cliente",
    summary: "O Otto vai criar um cliente no CRM com os dados revistos.",
    destination: "/clients",
  },
  update_lead_status: {
    title: "Alterar etapa da lead",
    summary: "O Otto vai mover a lead para a etapa selecionada.",
    destination: "/leads",
  },
  create_sale: {
    title: "Registar venda",
    summary: "O Otto vai registar a venda e aplicar a atribuição indicada.",
    destination: "/sales",
  },
  update_sale_seller: {
    title: "Alterar comercial da venda",
    summary: "O Otto vai alterar o comercial responsável pela venda.",
    destination: "/sales",
  },
  create_proposal: {
    title: "Criar proposta",
    summary: "O Otto vai criar uma proposta em rascunho para a lead indicada.",
    destination: "/proposals",
  },
  set_company_info: {
    title: "Atualizar dados da empresa",
    summary: "O Otto vai atualizar os campos da organização apresentados.",
    destination: "/settings",
  },
  setup_pipeline_stages: {
    title: "Criar etapas do pipeline",
    summary: "O Otto vai criar as etapas do pipeline pela ordem apresentada.",
    destination: "/settings",
  },
  configure_invoicing: {
    title: "Configurar faturação",
    summary: "O Otto vai guardar a configuração de faturação indicada.",
    destination: "/settings",
  },
  configure_brevo: {
    title: "Configurar Brevo",
    summary: "O Otto vai guardar a configuração Brevo indicada.",
    destination: "/settings",
  },
  setup_lead_autoreply: {
    title: "Configurar resposta automática",
    summary: "O Otto vai guardar as perguntas, regras e mensagens apresentadas.",
    destination: "/settings",
  },
  set_modules: {
    title: "Alterar módulos",
    summary: "O Otto vai aplicar as ativações e desativações de módulos apresentadas.",
    destination: "/settings",
  },
  complete_onboarding: {
    title: "Concluir configuração inicial",
    summary: "O Otto vai marcar a configuração inicial como concluída.",
    destination: "/settings",
  },
  submit_support_ticket: {
    title: "Criar ticket de suporte",
    summary: "O Otto vai criar o ticket com o resumo e contactos confirmados.",
    destination: "/settings",
  },
  create_overdue_payment_followup_draft: {
    title: "Criar rascunho de automação",
    summary: "O Otto vai criar um rascunho inativo para o seguimento de cobranças pendentes há pelo menos 10 dias.",
    destination: "/automacoes",
  },
  issue_invoice: {
    title: "Emitir fatura",
    summary: "Fatura emitida pelo fornecedor fiscal.",
    destination: "/financeiro/faturas",
  },
  cancel_invoice: {
    title: "Anular documento fiscal",
    summary: "Documento fiscal anulado ou revertido pelo fornecedor.",
    destination: "/financeiro/faturas",
  },
  send_invoice_email: {
    title: "Enviar documento fiscal",
    summary: "Documento fiscal enviado por email.",
    destination: "/financeiro/faturas",
  },
  create_expense: {
    title: "Registar despesa",
    summary: "Despesa registada no Financeiro.",
    destination: "/financeiro/despesas",
  },
  update_expense: {
    title: "Atualizar despesa",
    summary: "Despesa atualizada no Financeiro.",
    destination: "/financeiro/despesas",
  },
  delete_expense: {
    title: "Eliminar despesa",
    summary: "Despesa eliminada do Financeiro.",
    destination: "/financeiro/despesas",
  },
};
