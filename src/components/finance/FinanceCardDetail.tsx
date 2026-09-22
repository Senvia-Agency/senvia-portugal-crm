import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Plus, Pencil, Trash2, CheckCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO, startOfDay, endOfDay, isSameMonth } from "date-fns";
import { pt } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PaymentWithSale } from "@/types/finance";
import { saleMatchesCommissionFilters, type CommissionFilters } from "@/lib/commission-filters";
import { useSaleTypeIds } from "@/hooks/useSaleTypeIds";
import { useTeamCommissionTotal } from "@/hooks/useCommercialCommissions";
import { PAYMENT_METHOD_LABELS, TELECOM_STATUS_LABELS, TELECOM_STATUS_COLORS, type TelecomStatus } from "@/types/sales";
import { TELECOM_EARNED_STATUSES, telecomCommissionDate, telecomCommissionInPeriod } from "@/lib/telecom-finance";
import { isTelecomAwaitingScheduledInstall } from "@/lib/telecom-sale-views";
import { sumOperationalSaleUnits } from "@/lib/sale-units";
import { StatusBadge } from "@/components/ui/status-badge";
import { saleStatusBadge, paymentRecordStatusBadge } from "@/lib/status-badge-maps";
import { useSales } from "@/hooks/useSales";
import { useProfileNames } from "@/hooks/useTeam";
import { useExpenses, useDeleteExpense } from "@/hooks/useExpenses";
import { useUpdateSalePayment, useCreateSalePayment } from "@/hooks/useSalePayments";
import { MinhasComissoesContent } from "@/components/finance/MinhasComissoesContent";
import { TeamCommissionsTab } from "@/components/finance/TeamCommissionsTab";
import { AddExpenseModal } from "@/components/finance/AddExpenseModal";
import { EditExpenseModal } from "@/components/finance/EditExpenseModal";
import type { Expense } from "@/types/expenses";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type FinanceDetailType =
  | "faturado" | "received" | "pending" | "overdue" | "dueSoon" | "expenses" | "balance" | "myCommissions" | "commissions"
  | "porInstalar" | "instalado" | "organizationValue";

interface FinanceCardDetailProps {
  type: FinanceDetailType;
  dateRange?: DateRange;
  /** Date-filtered payments (used by Recebido/Balanço). */
  payments: PaymentWithSale[];
  /** All payments, unfiltered by period (used by Pendente/Atrasados). */
  allPayments: PaymentWithSale[];
  dueSoonPayments: PaymentWithSale[];
  /** Telecom: the operator/seller filters the card was showing. */
  commissionFilters?: CommissionFilters;
  onBack: () => void;
}

/** Stripe plan/subscription payments are excluded from pending/overdue, matching the card totals. */
const isPlanPayment = (p: PaymentWithSale) => Boolean(p.sale?.client_org_id);

const TITLES: Record<FinanceDetailType, string> = {
  faturado: "Total Faturado",   // telecom overrides this to "Total de Comissão"
  received: "Recebido",
  pending: "Pendente",
  overdue: "Atrasados",
  dueSoon: "A Vencer (7 dias)",
  expenses: "Despesas",
  balance: "Balanço",
  myCommissions: "As Minhas Comissões",
  commissions: "Comissões",
  porInstalar: "Por instalar",
  instalado: "Ativos e instalados",
  organizationValue: "Valor da Organização",
};

function inRange(dateStr: string, dateRange?: DateRange) {
  if (!dateRange?.from) return true;
  const d = parseISO(dateStr);
  if (d < startOfDay(dateRange.from)) return false;
  if (dateRange.to && d > endOfDay(dateRange.to)) return false;
  return true;
}

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return '—';
  return format(parseISO(dateStr), "dd MMM yyyy", { locale: pt });
}

function TotalFooter({ count, total }: { count: number; total: number }) {
  return (
    <div className="flex justify-between border-t px-4 py-2 text-sm font-medium">
      <span>Total ({count})</span>
      <span>{formatCurrency(total)}</span>
    </div>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="h-24 text-center text-muted-foreground">
        Sem registos.
      </TableCell>
    </TableRow>
  );
}

function PaymentsDetailTable({ payments, allowMarkPaid = false }: { payments: PaymentWithSale[]; allowMarkPaid?: boolean }) {
  const queryClient = useQueryClient();
  const updatePayment = useUpdateSalePayment();
  const createPayment = useCreateSalePayment();
  const [confirm, setConfirm] = useState<PaymentWithSale | null>(null);
  const [received, setReceived] = useState("");
  const [payDate, setPayDate] = useState("");
  const total = payments.reduce((s, p) => s + p.amount, 0);
  const showActions = allowMarkPaid && payments.some((p) => p.status === "pending");

  const openConfirm = (p: PaymentWithSale) => {
    setConfirm(p);
    setReceived(String(p.amount));
    setPayDate(format(new Date(), "yyyy-MM-dd"));
  };

  const full = confirm ? Number(confirm.amount) || 0 : 0;
  const receivedNum = Math.min(full, Math.max(0, parseFloat(received.replace(",", ".")) || 0));
  const remainder = +(full - receivedNum).toFixed(2);
  const isPartial = receivedNum > 0 && remainder > 0.005;
  const busy = updatePayment.isPending || createPayment.isPending;

  const invalidateDerived = () => {
    // The pending list / commissions are derived from these queries, which the
    // payment mutations don't touch — refresh them so the UI updates.
    ["finance-stats", "finance-sales", "my-commissions", "commercial-commissions",
      "team-commission-total", "commissions-detail"].forEach((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }));
  };

  const handleMarkPaid = async () => {
    if (!confirm || receivedNum <= 0) return;
    const { id, sale_id } = confirm;

    try {
      if (!isPartial) {
        // Full amount received: just flip the parcel to paid on the chosen date.
        await updatePayment.mutateAsync({
          paymentId: id, saleId: sale_id, updates: { status: "paid", payment_date: payDate },
        });
      } else {
        // Partial payment. Create the REMAINDER parcel FIRST, then mark the received
        // part paid. Ordering matters: if the second write fails, the outstanding
        // balance still exists (worst case a duplicate to reconcile) — never lost.
        // The old order shrank the original first, so a failed insert silently
        // destroyed the remaining balance.
        await createPayment.mutateAsync({
          sale_id,
          organization_id: confirm.organization_id,
          amount: remainder,
          payment_date: confirm.payment_date,
          status: "pending",
          payment_method: confirm.payment_method ?? null,
          notes: confirm.notes ?? null,
        });
        await updatePayment.mutateAsync({
          paymentId: id, saleId: sale_id, updates: { amount: receivedNum, status: "paid", payment_date: payDate },
        });
      }
      invalidateDerived();
    } catch {
      // The mutations surface their own error toast; nothing is lost because the
      // remainder is created before the original parcel is modified.
    } finally {
      setConfirm(null);
    }
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Venda</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead className="hidden sm:table-cell">Método</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            {showActions && <TableHead className="text-right">Ações</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.length === 0 ? (
            <EmptyRow cols={showActions ? 7 : 6} />
          ) : (
            payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="whitespace-nowrap">{fmtDate(p.payment_date)}</TableCell>
                <TableCell>{p.sale?.code || "—"}</TableCell>
                <TableCell>{p.client_name || p.lead_name || "—"}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  {p.payment_method ? PAYMENT_METHOD_LABELS[p.payment_method] : "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge {...paymentRecordStatusBadge(p.status)} />
                </TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(p.amount)}</TableCell>
                {showActions && (
                  <TableCell className="text-right">
                    {p.status === "pending" && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openConfirm(p)}>
                        <CheckCircle className="h-4 w-4" />
                        <span className="hidden sm:inline">Marcar Pago</span>
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {payments.length > 0 && <TotalFooter count={payments.length} total={total} />}

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Marcar pagamento como pago?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && (
                <>
                  {confirm.client_name || confirm.lead_name || "Cliente"} — venda{" "}
                  {confirm.sale?.code || "—"} • total agendado {formatCurrency(full)}.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="mp-amount">Valor recebido</Label>
              <Input
                id="mp-amount"
                type="number"
                step="0.01"
                min="0"
                max={full}
                value={received}
                onChange={(e) => setReceived(e.target.value)}
              />
              {isPartial && (
                <p className="text-xs text-muted-foreground">
                  Ficará {formatCurrency(remainder)} agendado (parcela restante).
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mp-date">Data de pagamento</Label>
              <Input id="mp-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleMarkPaid} disabled={busy || receivedNum <= 0 || !payDate}>
              {isPartial ? "Registar parcial" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface RenewalRow { id: string; date: string; label: string; amount: number; }

function SalesDetailTable({
  dateRange,
  renewals = [],
  commissionFilters,
  telecomStatuses,
  scheduledInstallationOnly = false,
  dateBasis = "sale",
}: {
  dateRange?: DateRange;
  renewals?: RenewalRow[];
  commissionFilters?: CommissionFilters;
  /** Telecom lifecycle cards: keep only these states. */
  telecomStatuses?: TelecomStatus[];
  scheduledInstallationOnly?: boolean;
  /** "activation" counts a sale when it went live, not when it was sold. */
  dateBasis?: "sale" | "activation";
}) {
  const { data: sales = [], isLoading } = useSales();
  const saleTypeIds = useSaleTypeIds();
  const { organization } = useAuth();
  // Telecom shows operator commission. Keep the lifecycle, date basis and
  // filters identical to the summary card in useFinanceStats.
  const isTelecom = organization?.niche === "telecom";
  const filtered = useMemo(
    // Exclude cancelled sales so this detail's total matches the card, which also
    // drops them (useFinanceStats). Both telecom cancellations map onto it.
    () => sales.filter((s) =>
      s.status !== "cancelled"
      && (dateBasis === "activation" ? telecomCommissionInPeriod(s, dateRange) : inRange(s.sale_date, dateRange))
      && saleMatchesCommissionFilters(s, commissionFilters, saleTypeIds)
      && (!telecomStatuses || telecomStatuses.includes(s.telecom_status as TelecomStatus))
      && (!scheduledInstallationOnly || isTelecomAwaitingScheduledInstall(s))),
    [sales, dateRange, commissionFilters, saleTypeIds, telecomStatuses, scheduledInstallationOnly, dateBasis],
  );
  // Who gets paid for each sale — the assigned seller, falling back to
  // whoever registered it. Hook stays above the early return.
  const { data: sellerNames = {} } = useProfileNames(
    filtered.map((s) => s.seller_id || s.created_by),
  );
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  const sellerOf = (s: any) => {
    const id = s.seller_id || s.created_by;
    return id ? (sellerNames[id] ?? "—") : "—";
  };
  const valueOf = (s: any) => isTelecom ? Number(s.comissao) || 0 : Number(s.total_value) || 0;
  const salesTotal = filtered.reduce((sum, v) => sum + valueOf(v), 0);
  // Renewals are client billing — they have no place in a commission total.
  const shownRenewals = isTelecom ? [] : renewals;
  const renewalsTotal = shownRenewals.reduce((s, r) => s + r.amount, 0);
  const total = salesTotal + renewalsTotal;
  const count = filtered.length + shownRenewals.length;
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{dateBasis === 'activation' ? 'Recebimento previsto' : 'Data'}</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Código</TableHead>
            {isTelecom && <TableHead>Vendedor</TableHead>}
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">{isTelecom ? "Comissão" : "Valor"}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {count === 0 ? (
            <EmptyRow cols={isTelecom ? 6 : 5} />
          ) : (
            <>
              {filtered.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-nowrap">{dateBasis === 'activation' && (s.commission_payment_month_offset ?? 0) > 0 && telecomCommissionDate(s)
                    ? format(parseISO(telecomCommissionDate(s)!), 'MMM yyyy', { locale: pt })
                    : fmtDate(dateBasis === 'activation' ? telecomCommissionDate(s) : s.sale_date)}</TableCell>
                  <TableCell>{s.client?.name || s.lead?.name || "—"}</TableCell>
                  <TableCell>{s.code}</TableCell>
                  {isTelecom && <TableCell>{sellerOf(s)}</TableCell>}
                  <TableCell>
                    {isTelecom && s.telecom_status ? (
                      <Badge variant="outline" className={TELECOM_STATUS_COLORS[s.telecom_status]}>{TELECOM_STATUS_LABELS[s.telecom_status]}</Badge>
                    ) : <StatusBadge {...saleStatusBadge(s.status)} />}
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(valueOf(s))}</TableCell>
                </TableRow>
              ))}
              {shownRenewals.map((r) => (
                <TableRow key={`renewal-${r.id}`}>
                  <TableCell className="whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                  <TableCell>{r.label}</TableCell>
                  <TableCell>—</TableCell>
                  {isTelecom && <TableCell>—</TableCell>}
                  <TableCell>
                    <Badge variant="outline" className="border-blue-500/30 bg-blue-500/20 text-blue-600">
                      Renovação
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(r.amount)}</TableCell>
                </TableRow>
              ))}
            </>
          )}
        </TableBody>
      </Table>
      {count > 0 && <TotalFooter count={isTelecom ? sumOperationalSaleUnits(filtered) : count} total={total} />}
    </div>
  );
}

function OrganizationValueDetail({ dateRange, commissionFilters }: { dateRange?: DateRange; commissionFilters?: CommissionFilters }) {
  // Reuse the card's query so rows, permissions, filters and total cannot diverge.
  const { data, isLoading, isError, refetch } = useTeamCommissionTotal(dateRange, commissionFilters);
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) return <div className="rounded-md border p-4">Não foi possível carregar as vendas. <Button variant="outline" onClick={() => void refetch()}>Tentar novamente</Button></div>;
  const rows = data?.organizationSales ?? [];
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Recebimento previsto</TableHead>
          <TableHead>Cliente</TableHead>
          <TableHead>Código</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead className="text-right">Valor da Organização</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 ? <EmptyRow cols={5} /> : rows.map((sale) => (
            <TableRow key={sale.id}>
              <TableCell className="whitespace-nowrap">{sale.deferred && sale.date ? format(parseISO(sale.date), 'MMM yyyy', { locale: pt }) : fmtDate(sale.date)}</TableCell>
              <TableCell>{sale.clientName}</TableCell>
              <TableCell>{sale.code || '—'}</TableCell>
              <TableCell><Badge variant="outline" className={TELECOM_STATUS_COLORS[sale.telecomStatus as TelecomStatus]}>{TELECOM_STATUS_LABELS[sale.telecomStatus as TelecomStatus]}</Badge></TableCell>
              <TableCell className="text-right font-medium">{formatCurrency(sale.amount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > 0 && <TotalFooter count={rows.length} total={data?.orgTotal ?? 0} />}
    </div>
  );
}

function ExpensesDetailTable({ dateRange }: { dateRange?: DateRange }) {
  const { data: expenses = [], isLoading } = useExpenses();
  const deleteExpense = useDeleteExpense();
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const filtered = useMemo(
    () => expenses.filter((e) => inRange(e.expense_date, dateRange)),
    [expenses, dateRange],
  );
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  const total = filtered.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead className="w-[1%]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <EmptyRow cols={5} />
          ) : (
            filtered.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap">{fmtDate(e.expense_date)}</TableCell>
                <TableCell>{e.description}</TableCell>
                <TableCell>{e.category?.name || "—"}</TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(e.amount)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditExpense(e)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeleteId(e.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {filtered.length > 0 && <TotalFooter count={filtered.length} total={total} />}

      {editExpense && (
        <EditExpenseModal
          expense={editExpense}
          open={!!editExpense}
          onOpenChange={(open) => !open && setEditExpense(null)}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar despesa?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é irreversível. A despesa será permanentemente removida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteId) { deleteExpense.mutate(deleteId); setDeleteId(null); } }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BalanceDetail({
  dateRange, received, receivedTotal,
}: { dateRange?: DateRange; received: PaymentWithSale[]; receivedTotal: number }) {
  const { data: expenses = [] } = useExpenses();
  const expensesTotal = useMemo(
    () => expenses.filter((e) => inRange(e.expense_date, dateRange)).reduce((s, e) => s + (Number(e.amount) || 0), 0),
    [expenses, dateRange],
  );
  const balance = receivedTotal - expensesTotal;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-6">
          <p className="text-xs text-muted-foreground">Recebido</p>
          <p className="text-xl font-bold text-emerald-600">{formatCurrency(receivedTotal)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <p className="text-xs text-muted-foreground">Despesas</p>
          <p className="text-xl font-bold text-destructive">{formatCurrency(expensesTotal)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <p className="text-xs text-muted-foreground">Saldo</p>
          <p className={cn("text-xl font-bold", balance >= 0 ? "text-emerald-600" : "text-destructive")}>
            {formatCurrency(balance)}
          </p>
        </CardContent></Card>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Recebidos</h3>
        <PaymentsDetailTable payments={received} />
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Despesas</h3>
        <ExpensesDetailTable dateRange={dateRange} />
      </div>
    </div>
  );
}

export function FinanceCardDetail({ type, dateRange, payments, allPayments, dueSoonPayments, commissionFilters, onBack }: FinanceCardDetailProps) {
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);

  const received = useMemo(() => payments.filter((p) => p.status === "paid"), [payments]);
  // Pending/overdue always show the full history (ignore the period filter) —
  // they represent the outstanding balance, not a period metric.
  const pending = useMemo(
    () => allPayments.filter((p) => p.status === "pending" && !isPlanPayment(p)),
    [allPayments],
  );
  const overdue = useMemo(() => {
    const cutoff = startOfDay(new Date());
    return allPayments.filter(
      (p) => p.status === "pending" && !isPlanPayment(p) && parseISO(p.payment_date) < cutoff,
    );
  }, [allPayments]);
  const receivedTotal = useMemo(() => received.reduce((s, p) => s + p.amount, 0), [received]);

  // Recurring renewals in the period (for the "Total Faturado" detail) — paid
  // recurring payments whose month differs from the sale's creation month.
  const renewals = useMemo<RenewalRow[]>(
    () => payments
      .filter((p) => p.status === "paid" && p.sale?.has_recurring && p.sale?.sale_date
        && !isSameMonth(parseISO(p.payment_date), parseISO(p.sale.sale_date as string)))
      .map((p) => ({
        id: p.id,
        date: p.payment_date,
        label: p.client_name || p.lead_name || p.sale?.code || "Renovação",
        amount: Number(p.sale?.recurring_value) || Number(p.sale?.total_value) || p.amount,
      })),
    [payments],
  );

  const { organization: orgForTitle } = useAuth();
  const orgIsTelecom = orgForTitle?.niche === "telecom";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        <h2 className="text-lg font-semibold">
          {/* Same override as the card that opened this. */}
          {type === "faturado" && orgIsTelecom ? "Total de Comissão" : TITLES[type]}
        </h2>

        {type === "expenses" && (
          <Button size="sm" className="ml-auto gap-1.5" onClick={() => setAddExpenseOpen(true)}>
            <Plus className="h-4 w-4" /> Nova Despesa
          </Button>
        )}
      </div>

      {type === "expenses" && <AddExpenseModal open={addExpenseOpen} onOpenChange={setAddExpenseOpen} />}

      {type === "faturado" && (
        <SalesDetailTable dateRange={dateRange} renewals={renewals} commissionFilters={commissionFilters}
          telecomStatuses={orgIsTelecom ? TELECOM_EARNED_STATUSES : undefined}
          dateBasis={orgIsTelecom ? 'activation' : 'sale'} />
      )}
      {type === "porInstalar" && (
        <SalesDetailTable
          dateRange={dateRange}
          commissionFilters={commissionFilters}
          scheduledInstallationOnly
        />
      )}
      {type === "instalado" && (
        <SalesDetailTable
          dateRange={dateRange}
          commissionFilters={commissionFilters}
          telecomStatuses={TELECOM_EARNED_STATUSES}
          dateBasis="activation"
        />
      )}
      {type === "received" && <PaymentsDetailTable payments={received} />}
      {type === "pending" && <PaymentsDetailTable payments={pending} allowMarkPaid />}
      {type === "overdue" && <PaymentsDetailTable payments={overdue} allowMarkPaid />}
      {type === "dueSoon" && <PaymentsDetailTable payments={dueSoonPayments} />}
      {type === "expenses" && <ExpensesDetailTable dateRange={dateRange} />}
      {type === "organizationValue" && orgIsTelecom && <OrganizationValueDetail dateRange={dateRange} commissionFilters={commissionFilters} />}
      {type === "myCommissions" && <MinhasComissoesContent dateRange={dateRange} />}
      {type === "commissions" && <TeamCommissionsTab financeOptions={orgIsTelecom ? { dateRange, commissionFilters } : undefined} />}
      {type === "balance" && (
        <BalanceDetail dateRange={dateRange} received={received} receivedTotal={receivedTotal} />
      )}
    </div>
  );
}
