import { z } from "https://esm.sh/zod@3.25.76";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const financeInvoiceIdArgsSchema = z.object({ invoice_id: uuid })
  .strict();
export const financeCreditNoteIdArgsSchema = z.object({ credit_note_id: uuid })
  .strict();
export const financePaymentIdArgsSchema = z.object({ payment_id: uuid })
  .strict();
export const financeExpenseIdArgsSchema = z.object({ expense_id: uuid })
  .strict();

export const financeSearchPaymentsArgsSchema = z.object({
  sale_id: uuid.optional(),
  status: z.enum(["pending", "paid"]).optional(),
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  max_results: z.number().int().min(1).max(20).optional(),
}).strict();

export const financeSearchExpensesArgsSchema = z.object({
  query: z.string().trim().max(120).optional(),
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  is_recurring: z.boolean().optional(),
  max_results: z.number().int().min(1).max(20).optional(),
}).strict();

const expenseFields = {
  description: z.string().trim().min(1).max(300),
  amount: z.number().positive().max(1_000_000_000),
  expense_date: isoDate,
  category_id: uuid.nullable().optional(),
  bank_account_id: uuid.nullable().optional(),
  notes: z.string().trim().max(2_000).nullable().optional(),
} as const;

export const financeCreateExpenseArgsSchema = z.object(expenseFields).strict();

export const financeUpdateExpenseArgsSchema = z.object({
  expense_id: uuid,
  description: expenseFields.description.optional(),
  amount: expenseFields.amount.optional(),
  expense_date: expenseFields.expense_date.optional(),
  category_id: expenseFields.category_id,
  bank_account_id: expenseFields.bank_account_id,
  notes: expenseFields.notes,
}).strict().refine(
  ({ expense_id: _expenseId, ...changes }) =>
    Object.values(changes).some((value) => value !== undefined),
  { message: "At least one expense field is required" },
);

export const financeDeleteExpenseArgsSchema = z.object({ expense_id: uuid })
  .strict();

export const financeIssueInvoiceArgsSchema = z.object({
  sale_id: uuid,
  observations: z.string().trim().min(1).max(2_000).optional(),
}).strict();

export const financeCancelInvoiceArgsSchema = z.object({
  invoice_id: uuid,
  reason: z.string().trim().min(3).max(500),
}).strict();

export const financeSendInvoiceArgsSchema = z.object({
  invoice_id: uuid,
  email: z.string().trim().email().max(254),
}).strict();

const snapshotDigest = z.string().regex(/^[0-9a-f]{64}$/);
const expectedUpdatedAt = z.string().min(1);

export const financePreparedIssueInvoiceArgsSchema = financeIssueInvoiceArgsSchema.extend({
  expected_sale_updated_at: expectedUpdatedAt,
  expected_sale_amount: z.number().finite().nonnegative(),
}).strict();

export const financePreparedCancelInvoiceArgsSchema = financeCancelInvoiceArgsSchema.extend({
  expected_invoice_updated_at: expectedUpdatedAt,
  invoice_snapshot_digest: snapshotDigest,
}).strict();

export const financePreparedSendInvoiceArgsSchema = financeSendInvoiceArgsSchema.extend({
  expected_invoice_updated_at: expectedUpdatedAt,
  invoice_snapshot_digest: snapshotDigest,
}).strict();

export const financeSaleSchema = z.object({
  id: uuid,
  code: z.string().nullable(),
  status: z.string(),
  total_value: z.coerce.number(),
  gross_value: z.coerce.number().nullable(),
  seller_id: uuid.nullable(),
  created_by: uuid.nullable(),
  client_id: uuid.nullable(),
  invoicexpress_id: z.coerce.number().int().positive().nullable(),
  invoice_reference: z.string().nullable(),
  updated_at: z.string().nullable(),
});

export const financeClientSchema = z.object({ id: uuid, name: z.string() });

export const financeInvoiceSchema = z.object({
  id: uuid,
  provider: z.string().nullable().optional(),
  invoicexpress_id: z.coerce.number().int().positive().nullable(),
  reference: z.string().nullable(),
  document_type: z.string().nullable(),
  status: z.string().nullable(),
  client_name: z.string().nullable(),
  total: z.coerce.number().nullable(),
  date: z.string().nullable(),
  due_date: z.string().nullable(),
  sale_id: uuid.nullable(),
  payment_id: uuid.nullable(),
  pdf_path: z.string().nullable(),
  email_status: z.string().nullable().optional(),
  email_sent_at: z.string().nullable().optional(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

export const financeCreditNoteSchema = z.object({
  id: uuid,
  invoicexpress_id: z.coerce.number().int().positive(),
  reference: z.string().nullable(),
  status: z.string().nullable(),
  client_name: z.string().nullable(),
  total: z.coerce.number().nullable(),
  date: z.string().nullable(),
  sale_id: uuid.nullable(),
  payment_id: uuid.nullable(),
  related_invoice_id: z.coerce.number().int().positive().nullable(),
  pdf_path: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

export const financePaymentSchema = z.object({
  id: uuid,
  sale_id: uuid,
  amount: z.coerce.number(),
  payment_date: isoDate,
  payment_method: z.string().nullable(),
  status: z.string(),
  invoice_reference: z.string().nullable(),
  notes: z.string().nullable(),
  bank_account_id: uuid.nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

export const financeExpenseSchema = z.object({
  id: uuid,
  category_id: uuid.nullable(),
  description: z.string(),
  amount: z.coerce.number(),
  expense_date: isoDate,
  is_recurring: z.boolean().nullable(),
  recurrence_frequency: z.string().nullable(),
  recurrence_day: z.coerce.number().int().nullable(),
  recurrence_month: z.coerce.number().int().nullable(),
  next_recurrence_date: isoDate.nullable(),
  notes: z.string().nullable(),
  receipt_file_url: z.string().nullable(),
  bank_account_id: uuid.nullable(),
  created_by: uuid.nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

export const financeNamedResourceSchema = z.object({
  id: uuid,
  name: z.string(),
});

export const financeFunctionFailureSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  manual_review: z.boolean().optional(),
  retryable: z.boolean().optional(),
}).passthrough();

export const financeIssueResultSchema = z.object({
  success: z.literal(true),
  already_issued: z.boolean().optional(),
  invoicexpress_id: z.coerce.number().int().positive(),
  invoice_reference: z.string().min(1),
  invoice_id: uuid.optional(),
}).passthrough();

export const financeCancelResultSchema = z.object({
  success: z.literal(true),
  operation: z.string(),
}).passthrough();

export const financeSendResultSchema = z.object({
  success: z.literal(true),
  provider: z.string(),
}).passthrough();

export type FinanceSale = Readonly<z.infer<typeof financeSaleSchema>>;
export type FinanceInvoice = Readonly<z.infer<typeof financeInvoiceSchema>>;
export type FinancePayment = Readonly<z.infer<typeof financePaymentSchema>>;
export type FinanceExpense = Readonly<z.infer<typeof financeExpenseSchema>>;
