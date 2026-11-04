import type { Tool } from "../types.ts";
import { financeExpenseReadTools } from "./finance-expense-read-tools.ts";
import { financeExpenseWriteTools } from "./finance-expense-write.ts";
import { financeFiscalReadTools } from "./finance-fiscal-read.ts";
import { financeFiscalWriteTools } from "./finance-fiscal-write-tools.ts";
import { financePaymentReadTools } from "./finance-payment-read.ts";

export const financeTools = [
  ...financeFiscalReadTools,
  ...financePaymentReadTools,
  ...financeExpenseReadTools,
  ...financeExpenseWriteTools,
  ...financeFiscalWriteTools,
] satisfies readonly Tool[];
