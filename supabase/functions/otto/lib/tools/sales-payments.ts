import type { Tool } from "../types.ts";
import { salePaymentReadTools } from "./sales-payments-read.ts";
import { salePaymentWriteTools } from "./sales-payments-write-tools.ts";

export const salePaymentTools: Tool[] = [
  ...salePaymentReadTools,
  ...salePaymentWriteTools,
];
