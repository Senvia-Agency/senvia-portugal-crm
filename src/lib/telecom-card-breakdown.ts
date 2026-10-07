import {
  cardConfigFor,
  getExtraCardCommission,
  usesQuantityTiers,
  type CatalogProduct,
  type CommissionSplit,
  type ExtraCards,
  type QuantityTier,
} from '@/types/proposals';

type SaleCardDetails = {
  readonly total_cards?: unknown;
  readonly extra_cards_portability?: unknown;
  readonly extra_cards_new?: unknown;
  readonly quantidade?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function saleCardDetails(value: unknown): SaleCardDetails | null {
  if (!isRecord(value)) return null;
  return {
    total_cards: value.total_cards,
    extra_cards_portability: value.extra_cards_portability,
    extra_cards_new: value.extra_cards_new,
    quantidade: value.quantidade,
  };
}

function matchingSplit(
  splits: readonly CommissionSplit[] | undefined,
  sellerUserId: string | null,
  sellerProfileId: string | null,
): CommissionSplit | undefined {
  if (!splits) return undefined;
  const userSplit = sellerUserId
    ? splits.find((split) => split.kind === 'user' && split.user_id === sellerUserId)
    : undefined;
  if (userSplit) return userSplit;
  return sellerProfileId
    ? splits.find((split) => split.kind === 'profile' && split.profile_id === sellerProfileId)
    : undefined;
}

function splitForSale(product: CatalogProduct, quantity: number): CommissionSplit[] | undefined {
  if (!usesQuantityTiers(product)) return product.splits;
  const tier = product.quantity_tiers?.find((item: QuantityTier) =>
    quantity >= item.min && (item.max === null || quantity <= item.max),
  );
  return tier?.splits ?? product.splits;
}

function saleHasCardOptOut(
  product: CatalogProduct,
  quantity: number,
  sellerUserId: string | null,
  sellerProfileId: string | null,
): boolean {
  return matchingSplit(splitForSale(product, quantity), sellerUserId, sellerProfileId)?.extra_cards === false;
}

export function extraCardPayoutFromSale(
  productNames: readonly string[] | null,
  rawDetails: unknown,
  rawSaleTotalCards: unknown,
  catalog: readonly CatalogProduct[],
  sellerUserId: string | null,
  sellerProfileId: string | null,
): number | null {
  if (!productNames) return null;
  const details = isRecord(rawDetails) ? rawDetails : null;
  const saleTotalCards = asNumber(rawSaleTotalCards);
  const catalogByName = new Map(catalog.map((product) => [product.name, product]));
  let total = 0;

  for (const productName of productNames) {
    const product = catalogByName.get(productName);
    const detail = saleCardDetails(details?.[productName]);
    if (!product) {
      if (detail?.total_cards != null || detail?.extra_cards_portability != null || detail?.extra_cards_new != null || saleTotalCards !== undefined) return null;
      continue;
    }

    const totalCards = asNumber(detail?.total_cards);
    const legacyPortability = asNumber(detail?.extra_cards_portability);
    const legacyNew = asNumber(detail?.extra_cards_new);
    const lineQuantity = Math.max(0.5, asNumber(detail?.quantidade) ?? 1);
    const quantity = Math.max(1, Math.round(lineQuantity));
    const hasLegacyCount = legacyPortability !== undefined || legacyNew !== undefined;
    const cardConfig = cardConfigFor(product, quantity);
    const hasCardRate = !!cardConfig.extra_card_commission;
    const optedOut = saleHasCardOptOut(product, quantity, sellerUserId, sellerProfileId);
    let extraCards: ExtraCards;

    if (totalCards !== undefined) {
      extraCards = { total: totalCards };
    } else if (hasLegacyCount) {
      extraCards = { portabilidade: legacyPortability, novos: legacyNew };
    } else if (optedOut || !hasCardRate) {
      continue;
    } else if (productNames.length === 1 && saleTotalCards !== undefined) {
      const included = cardConfig.included_cards ?? 1;
      const extras = Math.max(0, saleTotalCards - included * lineQuantity);
      extraCards = { portabilidade: extras };
    } else {
      return null;
    }

    const cardAmount = optedOut ? 0 : getExtraCardCommission(product, extraCards, quantity);
    total += cardAmount;
  }

  return Math.round(total * 100) / 100;
}
