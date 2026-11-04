import { tr } from "@/i18n";
// Single source of truth for an organization's commercial status. Used by both
// the overview buckets and the clients table so the two never disagree.
//
// Canonical signals (in priority order):
//   billing_exempt          -> interna/demo
//   stripe canceled         -> cancelada
//   payment_failed / past_due / unpaid -> em atraso (receita em risco)
//   first_paid_at OR stripe active     -> pagante
//   trial_ends_at in future -> em trial
//   otherwise               -> trial expirado

export type OrgBucket = "paying" | "trial" | "overdue" | "blocked" | "expired" | "canceled" | "exempt";

export interface ClassifiableOrg {
  billing_exempt: boolean | null;
  trial_ends_at: string | null;
  first_paid_at: string | null;
  payment_failed_at: string | null;
}

const GRACE_DAYS = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

export function classifyOrg(o: ClassifiableOrg, stripeStatus: string | null | undefined, now: Date): OrgBucket {
  if (o.billing_exempt) return "exempt";
  if (stripeStatus === "canceled") return "canceled";
  if (o.payment_failed_at || stripeStatus === "past_due" || stripeStatus === "unpaid") {
    // Check if grace window has passed
    if (o.payment_failed_at) {
      const blockAt = new Date(o.payment_failed_at).getTime() + GRACE_DAYS * DAY_MS;
      if (now.getTime() > blockAt) return "blocked";
    }
    return "overdue";
  }
  if (o.first_paid_at || stripeStatus === "active") return "paying";
  if (o.trial_ends_at && new Date(o.trial_ends_at) > now) return "trial";
  return "expired";
}

export const BUCKET_META: Record<OrgBucket, { label: string; badge: string; dot: string }> = {
  paying: {
    label: "Pago",
    badge: "border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  trial: {
    label: "Trial",
    badge: "border-transparent bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  overdue: {
    label: "Em atraso",
    badge: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  blocked: {
    label: "Bloqueado",
    badge: "border-transparent bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
    dot: "bg-red-600",
  },
  expired: {
    label: "Expirado",
    badge: "border-transparent bg-destructive/10 text-destructive",
    dot: "bg-rose-500",
  },
  canceled: {
    label: "Cancelado",
    badge: "border-transparent bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-400",
    dot: "bg-zinc-400",
  },
  exempt: {
    label: "Isento",
    badge: "border-transparent bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/30",
  },
};

// Compact "time since" / "time until" for tenure, expiry and last-activity cells.
export function humanSpan(ms: number): string {
  const days = Math.floor(Math.abs(ms) / 86400000);
  if (days < 1) {
    const hours = Math.floor(Math.abs(ms) / 3600000);
    return hours < 1 ? tr("agora") : `${hours}h`;
  }
  if (days < 7) return `${days}d`;
  if (days < 30) return tr("{{n}} sem", { n: Math.floor(days / 7) });
  if (days < 365) {
    const m = Math.floor(days / 30);
    return tr(m > 1 ? "{{n}} meses" : "{{n}} mês", { n: m });
  }
  const y = Math.floor(days / 365);
  return tr(y > 1 ? "{{n}} anos" : "{{n}} ano", { n: y });
}

export function since(dateStr: string | null, now: Date): string {
  if (!dateStr) return "—";
  return humanSpan(now.getTime() - new Date(dateStr).getTime());
}

export function until(dateStr: string | null, now: Date): string {
  if (!dateStr) return "—";
  return humanSpan(new Date(dateStr).getTime() - now.getTime());
}
