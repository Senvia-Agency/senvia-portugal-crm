import { z } from "https://esm.sh/zod@3.25.76";

import { DATE_SCHEMA, UUID_SCHEMA } from "./sales-shared.ts";

const PAYMENT_METHODS = [
  "mbway", "transfer", "cash", "card", "credit_card", "debit_card", "check", "other",
] as const;
const PAYMENT_STATUS = ["pending", "paid"] as const;

export const SALE_PAYMENT_COLUMNS = [
  "id", "organization_id", "sale_id", "amount", "payment_date", "payment_method",
  "invoice_reference", "invoice_file_url", "status", "notes", "bank_account_id",
  "recurring_cycle_id", "billing_period_start", "billing_period_end", "invoicexpress_id",
  "credit_note_id", "stripe_invoice_id", "stripe_gross_amount", "stripe_fee_amount",
  "stripe_net_amount", "reversal_status", "reversed_amount", "original_payment_id",
  "stripe_payment_intent_id", "stripe_charge_id", "created_at", "updated_at",
].join(", ");

export const SALE_PAYMENT_SALE_COLUMNS =
  "id, code, gross_value, total_value, seller_id, created_by, lead_id";

export const salePaymentRowSchema = z.object({
  id: UUID_SCHEMA,
  organization_id: UUID_SCHEMA,
  sale_id: UUID_SCHEMA,
  amount: z.coerce.number().finite().positive(),
  payment_date: DATE_SCHEMA,
  payment_method: z.string().nullable(),
  invoice_reference: z.string().nullable(),
  invoice_file_url: z.string().nullable(),
  status: z.enum(PAYMENT_STATUS),
  notes: z.string().nullable(),
  bank_account_id: UUID_SCHEMA.nullable(),
  recurring_cycle_id: UUID_SCHEMA.nullable(),
  billing_period_start: DATE_SCHEMA.nullable(),
  billing_period_end: DATE_SCHEMA.nullable(),
  invoicexpress_id: z.coerce.number().int().positive().nullable(),
  credit_note_id: z.coerce.number().int().positive().nullable(),
  stripe_invoice_id: z.string().nullable(),
  stripe_gross_amount: z.coerce.number().finite().nullable(),
  stripe_fee_amount: z.coerce.number().finite().nullable(),
  stripe_net_amount: z.coerce.number().finite().nullable(),
  reversal_status: z.string().nullable().optional(),
  reversed_amount: z.coerce.number().finite().nullable().optional(),
  original_payment_id: UUID_SCHEMA.nullable().optional(),
  stripe_payment_intent_id: z.string().nullable().optional(),
  stripe_charge_id: z.string().nullable().optional(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
}).strict();

export const salePaymentListSchema = z.object({ sale_id: UUID_SCHEMA }).strict();
export const salePaymentIdSchema = z.object({ payment_id: UUID_SCHEMA }).strict();

const manualPaymentFields = {
  amount: z.number().finite().positive().max(1_000_000_000),
  payment_date: DATE_SCHEMA,
  payment_method: z.enum(PAYMENT_METHODS).nullable(),
  status: z.enum(PAYMENT_STATUS),
  notes: z.string().trim().max(10_000).nullable(),
  invoice_reference: z.string().trim().max(160).nullable(),
  bank_account_id: UUID_SCHEMA.nullable(),
} as const;

export const createSalePaymentSchema = z.object({
  sale_id: UUID_SCHEMA,
  amount: manualPaymentFields.amount,
  payment_date: manualPaymentFields.payment_date,
  payment_method: manualPaymentFields.payment_method.optional(),
  status: manualPaymentFields.status,
  notes: manualPaymentFields.notes.optional(),
  invoice_reference: manualPaymentFields.invoice_reference.optional(),
  bank_account_id: manualPaymentFields.bank_account_id.optional(),
}).strict();

export const updateSalePaymentSchema = z.object({
  payment_id: UUID_SCHEMA,
  amount: manualPaymentFields.amount.optional(),
  payment_date: manualPaymentFields.payment_date.optional(),
  payment_method: manualPaymentFields.payment_method.optional(),
  status: manualPaymentFields.status.optional(),
  notes: manualPaymentFields.notes.optional(),
  invoice_reference: manualPaymentFields.invoice_reference.optional(),
  bank_account_id: manualPaymentFields.bank_account_id.optional(),
}).strict();

export type SalePaymentRow = Readonly<z.infer<typeof salePaymentRowSchema>>;
export type PaymentBalanceRow = Readonly<Pick<SalePaymentRow, "amount" | "status">>;
export type ScopedSale = Readonly<{
  readonly id: string;
  readonly seller_id: string | null;
  readonly created_by: string | null;
  readonly lead_id: string | null;
  readonly [key: string]: unknown;
}>;

export type SalePaymentView = Readonly<{
  readonly id: string;
  readonly sale_id: string;
  readonly amount: number;
  readonly payment_date: string;
  readonly payment_method: string | null;
  readonly invoice_reference: string | null;
  readonly invoice_file_url: string | null;
  readonly status: "pending" | "paid";
  readonly notes: string | null;
  readonly bank_account_id: string | null;
  readonly billing_period_start: string | null;
  readonly billing_period_end: string | null;
  readonly created_at: string | null;
  readonly updated_at: string | null;
  readonly is_recurring: boolean;
  readonly source: "manual" | "recurring" | "stripe" | "fiscal";
  readonly editable: boolean;
  readonly edit_block_reason: string | null;
}>;

export type PaymentSummary = Readonly<{
  readonly total_due: number;
  readonly total_paid: number;
  readonly total_scheduled: number;
  readonly remaining: number;
  readonly remaining_to_schedule: number;
  readonly payment_status: "pending" | "partial" | "paid";
}>;
