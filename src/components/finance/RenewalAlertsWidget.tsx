import { format, differenceInDays, isPast, isToday } from "date-fns";
import { pt } from "date-fns/locale";
import { RefreshCw, AlertTriangle, CheckCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency } from "@/lib/format";
import { useRecurringSales } from "@/hooks/useRecurringSales";
import { formatOperationalUnits, sumOperationalSaleUnits } from "@/lib/sale-units";

export function RenewalAlertsWidget() {
  const { data: recurringSales = [], isLoading } = useRecurringSales();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Próximas recorrências
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
            Renovações
          </CardTitle>
          <CardDescription>Sem renovações pendentes</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            Todas as vendas recorrentes estão em dia.
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
            Próximas recorrências
            <Badge variant="secondary" className="ml-auto">
              {formatOperationalUnits(sumOperationalSaleUnits(recurringSales))}
            </Badge>
          </CardTitle>
          <CardDescription>Vendas com cobrança recorrente próxima ou vencida</CardDescription>
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
                            {sale.client?.name || 'Cliente'}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Venda {sale.code} • {formatCurrency(sale.recurring_value)}/mês
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
                          ? `Vencida há ${Math.abs(daysUntil)} dias`
                          : isDueToday
                            ? 'Vence hoje'
                            : `Em ${daysUntil} dias`
                        }
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

    </>
  );
}
