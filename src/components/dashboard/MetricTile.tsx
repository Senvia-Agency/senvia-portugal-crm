import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One number of the Painel's top strip: what it counts, the number, one line
 * of context. Small on purpose — six of them share a row. The icon takes the
 * colour of the module the number comes from (data-module, workplace.css).
 * With `to`, the whole tile opens the page behind the number.
 */
export function MetricTile({ icon: Icon, title, value, trend, subtitle, module = "dashboard", hint, to, children, className }: {
  icon?: LucideIcon;
  title: string;
  value: ReactNode;
  trend?: ReactNode;
  subtitle?: ReactNode;
  module?: string;
  /** Longer explanation, on hover. */
  hint?: string;
  to?: string;
  children?: ReactNode;
  className?: string;
}) {
  const body = <>
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      {Icon && <Icon className="dashboard-metric-icon h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span className="dashboard-metric-label truncate">{title}</span>
    </div>
    <div className="mt-1 flex items-baseline gap-1.5">
      <span className="dashboard-metric-value text-xl font-semibold leading-tight tabular-nums">{value}</span>
      {trend}
    </div>
    {subtitle && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</p>}
    {children}
  </>;
  const tileClass = cn("dashboard-metric block min-w-0 rounded-xl border bg-card px-3 py-3", className);
  return to ? (
    <Link to={to} data-module={module} title={hint}
      className={cn(tileClass, "transition-colors hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
      {body}
    </Link>
  ) : (
    <div data-module={module} title={hint} className={tileClass}>{body}</div>
  );
}
