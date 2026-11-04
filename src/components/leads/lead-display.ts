import type { LeadTemperature } from "@/types";

/** Temperature as a small tinted pill, the same on cards, the list and the lead record. */
export const TEMPERATURE_PILLS: Record<LeadTemperature, string> = {
  cold: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  warm: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  hot: "bg-red-500/10 text-red-700 dark:text-red-300",
};

/** First and last initials of a name, for the round avatars. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}
