import { format } from "date-fns";
import { Package, MapPin, CreditCard, Truck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Order,
  OrderStatus,
  PaymentStatus,
  FulfillmentStatus,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  FULFILLMENT_STATUS_LABELS,
} from "@/types/ecommerce";
import { useUpdateOrderStatus } from "@/hooks/ecommerce";
import { formatCurrency } from "@/lib/format";
import { useLanguage, dateLocale } from "@/i18n";

interface OrderDetailsModalProps {
  order: Order;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OrderDetailsModal({ order, open, onOpenChange }: OrderDetailsModalProps) {
  const updateStatus = useUpdateOrderStatus();
  const { t } = useLanguage();

  const handleStatusChange = (status: OrderStatus) => {
    updateStatus.mutate({ orderId: order.id, status });
  };

  const handlePaymentChange = (paymentStatus: PaymentStatus) => {
    updateStatus.mutate({ orderId: order.id, paymentStatus });
  };

  const handleFulfillmentChange = (fulfillmentStatus: FulfillmentStatus) => {
    updateStatus.mutate({ orderId: order.id, fulfillmentStatus });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("Pedido {{number}}", { number: order.order_number })}
            <Badge variant="secondary">
              {format(new Date(order.created_at), "d MMM yyyy HH:mm", { locale: dateLocale() })}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Status Section */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="text-sm font-medium text-muted-foreground">{t("Estado")}</label>
              <Select
                value={order.status}
                onValueChange={(value) => handleStatusChange(value as OrderStatus)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {t(label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">{t("Pagamento")}</label>
              <Select
                value={order.payment_status}
                onValueChange={(value) => handlePaymentChange(value as PaymentStatus)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {t(label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">{t("Expedição")}</label>
              <Select
                value={order.fulfillment_status}
                onValueChange={(value) => handleFulfillmentChange(value as FulfillmentStatus)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FULFILLMENT_STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {t(label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Customer Info */}
          {order.customer && (
            <div className="rounded-lg border p-4">
              <h4 className="mb-2 font-medium flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                {t("Cliente")}
              </h4>
              <p className="font-medium">{order.customer.name}</p>
              <p className="text-sm text-muted-foreground">{order.customer.email}</p>
              {order.customer.phone && (
                <p className="text-sm text-muted-foreground">{order.customer.phone}</p>
              )}
            </div>
          )}

          {/* Addresses */}
          <div className="grid gap-4 sm:grid-cols-2">
            {order.shipping_address && (
              <div className="rounded-lg border p-4">
                <h4 className="mb-2 font-medium flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  {t("Morada de Envio")}
                </h4>
                <div className="text-sm">
                  <p className="font-medium">{order.shipping_address.name}</p>
                  <p>{order.shipping_address.address_line1}</p>
                  {order.shipping_address.address_line2 && (
                    <p>{order.shipping_address.address_line2}</p>
                  )}
                  <p>
                    {order.shipping_address.postal_code} {order.shipping_address.city}
                  </p>
                  <p>{order.shipping_address.country}</p>
                  {order.shipping_address.phone && (
                    <p className="mt-1 text-muted-foreground">{order.shipping_address.phone}</p>
                  )}
                </div>
              </div>
            )}

            {order.billing_address && (
              <div className="rounded-lg border p-4">
                <h4 className="mb-2 font-medium flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  {t("Morada de Faturação")}
                </h4>
                <div className="text-sm">
                  <p className="font-medium">{order.billing_address.name}</p>
                  <p>{order.billing_address.address_line1}</p>
                  {order.billing_address.address_line2 && (
                    <p>{order.billing_address.address_line2}</p>
                  )}
                  <p>
                    {order.billing_address.postal_code} {order.billing_address.city}
                  </p>
                  <p>{order.billing_address.country}</p>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Order Items */}
          <div>
            <h4 className="mb-3 font-medium flex items-center gap-2">
              <Package className="h-4 w-4" />
              {t("Itens do Pedido")}
            </h4>
            <div className="rounded-lg border">
              <div className="divide-y">
                {order.items?.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-4">
                    <div>
                      <p className="font-medium">{item.product_name}</p>
                      {item.variant_name && (
                        <p className="text-sm text-muted-foreground">{item.variant_name}</p>
                      )}
                      {item.sku && (
                        <code className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-xs">
                          {item.sku}
                        </code>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">
                        {item.quantity} x {formatCurrency(item.unit_price)}
                      </p>
                      <p className="font-medium">{formatCurrency(item.total)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Separator />

          {/* Order Summary */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(order.subtotal)}</span>
            </div>
            {order.discount_total > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>{t("Desconto")} {order.discount_code && `(${order.discount_code})`}</span>
                <span>-{formatCurrency(order.discount_total)}</span>
              </div>
            )}
            {order.shipping_total > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("Envio")}</span>
                <span>{formatCurrency(order.shipping_total)}</span>
              </div>
            )}
            {order.tax_total > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("IVA")}</span>
                <span>{formatCurrency(order.tax_total)}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between text-lg font-semibold">
              <span>Total</span>
              <span>{formatCurrency(order.total)}</span>
            </div>
          </div>

          {/* Notes */}
          {(order.notes || order.internal_notes) && (
            <>
              <Separator />
              <div className="space-y-4">
                {order.notes && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground">{t("Notas do Cliente")}</h4>
                    <p className="mt-1 text-sm">{order.notes}</p>
                  </div>
                )}
                {order.internal_notes && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground">{t("Notas Internas")}</h4>
                    <p className="mt-1 text-sm">{order.internal_notes}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Fechar")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
