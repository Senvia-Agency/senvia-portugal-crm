import type { Tool } from "../types.ts";
import {
  createPreview,
  createSalePayment,
  deletePreview,
  deleteSalePayment,
  updatePreview,
  updateSalePayment,
} from "./sales-payments-write.ts";

const paymentProperties = {
  amount: { type: "number", exclusiveMinimum: 0 },
  payment_date: { type: "string", format: "date" },
  payment_method: { type: ["string", "null"], enum: ["mbway", "transfer", "cash", "card", "credit_card", "debit_card", "check", "other", null] },
  status: { type: "string", enum: ["pending", "paid"] },
  notes: { type: ["string", "null"], maxLength: 10000 },
  invoice_reference: { type: ["string", "null"], maxLength: 160 },
  bank_account_id: { type: ["string", "null"], format: "uuid" },
} as const;

export const salePaymentWriteTools: Tool[] = [
  {
    name: "create_sale_payment",
    description: "Registar um pagamento manual numa venda. Apenas os campos manuais da interface são aceites e a operação exige confirmação financeira.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { sale_id: { type: "string", format: "uuid" }, ...paymentProperties },
      required: ["sale_id", "amount", "payment_date", "status"],
    },
    module: "sales",
    permission: { module: "sales", subarea: "payments", action: "add" },
    isWrite: true,
    confirmation: { kind: "confirmation_required", preview: createPreview },
    execute: createSalePayment,
  },
  {
    name: "update_sale_payment",
    description: "Editar os campos manuais de um pagamento nativo. Pagamentos recorrentes, Stripe e fiscais são somente leitura; a operação exige confirmação financeira.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { payment_id: { type: "string", format: "uuid" }, ...paymentProperties },
      required: ["payment_id"],
    },
    module: "sales",
    permission: { module: "sales", subarea: "payments", action: "add" },
    isWrite: true,
    confirmation: { kind: "confirmation_required", preview: updatePreview },
    execute: updateSalePayment,
  },
  {
    name: "delete_sale_payment",
    description: "Eliminar um pagamento manual nativo. Pagamentos recorrentes, Stripe e fiscais não podem ser eliminados; a operação exige confirmação financeira.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { payment_id: { type: "string", format: "uuid" } },
      required: ["payment_id"],
    },
    module: "sales",
    permission: { module: "sales", subarea: "payments", action: "add" },
    isWrite: true,
    confirmation: { kind: "confirmation_required", preview: deletePreview },
    execute: deleteSalePayment,
  },
];
