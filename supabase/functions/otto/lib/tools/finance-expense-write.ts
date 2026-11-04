import type { Tool, ToolContext, ToolResult } from "../types.ts";
import {
  financeCreateExpenseArgsSchema,
  financeDeleteExpenseArgsSchema,
  financeExpenseSchema,
  financeUpdateExpenseArgsSchema,
} from "./finance-contracts.ts";
import {
  createExpensePreview,
  deleteExpensePreview,
  expenseColumns,
  loadExpense,
  updateExpensePreview,
  validExpenseReference,
} from "./finance-expense-write-shared.ts";
import { financeError, financeInvalidArguments } from "./finance-shared.ts";

async function createExpense(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = financeCreateExpenseArgsSchema.safeParse(args);
  if (!input.success) return financeInvalidArguments();
  const [validCategory, validBank] = await Promise.all([
    validExpenseReference(ctx, "expense_categories", input.data.category_id),
    validExpenseReference(ctx, "bank_accounts", input.data.bank_account_id),
  ]);
  if (!validCategory || !validBank) {
    return financeError(
      "Categoria ou conta bancária inválida para esta organização.",
      "invalid_expense_reference",
    );
  }

  const { data, error } = await ctx.supabaseAdmin.from("expenses").insert({
    organization_id: ctx.orgId,
    description: input.data.description,
    amount: input.data.amount,
    expense_date: input.data.expense_date,
    category_id: input.data.category_id ?? null,
    bank_account_id: input.data.bank_account_id ?? null,
    notes: input.data.notes ?? null,
    is_recurring: false,
    created_by: ctx.userId,
  }).select(expenseColumns).single();
  if (error) {
    return financeError(
      "Não foi possível registar a despesa.",
      "expense_create_failed",
    );
  }
  const created = financeExpenseSchema.safeParse(data);
  if (!created.success) {
    return financeError(
      "A despesa foi gravada, mas o resultado não pôde ser confirmado.",
      "expense_create_unverified",
    );
  }
  return {
    operation: "created",
    resource: {
      type: "expense",
      id: created.data.id,
      route: "/financeiro/despesas",
    },
  };
}

async function updateExpense(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = financeUpdateExpenseArgsSchema.safeParse(args);
  if (!input.success) return financeInvalidArguments();
  const loaded = await loadExpense(ctx, input.data.expense_id);
  if (!loaded.ok) return loaded.result;
  const [validCategory, validBank] = await Promise.all([
    validExpenseReference(ctx, "expense_categories", input.data.category_id),
    validExpenseReference(ctx, "bank_accounts", input.data.bank_account_id),
  ]);
  if (!validCategory || !validBank) {
    return financeError(
      "Categoria ou conta bancária inválida para esta organização.",
      "invalid_expense_reference",
    );
  }

  const changes = {
    ...(input.data.description !== undefined
      ? { description: input.data.description }
      : {}),
    ...(input.data.amount !== undefined ? { amount: input.data.amount } : {}),
    ...(input.data.expense_date !== undefined
      ? { expense_date: input.data.expense_date }
      : {}),
    ...(input.data.category_id !== undefined
      ? { category_id: input.data.category_id }
      : {}),
    ...(input.data.bank_account_id !== undefined
      ? { bank_account_id: input.data.bank_account_id }
      : {}),
    ...(input.data.notes !== undefined ? { notes: input.data.notes } : {}),
  };
  const { data, error } = await ctx.supabaseAdmin.from("expenses").update(
    changes,
  )
    .eq("organization_id", ctx.orgId).eq("id", loaded.expense.id).select(
      expenseColumns,
    ).maybeSingle();
  if (error) {
    return financeError(
      "Não foi possível atualizar a despesa.",
      "expense_update_failed",
    );
  }
  const updated = financeExpenseSchema.safeParse(data);
  if (!updated.success) {
    return financeError(
      "A atualização da despesa não pôde ser confirmada.",
      "expense_update_unverified",
    );
  }
  return {
    operation: "updated",
    resource: {
      type: "expense",
      id: updated.data.id,
      route: "/financeiro/despesas",
    },
  };
}

async function deleteExpense(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = financeDeleteExpenseArgsSchema.safeParse(args);
  if (!input.success) return financeInvalidArguments();
  const loaded = await loadExpense(ctx, input.data.expense_id);
  if (!loaded.ok) return loaded.result;
  const { data, error } = await ctx.supabaseAdmin.from("expenses").delete()
    .eq("organization_id", ctx.orgId).eq("id", loaded.expense.id).select("id")
    .maybeSingle();
  if (error || data?.id !== loaded.expense.id) {
    return financeError(
      "Não foi possível eliminar a despesa.",
      "expense_delete_failed",
    );
  }
  return {
    operation: "deleted",
    resource: {
      type: "expense",
      id: loaded.expense.id,
      route: "/financeiro/despesas",
    },
  };
}

const expenseProperties = {
  description: { type: "string", minLength: 1, maxLength: 300 },
  amount: { type: "number", exclusiveMinimum: 0 },
  expense_date: { type: "string", format: "date" },
  category_id: { type: ["string", "null"], format: "uuid" },
  bank_account_id: { type: ["string", "null"], format: "uuid" },
  notes: { type: ["string", "null"], maxLength: 2000 },
};

export const financeExpenseWriteTools = [
  {
    name: "create_expense",
    module: "finance",
    isWrite: true,
    description:
      "Registar uma despesa não recorrente visível no Financeiro. Exige confirmação.",
    parameters: {
      type: "object",
      properties: expenseProperties,
      required: ["description", "amount", "expense_date"],
      additionalProperties: false,
    },
    permission: { module: "finance", subarea: "expenses", action: "add" },
    confirmation: {
      kind: "confirmation_required",
      preview: createExpensePreview,
    },
    execute: createExpense,
  },
  {
    name: "update_expense",
    module: "finance",
    isWrite: true,
    description:
      "Atualizar campos base de uma despesa sem alterar a recorrência. Exige confirmação.",
    parameters: {
      type: "object",
      properties: {
        expense_id: { type: "string", format: "uuid" },
        ...expenseProperties,
      },
      required: ["expense_id"],
      additionalProperties: false,
    },
    permission: { module: "finance", subarea: "expenses", action: "edit" },
    confirmation: {
      kind: "confirmation_required",
      preview: updateExpensePreview,
    },
    execute: updateExpense,
  },
  {
    name: "delete_expense",
    module: "finance",
    isWrite: true,
    description:
      "Eliminar definitivamente uma despesa existente. Exige confirmação.",
    parameters: {
      type: "object",
      properties: { expense_id: { type: "string", format: "uuid" } },
      required: ["expense_id"],
      additionalProperties: false,
    },
    permission: { module: "finance", subarea: "expenses", action: "delete" },
    confirmation: {
      kind: "confirmation_required",
      preview: deleteExpensePreview,
    },
    execute: deleteExpense,
  },
] satisfies readonly Tool[];
