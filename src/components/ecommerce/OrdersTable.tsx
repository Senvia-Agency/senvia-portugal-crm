import { useState } from "react";
import { format } from "date-fns";
import { ShoppingCart, Eye, Truck } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOrders, useUpdateOrderStatus } from "@/hooks/ecommerce";
import { formatCurrency } from "@/lib/format";
import {
  Order,
  OrderStatus,
  PaymentStatus,
  FulfillmentStatus,
  ORDER_STATUS_LABELS,
} from "@/types/ecommerce";
import { OrderDetailsModal } from "./OrderDetailsModal";
import { StatusBadge } from "@/components/ui/status-badge";
import { orderStatusBadge, ecomPaymentStatusBadge, fulfillmentStatusBadge } from "@/lib/status-badge-maps";
import { useLanguage, dateLocale } from "@/i18n";

export function OrdersTable() {
  const { data: orders, isLoading } = useOrders();
  const updateStatus = useUpdateOrderStatus();
  const { t } = useLanguage();
  
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredOrders = orders?.filter((order) => {
    if (statusFilter === "all") return true;
    return order.status === statusFilter;
  });

  const handleStatusChange = (orderId: string, status: OrderStatus) => {
    updateStatus.mutate({ orderId, status });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <p className="text-sm text-muted-foreground">
            {t((filteredOrders?.length || 0) === 1 ? "{{n}} pedido" : "{{n}} pedidos", { n: filteredOrders?.length || 0 })}
          </p>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("Filtrar por estado")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Todos")}</SelectItem>
              {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {t(label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {filteredOrders?.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed p-8">
          <ShoppingCart className="h-10 w-10 text-muted-foreground" />
          <h3 className="mt-4 font-semibold">{t("Sem pedidos")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("Os pedidos aparecerão aqui quando os clientes comprarem.")}
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Pedido")}</TableHead>
                <TableHead>{t("Data")}</TableHead>
                <TableHead>{t("Cliente")}</TableHead>
                <TableHead>{t("Estado")}</TableHead>
                <TableHead>{t("Pagamento")}</TableHead>
                <TableHead>{t("Expedição")}</TableHead>
                <TableHead className="text-right">{t("Total")}</TableHead>
                <TableHead className="text-right">{t("Ações")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders?.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">
                      {order.order_number}
                    </code>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(order.created_at), "d MMM yyyy", { locale: dateLocale() })}
                  </TableCell>
                  <TableCell>
                    {order.customer?.name || (
                      <span className="text-muted-foreground">{t("Cliente anónimo")}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={order.status}
                      onValueChange={(value) => handleStatusChange(order.id, value as OrderStatus)}
                    >
                      <SelectTrigger className="h-7 w-[140px] border-0 p-0">
                        <StatusBadge {...orderStatusBadge(order.status as OrderStatus)} />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {t(label)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <StatusBadge {...ecomPaymentStatusBadge(order.payment_status as PaymentStatus)} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge {...fulfillmentStatusBadge(order.fulfillment_status as FulfillmentStatus)} icon={Truck} />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(order.total)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelectedOrder(order)}
                      title={t("Ver detalhes")}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Order Details Modal */}
      {selectedOrder && (
        <OrderDetailsModal
          order={selectedOrder}
          open={!!selectedOrder}
          onOpenChange={(open) => !open && setSelectedOrder(null)}
        />
      )}
    </div>
  );
}
