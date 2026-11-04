import type { ToolContext, ToolResult } from "../types.ts";
import { filterAccessibleRecords } from "../record-scope.ts";
import {
  type FinanceExpense,
  financeExpenseIdArgsSchema,
  financeExpenseSchema,
  financeNamedResourceSchema,
  financeSearchExpensesArgsSchema,
} from "./finance-contracts.ts";
import {
  financeError,
  financeInvalidArguments,
  financeNormalize,
} from "./finance-shared.ts";

async function expenseNames(
  ctx: ToolContext,
  table: "expense_categories" | "bank_accounts",
  ids: readonly string[],
): Promise<ReadonlyMap<string, string> | ToolResult> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return new Map();
  const { data, error } = await ctx.supabaseAdmin
    .from(table)
    .select("id,name")
    .eq("organization_id", ctx.orgId)
    .in("id", uniqueIds);
  if (error) {
    return financeError(
      "Não foi possível consultar os dados associados à despesa.",
      "expense_reference_lookup_failed",
    );
  }
  const parsed = financeNamedResourceSchema.array().safeParse(data ?? []);
  return parsed.success
    ? new Map(parsed.data.map((item) => [item.id, item.name]))
    : financeError(
      "A resposta associada à despesa não pôde ser validada.",
      "invalid_expense_reference_response",
    );
}

function expenseResult(
  expense: FinanceExpense,
  categoryName: string | null,
  bankName: string | null,
) {
  return {
    id: expense.id,
    description: expense.description,
    amount: expense.amount,
    expense_date: expense.expense_date,
    category_name: categoryName,
    bank_account_name: bankName,
    is_recurring: expense.is_recurring ?? false,
    recurrence_frequency: expense.recurrence_frequency,
    recurrence_day: expense.recurrence_day,
    recurrence_month: expense.recurrence_month,
    next_recurrence_date: expense.next_recurrence_date,
    notes: expense.notes,
    has_receipt: Boolean(expense.receipt_file_url),
    created_by: expense.created_by,
    created_at: expense.created_at,
    updated_at: expense.updated_at,
  };
}

export async function searchExpenses(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = financeSearchExpensesArgsSchema.safeParse(args);
  if (
    !input.success ||
    (input.data.start_date && input.data.end_date &&
      input.data.start_date > input.data.end_date)
  ) {
    return financeInvalidArguments();
  }
  const maxResults = input.data.max_results ?? 20;
  let query = ctx.supabaseAdmin
    .from("expenses")
    .select(
      "id,category_id,description,amount,expense_date,is_recurring,recurrence_frequency,recurrence_day,recurrence_month,next_recurrence_date,notes,receipt_file_url,bank_account_id,created_by,created_at,updated_at",
    )
    .eq("organization_id", ctx.orgId)
    .order("expense_date", { ascending: false })
    .limit(maxResults * 4);
  if (input.data.start_date) {
    query = query.gte("expense_date", input.data.start_date);
  }
  if (input.data.end_date) {
    query = query.lte("expense_date", input.data.end_date);
  }
  if (input.data.is_recurring !== undefined) {
    query = query.eq("is_recurring", input.data.is_recurring);
  }

  const { data, error } = await query;
  if (error) {
    return financeError(
      "Não foi possível consultar as despesas.",
      "expense_search_failed",
    );
  }
  const parsed = financeExpenseSchema.array().safeParse(data ?? []);
  if (!parsed.success) {
    return financeError(
      "A resposta de despesas não pôde ser validada.",
      "invalid_expense_response",
    );
  }
  const normalizedQuery = input.data.query
    ? financeNormalize(input.data.query)
    : "";
  const visible = filterAccessibleRecords(ctx, parsed.data)
    .filter((expense) =>
      !normalizedQuery ||
      financeNormalize(`${expense.description} ${expense.notes ?? ""}`)
        .includes(normalizedQuery)
    )
    .slice(0, maxResults);

  const categories = await expenseNames(
    ctx,
    "expense_categories",
    visible.flatMap(({ category_id }) => category_id ? [category_id] : []),
  );
  if (!(categories instanceof Map)) return categories;
  return {
    results: visible.map((expense) => ({
      ...expenseResult(
        expense,
        expense.category_id
          ? categories.get(expense.category_id) ?? null
          : null,
        null,
      ),
      route: "/financeiro/despesas",
    })),
    count: visible.length,
  };
}

export async function getExpenseDetails(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = financeExpenseIdArgsSchema.safeParse(args);
  if (!input.success) return financeInvalidArguments();
  const { data, error } = await ctx.supabaseAdmin
    .from("expenses")
    .select(
      "id,category_id,description,amount,expense_date,is_recurring,recurrence_frequency,recurrence_day,recurrence_month,next_recurrence_date,notes,receipt_file_url,bank_account_id,created_by,created_at,updated_at",
    )
    .eq("organization_id", ctx.orgId)
    .eq("id", input.data.expense_id)
    .maybeSingle();
  if (error) {
    return financeError(
      "Não foi possível consultar a despesa.",
      "expense_lookup_failed",
    );
  }
  const parsed = financeExpenseSchema.safeParse(data);
  if (
    !parsed.success || filterAccessibleRecords(ctx, [parsed.data]).length === 0
  ) {
    return financeError(
      "Despesa não encontrada ou sem acesso.",
      "expense_not_found",
    );
  }

  const categories = await expenseNames(
    ctx,
    "expense_categories",
    parsed.data.category_id ? [parsed.data.category_id] : [],
  );
  if (!(categories instanceof Map)) return categories;
  const banks = await expenseNames(
    ctx,
    "bank_accounts",
    parsed.data.bank_account_id ? [parsed.data.bank_account_id] : [],
  );
  if (!(banks instanceof Map)) return banks;
  return {
    expense: expenseResult(
      parsed.data,
      parsed.data.category_id
        ? categories.get(parsed.data.category_id) ?? null
        : null,
      parsed.data.bank_account_id
        ? banks.get(parsed.data.bank_account_id) ?? null
        : null,
    ),
    resource: {
      type: "expense",
      id: parsed.data.id,
      route: "/financeiro/despesas",
    },
  };
}
