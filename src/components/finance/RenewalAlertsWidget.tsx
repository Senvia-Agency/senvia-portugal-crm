import { useState } from "react";
import { format, differenceInDays, isPast, isToday, parseISO } from "date-fns";
import { RefreshCw, AlertTriangle, CheckCircle, CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency } from "@/lib/format";
import { useMarkRecurrencePaid, useRecurringSales } from "@/hooks/useRecurringSales";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/types/sales";
import { formatOperationalUnits, sumOperationalSaleUnits } from "@/lib/sale-units";
import { dateLocale, useLanguage } from "@/i18n";

type RecurringSale = NonNullable<ReturnType<typeof useRecurringSales>["data"]>[number];

export function RenewalAlertsWidget() {
  const { t } = useLanguage();
  const { data: recurringSales = [], isLoading } = useRecurringSales();
  const markPaid = useMarkRecurrencePaid();
  const today = format(new Date(), "yyyy-MM-dd");
  const [paying, setPaying] = useState<RecurringSale | null>(null);
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>("transfer");
  const monthLabel = (date: string) => format(parseISO(date), "MMMM yyyy", { locale: dateLocale() });

  const openPay = (sale: RecurringSale) => { setPaidOn(today); setMethod("transfer"); setPaying(sale); };
  const confirmPay = () => {
    if (!paying || !paidOn) return;
    markPaid.mutate(
      { recurrenceId: paying.recurrence_id, saleId: paying.id, periodStart: paying.next_renewal_date, paymentDate: paidOn, paymentMethod: method },
      {
        onSuccess: () => {
          toast.success(t("Mensalidade de {{month}} marcada como paga", { month: monthLabel(paying.next_renewal_date) }));
          setPaying(null);
        },
        onError: (error) => {
          toast.error((error as Error).message === "already_paid"
            ? t("Esta mensalidade já estava paga.")
            : t("Não foi possível marcar como paga. Tente novamente."));
        },
      },
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            {t("Próximas recorrências")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (recurringSales.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            {t("Renovações")}
          </CardTitle>
          <CardDescription>{t("Sem renovações pendentes")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("Todas as vendas recorrentes estão em dia.")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {t("Próximas recorrências")}
            <Badge variant="secondary" className="ml-auto">
              {formatOperationalUnits(sumOperationalSaleUnits(recurringSales))}
            </Badge>
          </CardTitle>
          <CardDescription>{t("Vendas com cobrança recorrente próxima ou vencida")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-1 p-4 pt-0">
              {recurringSales.map((sale) => {
                const daysUntil = differenceInDays(new Date(sale.next_renewal_date), new Date());
                const isOverdue = isPast(new Date(sale.next_renewal_date)) && !isToday(new Date(sale.next_renewal_date));
                const isDueToday = isToday(new Date(sale.next_renewal_date));
                return (
                  <div
                    key={sale.id}
                    className={`p-3 rounded-lg border ${
                      isOverdue ? 'bg-red-500/5 border-red-500/20' :
                      isDueToday ? 'bg-amber-500/5 border-amber-500/20' :
                      'bg-muted/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {isOverdue ? (
                            <AlertTriangle className="h-3 w-3 text-red-500 flex-shrink-0" />
                          ) : isDueToday ? (
                            <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                          ) : (
                            <RefreshCw className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          )}
                          <span className="font-medium text-sm truncate">
                            {sale.client?.name || t('Cliente')}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t("Venda {{code}} • {{value}}/mês", { code: sale.code, value: formatCurrency(sale.recurring_value) })}
                        </p>
                      </div>
                      <Badge 
                        variant="outline" 
                        className={`text-xs whitespace-nowrap ${
                          isOverdue ? 'bg-red-500/10 text-red-500 border-red-500/30' :
                          isDueToday ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' :
                          ''
                        }`}
                      >
                        {isOverdue 
                          ? t('Vencida há {{n}} dias', { n: Math.abs(daysUntil) })
                          : isDueToday
                            ? t('Vence hoje')
                            : t('Em {{n}} dias', { n: daysUntil })
                        }
                      </Badge>
                    </div>
                    {sale.billing_provider === "manual" ? (
                      <div className="flex justify-end">
                        <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => openPay(sale)}
                          aria-label={t("Marcar como paga a mensalidade de {{name}}", { name: sale.client?.name || t('Cliente') })}>
                          <CheckCircle className="mr-1.5 h-3.5 w-3.5" />{t("Marcar pago")}
                        </Button>
                      </div>
                    ) : (
                      <p className="flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
                        <CreditCard className="h-3 w-3" />{t("Cobrada pelo Stripe: o pagamento entra sozinho.")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={!!paying} onOpenChange={(open) => { if (!open && !markPaid.isPending) setPaying(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Marcar mensalidade como paga")}</DialogTitle>
            <DialogDescription>{t("Fica paga já, mesmo antes da data. A próxima mensalidade passa para o mês seguinte.")}</DialogDescription>
          </DialogHeader>
          {paying && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-3 text-sm">
                <div><p className="text-xs text-muted-foreground">{t("Cliente")}</p><p className="font-medium">{paying.client?.name || t('Cliente')}</p></div>
                <div><p className="text-xs text-muted-foreground">{t("Venda")}</p><p className="font-medium">#{paying.code}</p></div>
                <div><p className="text-xs text-muted-foreground">{t("Mensalidade")}</p><p className="font-medium capitalize">{monthLabel(paying.next_renewal_date)}</p></div>
                <div><p className="text-xs text-muted-foreground">{t("Valor")}</p><p className="font-semibold tabular-nums">{formatCurrency(paying.recurring_value)}</p></div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="renewal-paid-on">{t("Data de recebimento")}</label>
                <Input id="renewal-paid-on" type="date" value={paidOn} max={today} onChange={(event) => setPaidOn(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="renewal-method">{t("Método de pagamento")}</label>
                <Select value={method} onValueChange={(value) => setMethod(value as PaymentMethod)}>
                  <SelectTrigger id="renewal-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{t(PAYMENT_METHOD_LABELS[m])}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setPaying(null)} disabled={markPaid.isPending}>{t("Cancelar")}</Button>
            <Button type="button" onClick={confirmPay} disabled={markPaid.isPending || !paidOn || paidOn > today}>
              {markPaid.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              {t("Confirmar recebimento")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
