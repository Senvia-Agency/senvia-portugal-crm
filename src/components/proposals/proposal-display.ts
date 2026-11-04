import type { ProposalStatus } from "@/types/proposals";

/** Proposal state as a small tinted pill, on the list and the proposal record. */
export const PROPOSAL_STATUS_PILLS: Record<ProposalStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  negotiating: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  accepted: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-red-500/10 text-red-700 dark:text-red-300",
  expired: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
};

/** The current state filled in its colour, on the record's state bar. */
export const PROPOSAL_STATUS_SOLID: Record<ProposalStatus, string> = {
  draft: "bg-slate-500 text-white",
  sent: "bg-blue-600 text-white",
  negotiating: "bg-amber-500 text-white",
  accepted: "bg-emerald-600 text-white",
  rejected: "bg-red-600 text-white",
  expired: "bg-slate-400 text-white",
};

export const formatEuro = (value: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(value);
