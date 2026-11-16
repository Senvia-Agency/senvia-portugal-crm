import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock5,
  ScanSearch,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Pill-style status badge: soft background + bold coloured icon and label.
// Use a preset variant, or override label/icon/colours for one-off cases.
export type StatusVariant =
  | "pending"
  | "failed"
  | "success"
  | "in_progress"
  | "in_review"
  | "expired"
  | "submitted"
  | "neutral";

interface VariantStyle {
  bg: string;
  text: string; // arbitrary value class, e.g. text-[#57BC6C]
  Icon: LucideIcon;
  label: string;
}

const VARIANTS: Record<StatusVariant, VariantStyle> = {
  pending:     { bg: "bg-orange-50 dark:bg-orange-500/10",  text: "text-[#EAA65D]", Icon: TriangleAlert, label: "Pendente" },
  failed:      { bg: "bg-rose-50 dark:bg-rose-500/10",    text: "text-[#D57463]", Icon: CircleX,       label: "Falhou" },
  success:     { bg: "bg-emerald-50 dark:bg-emerald-500/10", text: "text-[#57BC6C]", Icon: CircleCheck,   label: "Concluído" },
  in_progress: { bg: "bg-sky-100 dark:bg-sky-500/15",    text: "text-[#008AF5]", Icon: CircleDashed,  label: "Em curso" },
  in_review:   { bg: "bg-yellow-50 dark:bg-yellow-500/10",  text: "text-[#F0B13D]", Icon: ScanSearch,    label: "Em revisão" },
  expired:     { bg: "bg-zinc-100 dark:bg-muted",   text: "text-[#777777]", Icon: Clock5,        label: "Expirado" },
  submitted:   { bg: "bg-violet-50 dark:bg-violet-500/10",  text: "text-[#6C3CF0]", Icon: Clock5,        label: "Submetido" },
  neutral:     { bg: "bg-zinc-100 dark:bg-muted",   text: "text-[#777777]", Icon: CircleDashed,  label: "—" },
};

export interface StatusBadgeProps {
  variant: StatusVariant;
  /** Override the preset label. */
  label?: string;
  /** Override the preset icon. */
  icon?: LucideIcon;
  /** Hide the icon entirely. */
  hideIcon?: boolean;
  className?: string;
}

export function StatusBadge({ variant, label, icon, hideIcon, className }: StatusBadgeProps) {
  const v = VARIANTS[variant] ?? VARIANTS.neutral;
  const Icon = icon ?? v.Icon;
  return (
    <span
      className={cn(
        "inline-flex h-[26px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold",
        v.bg,
        v.text,
        className,
      )}
    >
      {!hideIcon && <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={3} />}
      {label ?? v.label}
    </span>
  );
}

export default StatusBadge;
