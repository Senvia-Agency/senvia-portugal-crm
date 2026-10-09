import { useMemo } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useOperators } from '@/hooks/useOperators';
import {
  SERVICOS_PRODUCTS,
  SERVICOS_PRODUCT_CONFIGS,
  type ServicosProductConfig,
  type CatalogProduct,
  type CommissionSplit,
  type QuantityTier,
  type TelecomTechnology,
} from '@/types/proposals';

interface LegacyConfigFromDB {
  name: string;
  fields: string[];
}

interface CatalogConfigFromDB {
  name: string;
  price: number;
  has_commission: boolean;
  commission_pct: number;
  commission_type?: 'pct' | 'fixed';
  commission_fixed?: number;
  splits?: CommissionSplit[];
  operator_id?: string;
  quantity_tiers?: QuantityTier[];
  extra_card_commission?: number;
  extra_card_operator_pays?: number;
  included_cards?: number;
  operator_pays?: number;
  operator_pays_fibra?: number;
  operator_pays_satelite?: number;

  technologies?: TelecomTechnology[];
  type_ids?: string[];
  tiered_commission?: boolean;
  tier_basis?: CatalogProduct['tier_basis'];
  tier_scope?: CatalogProduct['tier_scope'];
}

function isCatalogFormat(item: any): item is CatalogConfigFromDB {
  return item && typeof item.price === 'number' && typeof item.has_commission === 'boolean';
}

/**
 * Returns the list of servicos products and their configs.
 * Detects format:
 * - NULL → fallback to hardcoded (Perfect2Gether)
 * - Legacy format [{name, fields}] → map to ServicosProductConfig
 * - New catalog format [{name, price, has_commission, commission_pct}] → CatalogProduct[]
 */
export function useServicosProducts() {
  const { data: org } = useOrganization();
  const { data: operators = [] } = useOperators();

  return useMemo(() => {
    const config = (org as any)?.servicos_products_config as any[] | null;

    if (!config || !Array.isArray(config) || config.length === 0) {
      return {
        products: SERVICOS_PRODUCTS,
        configs: SERVICOS_PRODUCT_CONFIGS,
        catalog: null as CatalogProduct[] | null,
        isNewFormat: false,
        operators,
      };
    }

    // Detect format by checking first item
    if (isCatalogFormat(config[0])) {
      // New catalog format
      const catalog: CatalogProduct[] = config.map((c) => ({
        name: c.name,
        price: c.price ?? 0,
        has_commission: c.has_commission ?? false,
        commission_pct: c.commission_pct ?? 0,
        commission_type: c.commission_type ?? 'pct',
        commission_fixed: c.commission_fixed ?? 0,
        splits: c.splits,
        operator_id: c.operator_id,
        quantity_tiers: c.quantity_tiers,
        extra_card_commission: c.extra_card_commission,
        extra_card_operator_pays: c.extra_card_operator_pays,
        included_cards: c.included_cards,
        operator_pays: c.operator_pays,
        operator_pays_fibra: c.operator_pays_fibra,
        operator_pays_satelite: c.operator_pays_satelite,

        technologies: c.technologies,
        type_ids: c.type_ids,
        tiered_commission: c.tiered_commission,
        tier_basis: c.tier_basis,
        tier_scope: c.tier_scope,
      }));
      return {
        products: catalog.map((c) => c.name),
        configs: [] as ServicosProductConfig[], // Not used in new format
        catalog,
        isNewFormat: true,
        operators,
      };
    }

    // Legacy format with fields
    const products = config.map((c: LegacyConfigFromDB) => c.name);
    const configs: ServicosProductConfig[] = config.map((c: LegacyConfigFromDB) => ({
      name: c.name,
      fields: c.fields as ServicosProductConfig['fields'],
    }));

    return {
      products,
      configs,
      catalog: null as CatalogProduct[] | null,
      isNewFormat: false,
      operators,
    };
  }, [org, operators]);
}
