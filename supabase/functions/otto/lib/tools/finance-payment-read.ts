import type { Tool, ToolContext, ToolResult } from "../types.ts";
import {
  financeNamedResourceSchema,
  financePaymentIdArgsSchema,
  financePaymentSchema,
  financeSearchPaymentsArgsSchema,
} from "./finance-contracts.ts";
import {
  financeClientNames,
  financeError,
  financeInvalidArguments,
  financeVisibleSale,
  financeVisibleSales,
} from "./finance-shared.ts";

async function searchFinancePayments(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = financeSearchPaymentsArgsSchema.safeParse(args);
  if (
    !input.success ||
    (input.data.start_date && input.data.end_date &&
      input.data.start_date > input.data.end_date)
  ) {
    return financeInvalidArguments();
  }
  const maxResults = input.data.max_results ?? 20;
  let query = ctx.supabaseAdmin
    .from("sale_payments")
    .select(
      "id,sale_id,amount,payment_date,payment_method,status,invoice_reference,notes,bank_account_id,created_at,updated_at",
    )
    .eq("organization_id", ctx.orgId)
    .order("payment_date", { ascending: false })
    .limit(maxResults * 4);
  if (input.data.sale_id) query = query.eq("sale_id", input.data.sale_id);
  if (input.data.status) query = query.eq("status", input.data.status);
  if (input.data.start_date) {
    query = query.gte("payment_date", input.data.start_date);
  }
  if (input.data.end_date) {
    query = query.lte("payment_date", input.data.end_date);
  }

  const { data, error } = await query;
  if (error) {
    return financeError(
      "Não foi possível consultar os pagamentos.",
      "payment_search_failed",
    );
  }
  const payments = financePaymentSchema.array().safeParse(data ?? []);
  if (!payments.success) {
    return financeError(
      "A resposta de pagamentos não pôde ser validada.",
      "invalid_payment_response",
    );
  }

  const sales = await financeVisibleSales(
    ctx,
    payments.data.map(({ sale_id }) => sale_id),
  );
  if (!sales.ok) return sales.result;
  const visible = payments.data.filter(({ sale_id }) =>
    sales.value.has(sale_id)
  ).slice(0, maxResults);
  const clients = await financeClientNames(
    ctx,
    [...sales.value.values()].flatMap(({ client_id }) =>
      client_id ? [client_id] : []
    ),
  );
  if (!clients.ok) return clients.result;

  return {
    results: visible.map((payment) => {
      const sale = sales.value.get(payment.sale_id);
      return {
        id: payment.id,
        sale_id: payment.sale_id,
        sale_code: sale?.code ?? null,
        client_name: sale?.client_id
          ? clients.value.get(sale.client_id) ?? null
          : null,
        amount: payment.amount,
        payment_date: payment.payment_date,
        payment_method: payment.payment_method,
        status: payment.status,
        invoice_reference: payment.invoice_reference,
        route: "/financeiro/pagamentos",
      };
    }),
    count: visible.length,
    filters: { status: input.data.status ?? null, start_date: input.data.start_date ?? null, end_date: input.data.end_date ?? null },
    results_may_be_incomplete: payments.data.length >= maxResults * 4 || visible.length >= maxResults,
  };
}

async function getFinancePaymentDetails(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = financePaymentIdArgsSchema.safeParse(args);
  if (!input.success) return financeInvalidArguments();
  const { data, error } = await ctx.supabaseAdmin
    .from("sale_payments")
    .select(
      "id,sale_id,amount,payment_date,payment_method,status,invoice_reference,notes,bank_account_id,created_at,updated_at",
    )
    .eq("organization_id", ctx.orgId)
    .eq("id", input.data.payment_id)
    .maybeSingle();
  if (error) {
    return financeError(
      "Não foi possível consultar o pagamento.",
      "payment_lookup_failed",
    );
  }
  const payment = financePaymentSchema.safeParse(data);
  if (!payment.success) {
    return financeError("Pagamento não encontrado.", "payment_not_found");
  }

  const sale = await financeVisibleSale(ctx, payment.data.sale_id);
  if (!sale.ok) return sale.result;
  const clients = await financeClientNames(
    ctx,
    sale.value.client_id ? [sale.value.client_id] : [],
  );
  if (!clients.ok) return clients.result;

  let bankAccountName: string | null = null;
  if (payment.data.bank_account_id) {
    const bank = await ctx.supabaseAdmin
      .from("bank_accounts")
      .select("id,name")
      .eq("organization_id", ctx.orgId)
      .eq("id", payment.data.bank_account_id)
      .maybeSingle();
    if (bank.error) {
      return financeError(
        "Não foi possível consultar a conta associada.",
        "bank_account_lookup_failed",
      );
    }
    const parsedBank = financeNamedResourceSchema.safeParse(bank.data);
    bankAccountName = parsedBank.success ? parsedBank.data.name : null;
  }

  return {
    payment: {
      id: payment.data.id,
      sale_id: payment.data.sale_id,
      sale_code: sale.value.code,
      client_name: sale.value.client_id
        ? clients.value.get(sale.value.client_id) ?? null
        : null,
      amount: payment.data.amount,
      payment_date: payment.data.payment_date,
      payment_method: payment.data.payment_method,
      status: payment.data.status,
      invoice_reference: payment.data.invoice_reference,
      notes: payment.data.notes,
      bank_account_name: bankAccountName,
      created_at: payment.data.created_at,
      updated_at: payment.data.updated_at,
    },
    resource: {
      type: "sale_payment",
      id: payment.data.id,
      route: "/financeiro/pagamentos",
    },
  };
}

export const financePaymentReadTools = [
  {
    name: "search_finance_payments",
    module: "finance",
    description:
      "Listar pagamentos reais da organização por venda, estado ou período, respeitando o âmbito de dados do utilizador.",
    parameters: {
      type: "object",
      properties: {
        sale_id: {
          type: "string",
          format: "uuid",
          description: "Venda específica (opcional)",
        },
        status: {
          type: "string",
          enum: ["pending", "paid"],
          description: "Estado do pagamento (opcional)",
        },
        start_date: {
          type: "string",
          format: "date",
          description: "Data inicial YYYY-MM-DD (opcional)",
        },
        end_date: {
          type: "string",
          format: "date",
          description: "Data final YYYY-MM-DD (opcional)",
        },
        max_results: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: "Máximo de resultados",
        },
      },
      additionalProperties: false,
    },
    permission: { module: "finance", subarea: "payments", action: "view" },
    execute: searchFinancePayments,
  },
  {
    name: "get_finance_payment_details",
    module: "finance",
    description:
      "Consultar um pagamento específico e a venda, cliente e conta associados sem expor identificadores Stripe ou dados bancários sensíveis.",
    parameters: {
      type: "object",
      properties: {
        payment_id: {
          type: "string",
          format: "uuid",
          description: "ID interno do pagamento",
        },
      },
      required: ["payment_id"],
      additionalProperties: false,
    },
    permission: { module: "finance", subarea: "payments", action: "view" },
    execute: getFinancePaymentDetails,
  },
] satisfies readonly Tool[];
