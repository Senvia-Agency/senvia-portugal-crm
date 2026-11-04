import {
  BILLING_PROVIDER_LABELS,
  BILLING_STATUS_LABELS,
  SERVICE_STATUS_LABELS,
  type SaleProductReference,
} from "@/types/sales";
import {
  parseBillingProviderFilter,
  parseBillingStatusFilter,
  parseServiceStatusFilter,
  type RecurringSalesFilters as RecurringSalesFilterState,
} from "./recurring-sales-filter-logic";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/i18n";

export interface RecurringSalesFiltersProps {
  readonly filters: RecurringSalesFilterState;
  readonly products: readonly SaleProductReference[];
  readonly onChange: (filters: RecurringSalesFilterState) => void;
}

export function RecurringSalesFilters({ filters, products, onChange }: RecurringSalesFiltersProps) {
  const { t } = useLanguage();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("Filtros de vendas recorrentes")}>
      <Select
        value={filters.serviceStatus}
        onValueChange={(value) => onChange({ ...filters, serviceStatus: parseServiceStatusFilter(value) })}
      >
        <SelectTrigger className="bg-card/50 border-border/50">
          <SelectValue placeholder={t("Estado do serviço")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("Todos os serviços")}</SelectItem>
          {Object.entries(SERVICE_STATUS_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.billingStatus}
        onValueChange={(value) => onChange({ ...filters, billingStatus: parseBillingStatusFilter(value) })}
      >
        <SelectTrigger className="bg-card/50 border-border/50">
          <SelectValue placeholder={t("Estado da cobrança")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("Todas as cobranças")}</SelectItem>
          {Object.entries(BILLING_STATUS_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.billingProvider}
        onValueChange={(value) => onChange({ ...filters, billingProvider: parseBillingProviderFilter(value) })}
      >
        <SelectTrigger className="bg-card/50 border-border/50">
          <SelectValue placeholder={t("Provedor de cobrança")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("Todos os provedores")}</SelectItem>
          {Object.entries(BILLING_PROVIDER_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.productId}
        onValueChange={(value) => onChange({ ...filters, productId: value })}
      >
        <SelectTrigger className="bg-card/50 border-border/50">
          <SelectValue placeholder={t("Produto recorrente")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("Todos os produtos")}</SelectItem>
          {products.map((product) => (
            <SelectItem key={product.id} value={product.id}>
              {product.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
