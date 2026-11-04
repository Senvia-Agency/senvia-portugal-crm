import type { ToolContext, ToolResult } from "../types.ts";
import { canAccessRecord } from "../record-scope.ts";
import {
  financeClientSchema,
  financeFunctionFailureSchema,
  type FinanceSale,
  financeSaleSchema,
} from "./finance-contracts.ts";

type FinanceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly result: ToolResult };

export function financeError(
  error: string,
  reasonCode: string,
  instruction =
    "A operação NÃO foi concluída. Informa o utilizador sem inventar dados.",
): ToolResult {
  return { error, reason_code: reasonCode, _instruction: instruction };
}

export function financeInvalidArguments(): ToolResult {
  return financeError(
    "Argumentos financeiros inválidos",
    "invalid_finance_arguments",
    "Os dados recebidos não cumprem o contrato da ferramenta. A operação NÃO foi executada. Pede apenas os campos em falta.",
  );
}

export function financeNormalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .trim();
}

export async function financeVisibleSales(
  ctx: ToolContext,
  saleIds: readonly string[],
): Promise<FinanceResult<ReadonlyMap<string, FinanceSale>>> {
  const uniqueIds = [...new Set(saleIds)];
  if (uniqueIds.length === 0) return { ok: true, value: new Map() };

  const { data, error } = await ctx.supabaseAdmin
    .from("sales")
    .select(
      "id,code,status,total_value,gross_value,seller_id,created_by,client_id,invoicexpress_id,invoice_reference,updated_at",
    )
    .eq("organization_id", ctx.orgId)
    .in("id", uniqueIds);
  if (error) {
    return {
      ok: false,
      result: financeError(
        "Não foi possível consultar as vendas associadas.",
        "sale_scope_unavailable",
      ),
    };
  }

  const parsed = financeSaleSchema.array().safeParse(data ?? []);
  if (!parsed.success) {
    return {
      ok: false,
      result: financeError(
        "A resposta financeira não pôde ser validada.",
        "invalid_sale_scope_response",
      ),
    };
  }
  const visible = parsed.data.filter((sale) => canAccessRecord(ctx, sale));
  return { ok: true, value: new Map(visible.map((sale) => [sale.id, sale])) };
}

export async function financeVisibleSale(
  ctx: ToolContext,
  saleId: string,
): Promise<FinanceResult<FinanceSale>> {
  const sales = await financeVisibleSales(ctx, [saleId]);
  if (!sales.ok) return sales;
  const sale = sales.value.get(saleId);
  return sale ? { ok: true, value: sale } : {
    ok: false,
    result: financeError(
      "Venda não encontrada ou sem acesso.",
      "sale_not_found",
    ),
  };
}

export async function financeClientNames(
  ctx: ToolContext,
  clientIds: readonly string[],
): Promise<FinanceResult<ReadonlyMap<string, string>>> {
  const uniqueIds = [...new Set(clientIds)];
  if (uniqueIds.length === 0) return { ok: true, value: new Map() };
  const { data, error } = await ctx.supabaseAdmin
    .from("crm_clients")
    .select("id,name")
    .eq("organization_id", ctx.orgId)
    .in("id", uniqueIds);
  if (error) {
    return {
      ok: false,
      result: financeError(
        "Não foi possível consultar os clientes associados.",
        "client_lookup_unavailable",
      ),
    };
  }
  const parsed = financeClientSchema.array().safeParse(data ?? []);
  if (!parsed.success) {
    return {
      ok: false,
      result: financeError(
        "A resposta de clientes não pôde ser validada.",
        "invalid_client_response",
      ),
    };
  }
  return {
    ok: true,
    value: new Map(parsed.data.map((client) => [client.id, client.name])),
  };
}

export async function financeLinkedSaleId(
  ctx: ToolContext,
  saleId: string | null,
  paymentId: string | null,
): Promise<FinanceResult<string | null>> {
  if (saleId) return { ok: true, value: saleId };
  if (!paymentId) return { ok: true, value: null };
  const { data, error } = await ctx.supabaseAdmin
    .from("sale_payments")
    .select("sale_id")
    .eq("organization_id", ctx.orgId)
    .eq("id", paymentId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      result: financeError(
        "Não foi possível validar o pagamento associado.",
        "payment_scope_unavailable",
      ),
    };
  }
  const linked = typeof data?.sale_id === "string" ? data.sale_id : null;
  return { ok: true, value: linked };
}

export async function financeCanReadLinkedRecord(
  ctx: ToolContext,
  saleId: string | null,
  paymentId: string | null,
): Promise<FinanceResult<FinanceSale | null>> {
  const linked = await financeLinkedSaleId(ctx, saleId, paymentId);
  if (!linked.ok) return linked;
  if (!linked.value) {
    return ctx.dataScope === "all" ? { ok: true, value: null } : {
      ok: false,
      result: financeError(
        "Registo financeiro não encontrado ou sem acesso.",
        "financial_record_not_found",
      ),
    };
  }
  return await financeVisibleSale(ctx, linked.value);
}

function financeFailureFromPayload(
  value: unknown,
  fallback: string,
): ToolResult | null {
  const parsed = financeFunctionFailureSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    error: parsed.data.error,
    reason_code: parsed.data.code ?? fallback,
    manual_review: parsed.data.manual_review ?? false,
    retryable: parsed.data.retryable ?? false,
    _instruction: parsed.data.manual_review
      ? "A operação pode ter tido efeito no fornecedor. NÃO repitas automaticamente; pede verificação manual."
      : "A operação NÃO foi confirmada pelo fornecedor. Informa o utilizador sem inventar sucesso.",
  };
}

export function financeFunctionResultFailure(
  value: unknown,
  fallback: string,
): ToolResult {
  return financeFailureFromPayload(value, fallback) ??
    financeError(
      "O fornecedor não devolveu um resultado verificável.",
      fallback,
    );
}

export async function financeFunctionInvokeFailure(
  error: unknown,
  fallback: string,
): Promise<ToolResult> {
  const context = typeof error === "object" && error !== null
    ? Reflect.get(error, "context")
    : null;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json();
      const parsed = financeFailureFromPayload(payload, fallback);
      if (parsed) return parsed;
    } catch (parseError) {
      if (
        !(parseError instanceof SyntaxError) &&
        !(parseError instanceof TypeError)
      ) throw parseError;
    }
  }
  return financeError(
    "Não foi possível contactar o serviço financeiro.",
    fallback,
  );
}
