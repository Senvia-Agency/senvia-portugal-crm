import type { ClientStatus } from "@/types/clients";

/** Client state as a small tinted pill, on the list and the client record. */
export const CLIENT_STATUS_PILLS: Record<ClientStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  inactive: "bg-muted text-muted-foreground",
};
