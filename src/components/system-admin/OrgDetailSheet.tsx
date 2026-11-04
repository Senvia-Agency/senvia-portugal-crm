import type { ReactNode } from "react";
import { format } from "date-fns";
import { ArrowRight, Mail, Phone, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { BUCKET_META, classifyOrg, since, until, type OrgBucket } from "./orgStatus";
import type { AdminContact, OrgStripeData } from "./OrganizationsTable";
import { useLanguage, dateLocale } from "@/i18n";

export interface DetailOrg {
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
  current_period_end?: string | null;
  payment_failed_at: string | null;
  last_active_at: string | null;
  extra_seats: number | null;
}

interface OrgDetailSheetProps {
  org: DetailOrg | null;
  onOpenChange: (open: boolean) => void;
  contact?: AdminContact;
  stripe?: OrgStripeData;
  isCurrent?: boolean;
  onAccess: (orgId: string) => void;
  onManageSeats: (org: DetailOrg) => void;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm">{children}</span>
    </div>
  );
}

function fmt(date: string | null | undefined): string {
  if (!date) return "—";
  return format(new Date(date), "dd MMM yyyy", { locale: dateLocale() });
}

/**
 * Everything about one organization, in a panel.
 *
 * The table used to carry nine columns, six of them behind breakpoints, so on a
 * normal laptop half the data was invisible. The table now shows what you scan
 * by; this panel holds what you look up.
 */
export function OrgDetailSheet({
  org,
  onOpenChange,
  contact = {},
  stripe,
  isCurrent,
  onAccess,
  onManageSeats,
}: OrgDetailSheetProps) {
  const { t } = useLanguage();
  if (!org) return null;

  const now = new Date();
  const status: OrgBucket = classifyOrg(org, stripe?.stripe_status, now);
  const meta = BUCKET_META[status];

  return (
    <Sheet open={!!org} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="space-y-2 text-left">
          <SheetTitle className="flex items-center gap-2 pr-6">
            <span className="min-w-0 truncate">{org.name}</span>
            {isCurrent && (
              <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {t("atual")}
              </span>
            )}
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            <Badge className={cn("text-[10px]", meta.badge)}>{t(meta.label)}</Badge>
            <span className="text-xs">{org.slug}</span>
            {org.code && <span className="text-xs">· {org.code}</span>}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          <Button
            className="w-full"
            onClick={() => onAccess(org.id)}
            disabled={isCurrent}
          >
            {isCurrent ? t("Já estás nesta organização") : t("Aceder a esta organização")}
            {!isCurrent && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>

          <div>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">{t("Responsável")}</h3>
            {contact.name || contact.email || org.contact_phone ? (
              <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
                {contact.name && (
                  <p className="flex items-center gap-2 text-sm">
                    <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{contact.name}</span>
                  </p>
                )}
                {contact.email && (
                  <a
                    href={`mailto:${contact.email}`}
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{contact.email}</span>
                  </a>
                )}
                {org.contact_phone && (
                  <a
                    href={`tel:${org.contact_phone}`}
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{org.contact_phone}</span>
                  </a>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("Sem contacto registado.")}</p>
            )}
          </div>

          <Separator />

          <div>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">{t("Subscrição")}</h3>
            <div className="divide-y">
              <Row label={t("Plano")}>{stripe?.stripe_plan || org.plan || "—"}</Row>
              <Row label={t("Valor mensal")}>
                {stripe?.has_stripe_subscription ? (
                  <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                    €{stripe.stripe_amount}
                  </span>
                ) : (
                  "—"
                )}
              </Row>
              <Row label={t("Cliente desde")}>{fmt(org.first_paid_at)}</Row>
              {org.trial_ends_at && status === "trial" && (
                <Row label={t("Trial termina")}>
                  {fmt(org.trial_ends_at)} <span className="text-muted-foreground">· {t("faltam {{time}}", { time: until(org.trial_ends_at, now) })}</span>
                </Row>
              )}
              {org.payment_failed_at && (
                <Row label={t("Pagamento falhou")}>
                  <span className="text-destructive">{t("há {{time}}", { time: since(org.payment_failed_at, now) })}</span>
                </Row>
              )}
              <Row label={t("Renovação")}>{fmt(stripe?.stripe_period_end ?? org.current_period_end)}</Row>
            </div>
          </div>

          <Separator />

          <div>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">{t("Conta")}</h3>
            <div className="divide-y">
              <Row label={t("Membros")}>
                <span className="tabular-nums">{org.member_count}</span>
              </Row>
              <Row label={t("Lugares extra")}>
                <button
                  type="button"
                  onClick={() => onManageSeats(org)}
                  className="rounded px-1.5 py-0.5 text-sm font-medium text-primary transition hover:bg-primary/10"
                >
                  {org.extra_seats && org.extra_seats > 0
                    ? `+${org.extra_seats} (${org.extra_seats * 5}€)`
                    : t("gerir")}
                </button>
              </Row>
              <Row label={t("Criada")}>{fmt(org.created_at)}</Row>
              <Row label={t("Última atividade")}>
                {org.last_active_at ? t("há {{time}}", { time: since(org.last_active_at, now) }) : t("nunca")}
              </Row>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
