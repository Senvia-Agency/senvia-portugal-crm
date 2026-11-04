import type { Tool } from "../types.ts";
import { salePaymentTools } from "./sales-payments.ts";
import { salesProposalProductTools } from "./sales-proposal-products.ts";
import { salesProposalTools } from "./sales-proposals.ts";
import { salesRecordTools } from "./sales-records.ts";

export const salesTools: Tool[] = [
  ...salesRecordTools,
  ...salesProposalTools,
  ...salesProposalProductTools,
  ...salePaymentTools,
];
