import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Standard page header — matches the "Caixa de Entrada" title exactly: a small
// inline icon (h-5 w-5, primary colour) + text-lg font-semibold title, optional
// subtitle below, and right-aligned actions (which stack under the title on mobile).
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          {Icon && <Icon className="h-5 w-5 shrink-0 text-primary" />}
          <span className="truncate">{title}</span>
        </h1>
        {subtitle && <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
