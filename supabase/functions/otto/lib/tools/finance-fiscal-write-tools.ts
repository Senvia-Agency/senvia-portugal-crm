import type { Tool } from "../types.ts";
import {
  cancelInvoice,
  issueInvoice,
  sendInvoiceEmail,
} from "./finance-fiscal-write.ts";
import {
  cancelPreview,
  issuePreview,
  sendPreview,
} from "./finance-fiscal-write-shared.ts";

export const financeFiscalWriteTools = [
  {
    name: "issue_invoice",
    module: "finance",
    isWrite: true,
    description:
      "Emitir uma fatura para uma venda existente através do fornecedor fiscal configurado. Exige confirmação explícita.",
    parameters: {
      type: "object",
      properties: {
        sale_id: { type: "string", format: "uuid" },
        observations: { type: "string", maxLength: 2000 },
      },
      required: ["sale_id"],
      additionalProperties: false,
    },
    permission: { module: "finance", subarea: "invoices", action: "issue" },
    confirmation: { kind: "confirmation_required", preview: issuePreview },
    execute: issueInvoice,
  },
  {
    name: "cancel_invoice",
    module: "finance",
    isWrite: true,
    description:
      "Anular um documento fiscal existente pelo ID interno e motivo. Exige confirmação explícita.",
    parameters: {
      type: "object",
      properties: {
        invoice_id: { type: "string", format: "uuid" },
        reason: { type: "string", minLength: 3, maxLength: 500 },
      },
      required: ["invoice_id", "reason"],
      additionalProperties: false,
    },
    permission: { module: "finance", subarea: "invoices", action: "cancel" },
    confirmation: { kind: "confirmation_required", preview: cancelPreview },
    execute: cancelInvoice,
  },
  {
    name: "send_invoice_email",
    module: "finance",
    isWrite: true,
    description:
      "Enviar o PDF de um documento fiscal finalizado para um email confirmado. Exige confirmação explícita.",
    parameters: {
      type: "object",
      properties: {
        invoice_id: { type: "string", format: "uuid" },
        email: { type: "string", format: "email" },
      },
      required: ["invoice_id", "email"],
      additionalProperties: false,
    },
    permission: { module: "finance", subarea: "invoices", action: "issue" },
    confirmation: { kind: "confirmation_required", preview: sendPreview },
    execute: sendInvoiceEmail,
  },
] satisfies readonly Tool[];
