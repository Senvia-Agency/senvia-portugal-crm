import { useMemo, useState } from "react";
import { format, startOfMonth } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Check, ChevronDown, ChevronRight, Hourglass, Percent, RefreshCw, Wallet } from "lucide-react";

import { BankAccountSelect } from "@/components/finance/BankAccountSelect";
import { ExportMenu, type ExportKind } from "@/components/shared/ExportMenu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCommercialCommissions, useMarkCommissionPaid, usePayCommercialCommissions,
  type CommercialCommission, type CommissionItem,
} from "@/hooks/useCommercialCommissions";
import { usePersistedState } from "@/hooks/usePersistedState";
import { exportToCsv, exportToExcel } from "@/lib/export";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn, matchesSearch } from "@/lib/utils";
import { useLanguage, tr } from "@/i18n";

interface CommissionsContentProps {
  /** Typed in the finance page's filter line. */
  readonly search: string;
  readonly dateRange?: DateRange;
}

type CommissionView = "earned" | "waiting";

const itemKey = (item: { kind: string; id: string }) => `${item.kind}-${item.id}`;
const kindLabel = (item: CommissionItem) =>
  item.kind === "recurring" ? tr("Recorrente") : item.kind === "chargeback" ? tr("Chargeback") : item.kind === "organization" ? tr("Organização") : tr("Venda");
const dayOf = (date: string | null) => (date ? formatDate(date.slice(0, 10)) : "—");

function Stat({ label, value, hint, tone }: { label: string; value: number; hint: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card px-4 py-2.5 shadow-sm">
      <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("truncate text-lg font-semibold tabular-nums", tone)}>{formatCurrency(value)}</p>
      <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * The team's commissions, counted one way everywhere: a sale's commission is
 * earned as the client pays it, in the period the payment lands; what the
 * client still owes is commission "a ganhar".
 */
export function CommissionsContent({ search, dateRange }: CommissionsContentProps) {
  const { t } = useLanguage();
  const month = useMemo(() => format(startOfMonth(new Date()), "yyyy-MM-dd"), []);
  const { data, isLoading } = useCommercialCommissions(month, null, { dateRange });
  const payMutation = usePayCommercialCommissions();
  const markPaid = useMarkCommissionPaid();
  const [view, setView] = usePersistedState<CommissionView>("commissions-view-v1", "earned");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [payTarget, setPayTarget] = useState<CommercialCommission | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bankAccount, setBankAccount] = useState("none");

  const periodHint = dateRange?.from ? t("no período") : t("todo o histórico");
  const total = data?.total ?? 0;
  const toPay = data?.totalPending ?? 0;
  const toEarn = data?.totalToEarn ?? 0;

  // Each commercial with only the lines of the chosen view that match the search.
  const groups = useMemo(() => (data?.commercials ?? []).map((commercial) => {
    const lines = view === "earned" ? commercial.items : commercial.waiting;
    const nameMatches = matchesSearch(search, commercial.name);
    return { commercial, lines: nameMatches ? lines : lines.filter((line) => matchesSearch(search, line.label)) };
  }).filter((group) => group.lines.length > 0)
    .sort((a, b) => view === "earned"
      ? b.commercial.totalPending - a.commercial.totalPending || b.commercial.total - a.commercial.total
      : b.commercial.toEarn - a.commercial.toEarn), [data, view, search]);
  const lineCount = groups.reduce((sum, group) => sum + group.lines.length, 0);

  const toggle = (userId: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(userId)) next.delete(userId); else next.add(userId);
    return next;
  });

  const handleExport = (kind: ExportKind) => {
    const rows = groups.flatMap(({ commercial, lines }) => lines.map((line) => ({
      Comercial: commercial.name,
      Tipo: kindLabel(line),
      "Cliente / venda": line.label,
      Data: dayOf(line.date),
      "Valor da venda": line.saleValue ?? "",
      "Pago pelo cliente": line.received ?? "",
      Comissão: Number(line.amount.toFixed(2)),
      Estado: view === "waiting" ? t("A ganhar") : line.paid ? t("Paga") : t("Por pagar"),
    })));
    const name = `comissoes_${format(new Date(), "yyyy-MM-dd")}`;
    if (kind === "excel") exportToExcel(rows, name); else exportToCsv(rows, name);
  };

  // Paying: every pending line ticked by default; chargebacks are always deducted.
  const pendingItems = payTarget ? payTarget.items.filter((item) => !item.paid) : [];
  const selectedItems = pendingItems.filter((item) => selectedIds.has(itemKey(item)));
  const selectedTotal = selectedItems.reduce((sum, item) => sum + item.amount, 0);
  const openPay = (commercial: CommercialCommission) => {
    setBankAccount("none");
    setSelectedIds(new Set(commercial.items.filter((item) => !item.paid).map(itemKey)));
    setPayTarget(commercial);
  };
  const toggleSelected = (item: CommissionItem, on: boolean) => {
    if (item.kind === "chargeback") return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (on) next.add(itemKey(item)); else next.delete(itemKey(item));
      return next;
    });
  };
  const confirmPay = () => {
    if (!payTarget || selectedItems.length === 0 || selectedTotal < 0) return;
    payMutation.mutate({
      fullName: payTarget.name,
      bankAccountId: bankAccount === "none" ? null : bankAccount,
      saleIds: selectedItems.filter((item) => item.kind === "direct").map((item) => item.id),
      recordIds: selectedItems.filter((item) => item.kind === "recurring").map((item) => item.id),
      organizationSaleIds: selectedItems.filter((item) => item.kind === "organization").flatMap((item) => item.sourceSaleIds ?? []),
      saleChargebackIds: selectedItems.filter((item) => item.kind === "chargeback" && !item.manualChargeback).map((item) => item.id),
      manualChargebackIds: selectedItems.filter((item) => item.kind === "chargeback" && item.manualChargeback).map((item) => item.id),
      total: selectedTotal,
    }, { onSuccess: () => setPayTarget(null) });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label={t("Ganhas")} value={total} hint={periodHint} />
        <Stat label={t("Pagas")} value={total - toPay} hint={t("já pagas aos comerciais")} tone="text-emerald-600 dark:text-emerald-400" />
        <Stat label={t("Por pagar")} value={toPay} hint={t("ganhas e ainda não pagas")} tone={toPay > 0.005 ? "text-amber-600 dark:text-amber-400" : undefined} />
        <Stat label={t("A ganhar")} value={toEarn} hint={t("quando os clientes pagarem")} tone="text-muted-foreground" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t("Comissões a mostrar")} className="flex items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-sm">
          {([["earned", "Ganhas", Wallet], ["waiting", "A ganhar", Hourglass]] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}
              className={cn("flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                view === key ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30" : "text-foreground/75 hover:bg-muted")}>
              <Icon className="h-3.5 w-3.5" />{t(label)}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {t(groups.length === 1 ? "{{n}} comercial" : "{{n}} comerciais", { n: groups.length })} · {t(lineCount === 1 ? "{{n}} linha" : "{{n}} linhas", { n: lineCount })}
        </p>
        <div className="ml-auto">
          <ExportMenu count={lineCount} noun={t("comissões")} onExport={handleExport} />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[0, 1].map((key) => <Skeleton key={key} className="h-32 w-full rounded-xl" />)}</div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-card py-14 text-center shadow-sm">
          <Percent className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium">{view === "earned" ? t("Sem comissões ganhas") : t("Nada a ganhar")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {view === "earned"
              ? t("A comissão de uma venda é ganha à medida que o cliente paga. Muda o período ou vê o que está a ganhar.")
              : t("Todas as vendas com comissão já foram pagas pelos clientes.")}
          </p>
        </div>
      ) : groups.map(({ commercial, lines }) => {
        const open = !collapsed.has(commercial.userId);
        return (
          <section key={commercial.userId} className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-center gap-3 p-3 sm:px-4">
              <button type="button" onClick={() => toggle(commercial.userId)} aria-expanded={open}
                className="flex min-w-0 flex-1 items-center gap-3 text-left">
                {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {commercial.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{commercial.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {view === "earned"
                      ? <>{t("{{value}} ganhas", { value: formatCurrency(commercial.total) })}{commercial.toEarn > 0.005 && <> · {t("{{value}} a ganhar", { value: formatCurrency(commercial.toEarn) })}</>}</>
                      : <>{t(lines.length === 1 ? "{{n}} venda à espera do cliente" : "{{n}} vendas à espera do cliente", { n: lines.length })}</>}
                  </span>
                </span>
              </button>
              {view === "earned" ? (
                commercial.totalPending > 0.005 ? (
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium tabular-nums text-amber-700 dark:text-amber-400">
                      {t("{{value}} por pagar", { value: formatCurrency(commercial.totalPending) })}
                    </span>
                    <Button size="sm" className="h-8 rounded-full" onClick={() => openPay(commercial)}>{t("Pagar")}</Button>
                  </div>
                ) : (
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">{t("Tudo pago")}</span>
                )
              ) : (
                <span className="text-sm font-semibold tabular-nums text-muted-foreground">{formatCurrency(commercial.toEarn)}</span>
              )}
            </div>

            {open && (
              <div className="divide-y border-t">
                {lines.map((line) => (
                  <div key={`${itemKey(line)}-${line.date}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_9rem_8rem_7rem] sm:px-4">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate font-medium">
                        {line.kind === "recurring" && <RefreshCw className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={t("Recorrente")} />}
                        {line.label}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {kindLabel(line)} · {dayOf(line.date)}
                        <span className="sm:hidden">{line.saleValue != null && <> · {line.received != null ? t("{{received}} de {{total}}", { received: formatCurrency(line.received), total: formatCurrency(line.saleValue) }) : formatCurrency(line.saleValue)}</>}</span>
                      </p>
                    </div>
                    <p className="hidden text-right text-xs tabular-nums text-muted-foreground sm:block">
                      {line.saleValue == null ? "—"
                        : line.received != null ? <>{formatCurrency(line.received)} <span className="text-muted-foreground/70">{t("de {{value}}", { value: formatCurrency(line.saleValue) })}</span></>
                          : formatCurrency(line.saleValue)}
                    </p>
                    <p className={cn("text-right font-semibold tabular-nums", line.amount < 0 && "text-destructive", view === "waiting" && "text-muted-foreground")}>
                      {formatCurrency(line.amount)}
                    </p>
                    <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1">
                      {view === "waiting" ? (
                        <span className="text-xs text-muted-foreground">{t("a ganhar")}</span>
                      ) : (
                        <>
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium",
                            line.paid ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400")}>
                            {line.kind === "chargeback" ? (line.paid ? t("Aplicado") : t("Por aplicar")) : line.paid ? t("Paga") : t("Por pagar")}
                          </span>
                          {!line.paid && line.kind !== "chargeback" && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600 hover:text-emerald-700" title={t("Marcar como paga, sem lançar despesa")}
                              aria-label={t("Marcar como paga a comissão de {{name}}", { name: line.label })} disabled={markPaid.isPending}
                              onClick={() => line.kind === "organization"
                                ? markPaid.mutate({ kind: "organization", id: line.id, sourceSaleIds: line.sourceSaleIds ?? [] })
                                : markPaid.mutate({ kind: line.kind === "recurring" ? "recurring" : "direct", id: line.id })}>
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      <Dialog open={!!payTarget} onOpenChange={(open) => !open && setPayTarget(null)}>
        <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-4 md:px-6">
            <DialogTitle>{t("Pagar comissões — {{name}}", { name: payTarget?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("As comissões escolhidas ficam pagas e o total é lançado como despesa na conta de onde sai.")}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
            <div className="mx-auto max-w-2xl space-y-4">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-medium text-muted-foreground">{t("{{n}} por pagar", { n: pendingItems.length })}</span>
                <button type="button" className="text-xs font-medium text-primary hover:underline"
                  onClick={() => setSelectedIds(selectedItems.length === pendingItems.length
                    ? new Set(pendingItems.filter((item) => item.kind === "chargeback").map(itemKey))
                    : new Set(pendingItems.map(itemKey)))}>
                  {selectedItems.length === pendingItems.length ? t("Desmarcar todas") : t("Selecionar todas")}
                </button>
              </div>
              <div className="divide-y rounded-xl border bg-card shadow-sm">
                {pendingItems.map((item) => (
                  <label key={itemKey(item)} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
                    <Checkbox checked={selectedIds.has(itemKey(item))} disabled={item.kind === "chargeback"}
                      onCheckedChange={(value) => toggleSelected(item, value === true)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {item.kind === "chargeback" ? t("Desconto obrigatório") : kindLabel(item)} · {dayOf(item.date)}
                      </span>
                    </span>
                    <span className={cn("text-sm font-semibold tabular-nums", item.amount < 0 && "text-destructive")}>{formatCurrency(item.amount)}</span>
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-xl border bg-muted/30 p-4">
                <span className="text-sm font-medium text-muted-foreground">{t("Selecionadas ({{selected}}/{{total}})", { selected: selectedItems.length, total: pendingItems.length })}</span>
                <span className="text-xl font-bold tabular-nums text-primary">{formatCurrency(selectedTotal)}</span>
              </div>
              <BankAccountSelect value={bankAccount} onChange={setBankAccount} label={t("Conta de onde sai")} />
            </div>
          </div>
          <DialogFooter className="border-t px-4 py-4 md:px-6">
            <Button variant="outline" onClick={() => setPayTarget(null)} disabled={payMutation.isPending}>{t("Cancelar")}</Button>
            <Button onClick={confirmPay} disabled={payMutation.isPending || selectedItems.length === 0 || selectedTotal < 0}>
              {payMutation.isPending ? t("A pagar…") : t("Pagar {{value}}", { value: formatCurrency(selectedTotal) })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
