import { useMemo } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, MapPin } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { Product } from "@/types/proposals";
import { roundCurrency, splitLineVat } from "@/lib/product-fiscal";

interface ClientFiscalData {
  nif?: string | null;
  address_line1?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

interface SaleFiscalInfoProps {
  client: ClientFiscalData | null | undefined;
  isInvoiceXpressActive: boolean;
}

interface BillingOrganization {
  integrations_enabled?: unknown;
  billing_provider?: string | null;
  invoicexpress_account_name?: string | null;
  tem_invoicexpress_api_key?: boolean | null;
  tem_keyinvoice_password?: boolean | null;
  tem_vendus_api_key?: boolean | null;
  tax_config?: unknown;
}

/**
 * Mini-card showing client fiscal data (NIF + address) and warning if NIF is missing.
 * Only renders when InvoiceXpress is active.
 */
export function ClientFiscalCard({ client, isInvoiceXpressActive }: SaleFiscalInfoProps) {
  if (!isInvoiceXpressActive || !client) return null;

  const hasNif = !!client.nif;
  const hasAddress = !!(client.address_line1 || client.city || client.postal_code);

  return (
    <div className="space-y-2">
      {/* NIF missing warning */}
      {!hasNif && (
        <Alert className="border-amber-500/50 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <AlertDescription className="text-sm text-amber-600 dark:text-amber-400">
            Este cliente não tem NIF. Não será possível emitir faturas.
          </AlertDescription>
        </Alert>
      )}

      {/* Fiscal data mini-card */}
      <div className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30 border text-sm">
        <div className="flex items-center gap-1.5">
          {hasNif ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          )}
          <span className="text-muted-foreground">NIF:</span>
          <span className={hasNif ? "font-mono font-medium" : "text-muted-foreground italic"}>
            {client.nif || "Não definido"}
          </span>
        </div>
        {hasAddress && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {[client.postal_code, client.city].filter(Boolean).join(" ")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Returns the IVA badge label for a given tax rate.
 */
export function getVatLabel(taxValue: number | null | undefined): string {
  if (taxValue === null || taxValue === undefined) return "";
  if (taxValue === 0) return "Isento";
  return `IVA ${taxValue}%`;
}

/**
 * Badge component showing VAT rate for a product item.
 */
export function VatBadge({ taxValue }: { taxValue: number | null | undefined }) {
  const label = getVatLabel(taxValue);
  if (!label) return null;

  return (
    <Badge
      variant="outline"
      className={
        taxValue === 0
          ? "text-xs bg-muted text-muted-foreground"
          : "text-xs bg-blue-500/10 text-blue-500 border-blue-500/30"
      }
    >
      {label}
    </Badge>
  );
}

interface VatTotalsProps {
  items: Array<{
    product_id: string | null;
    quantity: number;
    unit_price: number;
  }>;
  products: Product[] | undefined;
  orgTaxValue: number | undefined;
  discount: number;
  subtotal: number;
}

/**
 * Calculates and returns IVA totals for display.
 */
export function useVatCalculation({ items, products, orgTaxValue, discount, subtotal }: VatTotalsProps) {
  return useMemo(() => {
    const defaultTax = orgTaxValue ?? 23;
    const itemTaxRates: Map<string, number> = new Map();
    const lines = items.map((item) => {
      const product = item.product_id ? products?.find(p => p.id === item.product_id) : undefined;
      const split = splitLineVat(
        item.quantity * item.unit_price,
        product,
        { tax_value: defaultTax },
      );
      if (item.product_id) {
        itemTaxRates.set(item.product_id, split.taxRate);
      }
      return split;
    });

    const subtotalWithoutVat = lines.reduce((sum, line) => sum + line.net, 0);
    const discountRatio = subtotalWithoutVat > 0
      ? Math.min(1, Math.max(0, discount / subtotalWithoutVat))
      : 0;
    const totalWithoutVat = subtotalWithoutVat * (1 - discountRatio);
    const totalVat = lines.reduce((sum, line) => sum + line.vat, 0) * (1 - discountRatio);
    const totalWithVat = lines.reduce((sum, line) => sum + line.gross, 0) * (1 - discountRatio);

    return {
      subtotalWithoutVat: roundCurrency(subtotalWithoutVat),
      totalWithoutVat: roundCurrency(totalWithoutVat),
      totalVat: roundCurrency(totalVat),
      totalWithVat: roundCurrency(totalWithVat),
      getItemTaxRate: (productId: string | null): number | null => {
        if (!productId) return defaultTax;
        return itemTaxRates.get(productId) ?? defaultTax;
      },
      defaultTax,
    };
  }, [items, products, orgTaxValue, discount, subtotal]);
}

/**
 * Helper to check if any billing integration is active for the organization.
 */
export function isInvoiceXpressActive(organization: BillingOrganization | null | undefined): boolean {
  const enabled = organization?.integrations_enabled as Record<string, boolean> | null;
  const provider = organization?.billing_provider || 'invoicexpress';

  if (provider === 'vendus') {
    return enabled?.vendus === true && organization?.tem_vendus_api_key === true;
  }
  if (provider === 'keyinvoice') {
    return enabled?.keyinvoice === true && organization?.tem_keyinvoice_password === true;
  }
  
  // Check if InvoiceXpress is enabled and has credentials
  if (enabled?.invoicexpress !== false && organization?.invoicexpress_account_name && organization?.tem_invoicexpress_api_key) {
    return true;
  }
  
  return false;
}

/**
 * Alias for backward compatibility - checks if any billing provider is active.
 */
export const isBillingActive = isInvoiceXpressActive;

/**
 * Get the org tax value from tax_config.
 */
export function getOrgTaxValue(organization: BillingOrganization | null | undefined): number | undefined {
  const taxConfig = organization?.tax_config as { tax_value?: number } | null;
  return taxConfig?.tax_value ?? undefined;
}
