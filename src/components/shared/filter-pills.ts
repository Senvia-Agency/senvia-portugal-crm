import { cn } from "@/lib/utils";

/** Rounded filter pill: a card with a coloured icon at rest, filled with the brand colour while it filters. */
export const filterChipClass = (active: boolean) => cn(
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium shadow-sm transition-colors",
  active
    ? "border-primary bg-primary/10 text-primary hover:bg-primary/15"
    : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-primary/5 [&>svg:first-child]:text-primary",
);

/** "Origem", the one chosen, or "3 origens". */
export const pickedLabel = (picked: readonly string[], empty: string, plural: string, name: (value: string) => string) =>
  picked.length === 0 ? empty : picked.length === 1 ? name(picked[0]) : `${picked.length} ${plural}`;

/** The list with the value added, or taken out when it was there. */
export const toggled = <T,>(list: readonly T[], value: T): T[] =>
  (list.includes(value) ? list.filter(item => item !== value) : [...list, value]);
