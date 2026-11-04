import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/i18n";

// Shared chrome for every System Admin page: one header vocabulary, one
// container, one back affordance. Keeps the surface consistent (product register:
// the same vocabulary screen to screen is a virtue) and removes per-page boilerplate.

const MAXW = {
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
  /** Dashboard only: overview sidebar + customers list side by side. */
  wide: "max-w-[1800px]",
} as const;

interface AdminShellProps {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  back?: boolean;
  maxWidth?: keyof typeof MAXW;
  children: ReactNode;
}

export function AdminShell({
  title,
  description,
  icon: Icon,
  action,
  back = true,
  maxWidth = "6xl",
  children,
}: AdminShellProps) {
  const { t } = useLanguage();
  return (
    <div className="crm-page">
      <div className={cn("mx-auto px-4 py-6 lg:px-8 lg:py-8", MAXW[maxWidth])}>
        <header className="mb-7 flex items-start gap-3 sm:gap-4">
          {back && (
            <Link
              to="/system-admin"
              aria-label={t("Voltar ao painel")}
              className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
              {Icon && <Icon className="h-5 w-5 shrink-0 text-primary" />}
              <span className="truncate">{title}</span>
            </h1>
            {description && (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
        {children}
      </div>
    </div>
  );
}

export type StatTone = "default" | "success" | "warning" | "danger" | "primary";

const TONE: Record<StatTone, string> = {
  default: "text-foreground",
  primary: "text-primary",
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-destructive",
};

export interface AdminStat {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: StatTone;
  loading?: boolean;
}

// A dense, single-surface stat strip with hairline dividers. Deliberately NOT the
// four-identical-hero-cards template: one bordered band, values tabular-aligned.
export function AdminStatBand({ stats }: { stats: AdminStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
      {stats.map((s, i) => (
        <div key={i} className="bg-card px-5 py-4">
          <div className="text-xs font-medium text-muted-foreground">{s.label}</div>
          {s.loading ? (
            <Skeleton className="mt-1.5 h-7 w-16" />
          ) : (
            <div className={cn("mt-1 text-2xl font-semibold tracking-tight tabular-nums", TONE[s.tone ?? "default"])}>
              {s.value}
            </div>
          )}
          {s.hint && <div className="mt-0.5 text-xs text-muted-foreground">{s.hint}</div>}
        </div>
      ))}
    </div>
  );
}

// Skeleton rows for tables (product register prefers skeletons over a spinner in
// the middle of content).
export function AdminTableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn("h-4", c === 0 ? "w-40 shrink-0" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}
