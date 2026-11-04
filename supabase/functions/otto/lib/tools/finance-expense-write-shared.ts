import type { ConfirmationPreview, ToolContext, ToolResult } from "../types.ts";
import { filterAccessibleRecords } from "../record-scope.ts";
import {
  financeCreateExpenseArgsSchema,
  financeDeleteExpenseArgsSchema,
  type FinanceExpense,
  financeExpenseSchema,
  financeUpdateExpenseArgsSchema,
} from "./finance-contracts.ts";
import { financeError } from "./finance-shared.ts";

type ExpenseResult =
  | { readonly ok: true; readonly expense: FinanceExpense }
  | { readonly ok: false; readonly result: ToolResult };

export const expenseColumns =
  "id,category_id,description,amount,expense_date,is_recurring,recurrence_frequency,recurrence_day,recurrence_month,next_recurrence_date,notes,receipt_file_url,bank_account_id,created_by,created_at,updated_at";

export async function loadExpense(
  ctx: ToolContext,
  expenseId: string,
): Promise<ExpenseResult> {
  const { data, error } = await ctx.supabaseAdmin.from("expenses").select(
    expenseColumns,
  )
    .eq("organization_id", ctx.orgId).eq("id", expenseId).maybeSingle();
  if (error) {
    return {
      ok: false,
      result: financeError(
        "Não foi possível consultar a despesa.",
        "expense_lookup_failed",
      ),
    };
  }
  const parsed = financeExpenseSchema.safeParse(data);
  return parsed.success &&
      filterAccessibleRecords(ctx, [parsed.data]).length > 0
    ? { ok: true, expense: parsed.data }
    : {
      ok: false,
      result: financeError(
        "Despesa não encontrada ou sem acesso.",
        "expense_not_found",
      ),
    };
}

export async function validExpenseReference(
  ctx: ToolContext,
  table: "expense_categories" | "bank_accounts",
  id: string | null | undefined,
): Promise<boolean> {
  if (!id) return true;
  const { data, error } = await ctx.supabaseAdmin.from(table).select("id")
    .eq("organization_id", ctx.orgId).eq("id", id).eq("is_active", true)
    .maybeSingle();
  return !error && data?.id === id;
}

export async function createExpensePreview(
  args: Readonly<Record<string, unknown>>,
): Promise<ConfirmationPreview | null> {
  const input = financeCreateExpenseArgsSchema.safeParse(args);
  return input.success
    ? {
      title: "Registar despesa",
      summary: `Registar a despesa “${input.data.description}” de ${
        input.data.amount.toFixed(2)
      } EUR em ${input.data.expense_date}.`,
      destination: "/financeiro/despesas",
    }
    : null;
}

export async function updateExpensePreview(
  args: Readonly<Record<string, unknown>>,
  ctx: ToolContext,
): Promise<ConfirmationPreview | null> {
  const input = financeUpdateExpenseArgsSchema.safeParse(args);
  if (!input.success) return null;
  const loaded = await loadExpense(ctx, input.data.expense_id);
  if (!loaded.ok) return null;
  const description = input.data.description ?? loaded.expense.description;
  const amount = input.data.amount ?? loaded.expense.amount;
  return {
    title: "Atualizar despesa",
    summary: `Atualizar a despesa “${description}” para ${
      amount.toFixed(2)
    } EUR. A recorrência existente não será alterada.`,
    destination: "/financeiro/despesas",
  };
}

export async function deleteExpensePreview(
  args: Readonly<Record<string, unknown>>,
  ctx: ToolContext,
): Promise<ConfirmationPreview | null> {
  const input = financeDeleteExpenseArgsSchema.safeParse(args);
  if (!input.success) return null;
  const loaded = await loadExpense(ctx, input.data.expense_id);
  return loaded.ok
    ? {
      title: "Eliminar despesa",
      summary:
        `Eliminar definitivamente a despesa “${loaded.expense.description}” de ${
          loaded.expense.amount.toFixed(2)
        } EUR.`,
      destination: "/financeiro/despesas",
    }
    : null;
}
