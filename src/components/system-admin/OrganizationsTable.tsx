import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { AdminTableSkeleton } from "@/components/system-admin/AdminShell";
import { classifyOrg, BUCKET_META, since, until, type OrgBucket } from "@/components/system-admin/orgStatus";
import { ManageSeatsDialog } from "./ManageSeatsDialog";
import { OrgDetailSheet } from "./OrgDetailSheet";
import { useLanguage, tr } from "@/i18n";

interface Organization {
  id: string;
  name: string;
  slug: string;
  code: string | null;
  plan: string | null;
  trial_ends_at: string | null;
  billing_exempt: boolean | null;
  created_at: string | null;
  contact_phone: string | null;
  member_count: number;
  first_paid_at: string | null;
  payment_failed_at: string | null;
  last_active_at: string | null;
  extra_seats: number | null;
}

export interface OrgStripeData {
  org_id: string;
  stripe_plan: string | null;
  stripe_amount: number;
  stripe_status: string | null;
  stripe_period_end: string | null;
  has_stripe_subscription: boolean;
}

export interface AdminContact {
  name?: string;
  email?: string;
}

export type OrgFilter = "all" | "paying" | "trial" | "overdue" | "blocked" | "expired" | "exempt";
type Filter = OrgFilter;
type SortKey = "name" | "activity" | "mrr" | "members" | "created";

interface OrganizationsTableProps {
  organizations: Organization[];
  loading?: boolean;
  currentOrgId?: string;
  onAccessOrg: (orgId: string) => void;
  /** Controlled filter, so the attention strip above can focus the list. */
  filter?: Filter;
  onFilterChange?: (filter: Filter) => void;
  stripeData?: OrgStripeData[];
  adminInfo?: Record<string, AdminContact>;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "paying", label: "Pagantes" },
  { key: "trial", label: "Trial" },
  { key: "overdue", label: "Em atraso" },
  { key: "blocked", label: "Bloqueados" },
  { key: "expired", label: "Expirados" },
  { key: "exempt", label: "Isentos" },
];

function matchesFilter(status: OrgBucket, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "expired") return status === "expired" || status === "canceled";
  if (filter === "overdue") return status === "overdue" || status === "blocked";
  return status === filter;
}

const DORMANT_MS = 7 * 86400000;

function contextLine(status: OrgBucket, o: Organization, now: Date): string {
  switch (status) {
    case "paying": return o.first_paid_at ? tr("cliente há {{time}}", { time: since(o.first_paid_at, now) }) : tr("ativo");
    case "trial": return o.trial_ends_at ? tr("faltam {{time}}", { time: until(o.trial_ends_at, now) }) : tr("trial");
    case "overdue": return tr("pagamento falhou");
    case "blocked": return o.payment_failed_at ? tr("bloqueado há {{time}}", { time: since(o.payment_failed_at, now) }) : tr("bloqueado");
    case "expired": return o.trial_ends_at ? tr("expirou há {{time}}", { time: since(o.trial_ends_at, now) }) : tr("expirado");
    case "canceled": return tr("cancelado");
    case "exempt": return tr("conta interna");
  }
}

export function OrganizationsTable({
  organizations,
  loading,
  currentOrgId,
  onAccessOrg,
  stripeData,
  adminInfo = {},
  filter: filterProp,
  onFilterChange,
}: OrganizationsTableProps) {
  const [query, setQuery] = useState("");
  const { t } = useLanguage();
  const [seatsDialog, setSeatsDialog] = useState<{ id: string; name: string; seats: number } | null>(null);
  // Clicking a row opens the detail panel. Entering another organization is a
  // deliberate act with consequences, so it lives behind its own button there.
  const [detailOrg, setDetailOrg] = useState<Organization | null>(null);
  const [filterState, setFilterState] = useState<Filter>("all");
  const filter = filterProp ?? filterState;
  const setFilter = onFilterChange ?? setFilterState;
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const now = useMemo(() => new Date(), []);

  const stripeMap = useMemo(() => {
    const m = new Map<string, OrgStripeData>();
    (stripeData || []).forEach((s) => m.set(s.org_id, s));
    return m;
  }, [stripeData]);

  // ⌘K / Ctrl+K (and "/") focus the search — the surface is search-first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = organizations.filter((org) => {
      const status = classifyOrg(org, stripeMap.get(org.id)?.stripe_status, now);
      if (!matchesFilter(status, filter)) return false;
      if (!q) return true;
      const c = adminInfo[org.id] || {};
      return (
        org.name.toLowerCase().includes(q) ||
        org.slug.toLowerCase().includes(q) ||
        (org.code || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.name || "").toLowerCase().includes(q) ||
        (org.contact_phone || "").toLowerCase().includes(q)
      );
    });

    if (sort) {
      const dir = sort.dir === "asc" ? 1 : -1;
      const activityTime = (o: Organization) => (o.last_active_at ? new Date(o.last_active_at).getTime() : -Infinity);
      const createdTime = (o: Organization) => (o.created_at ? new Date(o.created_at).getTime() : -Infinity);
      list = [...list].sort((a, b) => {
        switch (sort.key) {
          case "name": return a.name.localeCompare(b.name) * dir;
          case "members": return (a.member_count - b.member_count) * dir;
          case "mrr": return ((stripeMap.get(a.id)?.stripe_amount ?? 0) - (stripeMap.get(b.id)?.stripe_amount ?? 0)) * dir;
          case "activity": return (activityTime(a) - activityTime(b)) * dir;
          case "created": return (createdTime(a) - createdTime(b)) * dir;
          default: return 0;
        }
      });
    }
    return list;
  }, [organizations, filter, query, sort, stripeMap, adminInfo, now]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  return (
    <div className="space-y-3">
      {/* Search — the protagonist */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Procurar empresa, responsável, código, email ou telefone…")}
          className="h-11 w-full rounded-xl border bg-card pl-10 pr-16 text-sm outline-none ring-primary/30 transition focus:border-primary/40 focus:ring-2"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
          ⌘K
        </kbd>
      </div>

      {/* Filters + count */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="h-auto flex-wrap">
            {FILTERS.map((f) => (
              <TabsTrigger key={f.key} value={f.key} className="text-xs">{t(f.label)}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="text-xs text-muted-foreground tabular-nums">
          {loading ? "…" : t(rows.length === 1 ? "{{n}} empresa" : "{{n}} empresas", { n: rows.length })}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border bg-card">
        {loading ? (
          <AdminTableSkeleton rows={8} cols={6} />
        ) : rows.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-medium text-foreground">{t("Sem resultados")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {query ? <>{t("Nada corresponde a “{{query}}”.", { query })}</> : t("Nenhuma empresa neste filtro.")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead label={t("Empresa")} k="name" sort={sort} onSort={toggleSort} />
                  <TableHead>{t("Estado")}</TableHead>
                  <SortHead label={t("Última atividade")} k="activity" sort={sort} onSort={toggleSort} />
                  <SortHead label={t("€/mês")} k="mrr" sort={sort} onSort={toggleSort} align="right" />
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((org) => {
                  const stripeInfo = stripeMap.get(org.id);
                  const status = classifyOrg(org, stripeInfo?.stripe_status, now);
                  const meta = BUCKET_META[status];
                  const isCurrent = currentOrgId === org.id;
                  const contact = adminInfo[org.id] || {};
                  const lastMs = org.last_active_at ? now.getTime() - new Date(org.last_active_at).getTime() : null;
                  const dormant = lastMs === null || lastMs > DORMANT_MS;
                  const activityLabel = org.last_active_at
                    ? (lastMs !== null && lastMs < 3600000 ? t("agora") : t("há {{time}}", { time: since(org.last_active_at, now) }))
                    : t("nunca");

                  return (
                    <TableRow
                      key={org.id}
                      onClick={() => setDetailOrg(org)}
                      title={t("Ver {{name}}", { name: org.name })}
                      className={cn("group cursor-pointer", isCurrent && "bg-primary/5")}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="flex items-center gap-1.5 font-medium">
                            <span className="max-w-[220px] truncate">{org.name}</span>
                            {isCurrent && (
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{t("atual")}</span>
                            )}
                          </span>
                          <span className="max-w-[220px] truncate text-xs text-muted-foreground">
                            {contact.email || contact.name || org.slug}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <Badge className={cn("w-fit text-[10px]", meta.badge)}>{t(meta.label)}</Badge>
                          <span className="text-[11px] text-muted-foreground">{contextLine(status, org, now)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={cn("inline-flex items-center gap-1.5 text-sm", dormant ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dormant ? "bg-amber-500" : "bg-emerald-500")} />
                          {activityLabel}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {stripeInfo?.has_stripe_subscription ? (
                          <span className="text-sm font-medium tabular-nums text-emerald-600 dark:text-emerald-400">€{stripeInfo.stripe_amount}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <OrgDetailSheet
        org={detailOrg}
        onOpenChange={(open) => !open && setDetailOrg(null)}
        contact={detailOrg ? adminInfo[detailOrg.id] : undefined}
        stripe={detailOrg ? stripeMap.get(detailOrg.id) : undefined}
        isCurrent={!!detailOrg && currentOrgId === detailOrg.id}
        onAccess={(id) => onAccessOrg(id)}
        onManageSeats={(org) =>
          setSeatsDialog({ id: org.id, name: org.name, seats: org.extra_seats ?? 0 })
        }
      />

      {seatsDialog && (
        <ManageSeatsDialog
          open={!!seatsDialog}
          onOpenChange={(open) => !open && setSeatsDialog(null)}
          organizationId={seatsDialog.id}
          organizationName={seatsDialog.name}
          currentSeats={seatsDialog.seats}
        />
      )}
    </div>
  );
}

function SortHead({
  label, k, sort, onSort, className, align,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" } | null;
  onSort: (k: SortKey) => void;
  className?: string;
  align?: "right";
}) {
  const active = sort?.key === k;
  const Icon = !active ? ChevronsUpDown : sort!.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
          align === "right" && "ml-auto flex-row-reverse",
        )}
      >
        {label}
        <Icon className={cn("h-3.5 w-3.5", !active && "opacity-40")} />
      </button>
    </TableHead>
  );
}
