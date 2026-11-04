import type { SaleStatus, TelecomStatus } from "@/types/sales";

/** Sale state as a small tinted pill, on the list and the sale record. */
export const SALE_STATUS_PILLS: Record<SaleStatus, string> = {
  in_progress: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  fulfilled: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  delivered: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-red-500/10 text-red-700 dark:text-red-300",
};

/** The telecom lifecycle, same pill style. */
export const TELECOM_STATUS_PILLS: Record<TelecomStatus, string> = {
  pendente: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  em_instalacao: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  ativo: "bg-green-500/10 text-green-700 dark:text-green-300",
  instalado: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  anulado: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  cancelado: "bg-red-500/10 text-red-700 dark:text-red-300",
};
