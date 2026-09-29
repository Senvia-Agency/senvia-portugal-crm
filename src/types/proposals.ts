import { commissionUnits } from '@/lib/sale-units';

// Proposal Types for Senvia OS

export type ProposalStatus = 'draft' | 'sent' | 'negotiating' | 'accepted' | 'rejected' | 'expired';
export type ProposalType = 'energia' | 'servicos';
export type ModeloServico = 'transacional' | 'saas';
export type NegotiationType = 'angariacao' | 'angariacao_indexado' | 'renovacao' | 'sem_volume';

export interface Product {
  id: string;
  organization_id: string;
  code?: string | null;
  name: string;
  description?: string | null;
  price: number | null;
  is_active: boolean;
  is_recurring: boolean;
  tax_value?: number | null;
  tax_exemption_reason?: string | null;
  /** True when `price` is already the final VAT-inclusive customer price. */
  price_includes_vat?: boolean;
  /** Withholding percentage preserved in the fiscal snapshot. */
  retention_rate?: number;
  /** Exact KeyInvoice product identity, resolved by the fiscal worker. */
  keyinvoice_product_id?: string | null;
  invoicexpress_id?: number | null;
  /** Commission earned per unit sold (telecom / fixed-commission products). */
  commission_value?: number | null;
  /** Commission per unit on renewal. Falls back to commission_value × 0.25. */
  commission_renewal_value?: number | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceImage {
  id: string;
  product_id: string;
  organization_id: string;
  url: string;
  alt_text?: string | null;
  position: number;
  is_primary: boolean;
  created_at: string;
}

export interface Proposal {
  id: string;
  organization_id: string;
  code?: string | null;
  client_id?: string | null;
  lead_id?: string | null; // Mantido para retrocompatibilidade
  total_value: number;
  status: ProposalStatus;
  notes?: string | null;
  proposal_date: string;
  accepted_at?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  
  // Campos por tipo de proposta
  proposal_type?: ProposalType | null;
  negotiation_type?: NegotiationType | null;
  
  // Campos Energia (legacy - agora por CPE)
  consumo_anual?: number | null;
  margem?: number | null;
  dbl?: number | null;
  anos_contrato?: number | null;
  
  // Campos Serviços
  modelo_servico?: ModeloServico | null;
  kwp?: number | null;
  servicos_produtos?: string[] | null; // Fixed products checkboxes
  servicos_details?: ServicosDetails | null; // Per-product details JSONB
  
  // Comum
  comissao?: number | null;
  // Whether the required paperwork for THIS proposal has been handed in.
  documents_checked?: boolean | null;
  contract_signed?: boolean | null;

  products?: ProposalProduct[];
  client?: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
  };
  lead?: {
    id: string;
    name: string;
    email: string;
    phone: string;
  };
}

export interface ProposalProduct {
  id: string;
  proposal_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  total: number;
  created_at: string;
  product?: Product;
}

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: 'Rascunho',
  sent: 'Enviada',
  negotiating: 'Em Negociação',
  accepted: 'Aceite',
  rejected: 'Recusada',
  expired: 'Expirada',
};

export const PROPOSAL_STATUS_COLORS: Record<ProposalStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-blue-500/20 text-blue-500',
  negotiating: 'bg-amber-500/20 text-amber-500',
  accepted: 'bg-green-500/20 text-green-500',
  rejected: 'bg-red-500/20 text-red-500',
  expired: 'bg-gray-500/20 text-gray-500',
};

export const PROPOSAL_STATUSES: ProposalStatus[] = ['draft', 'sent', 'negotiating', 'accepted', 'rejected', 'expired'];

export const PROPOSAL_TYPE_LABELS: Record<ProposalType, string> = {
  energia: 'Energia',
  servicos: 'Outros Serviços',
};

export const MODELO_SERVICO_LABELS: Record<ModeloServico, string> = {
  transacional: 'Transacional',
  saas: 'SAAS',
};

export const NEGOTIATION_TYPE_LABELS: Record<NegotiationType, string> = {
  angariacao: 'Angariação',
  angariacao_indexado: 'Angariação Indexado',
  renovacao: 'Renovação',
  sem_volume: 'Ang sem Volume',
};

export const NEGOTIATION_TYPES: NegotiationType[] = ['angariacao', 'angariacao_indexado', 'renovacao', 'sem_volume'];

// ─── Legacy: Produtos fixos para Outros Serviços (Perfect2Gether) ───
export const SERVICOS_PRODUCTS = [
  'Solar',
  'Baterias',
  'Carregadores',
  'Condensadores',
  'Coberturas',
];

// Detalhes por produto de serviço (legacy format - duracao/valor/kwp/comissao)
export interface ServicosProductDetail {
  duracao?: number;
  valor?: number;
  kwp?: number;
  comissao?: number;
  // New catalog format fields (coexist with legacy)
  name?: string;
  price?: number;
  commission_pct?: number;
  commission_type?: CommissionType;
  commission_fixed?: number;
  // Units sold in this line — only meaningful for a product with quantity_tiers
  // (a telecom operator with commission_basis 'per_sale'/'monthly_volume').
  // Absent/1 for every other product.
  quantidade?: number;
  // Operator this line was sold under, FROZEN when the product was added to
  // the sale. The catalog is live — a product can be moved to another
  // operator later — so reports of "which operators did this client buy
  // from" must read this, not the catalog's current operator_id.
  operator_id?: string;
  operator_name?: string;
  // Which technology this install actually is, frozen when the line was added
  // — the catalog can later stop offering one of them, and the commission
  // already paid must not move. Absent on every sale made before this field
  // existed, which then falls back to the product's single rate.
  tecnologia?: TelecomTechnology;
  // How many SIM cards this whole line carries (e.g. a 2P package with 2
  // included, sold with 5 total = 3 extra). Whatever is over the product's
  // own `included_cards` pays product.extra_card_commission per card — see
  // getExtraCardCommission. The seller enters the real total; the extra
  // count is derived, not typed in directly.
  total_cards?: number;
  // OLD model, superseded by total_cards above — kept only so a sale frozen
  // before this field existed still reads its real extra-card commission.
  // The seller used to type the extras directly, split by whether each one
  // ported an existing number or is a brand-new line (the operator tracked
  // that regardless of it changing the commission).
  extra_cards_portability?: number;
  extra_cards_new?: number;
}

export type ServicosDetails = Record<string, ServicosProductDetail>;

// ─── Legacy config de campos por produto (Perfect2Gether) ───
export interface ServicosProductConfig {
  name: string;
  fields: ('duracao' | 'valor' | 'kwp' | 'comissao')[];
  kwpAuto?: (detail: ServicosProductDetail) => number | null;
}

export const SERVICOS_PRODUCT_CONFIGS: ServicosProductConfig[] = [
  { name: 'Solar', fields: ['duracao', 'kwp', 'comissao'] },
  { name: 'Baterias', fields: ['kwp', 'comissao'] },
  { name: 'Carregadores', fields: ['valor', 'kwp', 'comissao'] },
  { name: 'Condensadores', fields: ['duracao', 'valor', 'kwp', 'comissao'], kwpAuto: (d) => d.valor != null ? d.valor / 1000 : null },
  { name: 'Coberturas', fields: ['valor', 'comissao'] },
];

export const FIELD_LABELS: Record<string, string> = {
  duracao: 'Duração (anos)',
  valor: 'Valor (€)',
  kwp: 'kWp',
  comissao: 'Comissão (€)',
};

// ─── New catalog format (Escolha Inteligente, etc.) ───
export type CommissionType = 'pct' | 'fixed';

/**
 * How a telecom service reaches the client. The same offer pays a different
 * commission depending on which one was installed, so it is chosen on the
 * product (which technologies it can be sold as) and frozen on the sale line
 * (which one this install actually is).
 */
export type TelecomTechnology = 'fibra' | 'satelite';

export const TELECOM_TECHNOLOGY_LABELS: Record<TelecomTechnology, string> = {
  fibra: 'Fibra',
  satelite: 'Satélite',
};

export const TELECOM_TECHNOLOGIES: TelecomTechnology[] = ['fibra', 'satelite'];

/**
 * The rate for one technology, falling back to the single value when the
 * product doesn't distinguish — which is every product configured before
 * technologies existed. Returns undefined only when nothing is set at all,
 * so callers can tell "not configured" from "configured as zero".
 */
export function pickByTech(
  base: number | undefined,
  fibra: number | undefined,
  satelite: number | undefined,
  tech: TelecomTechnology | undefined,
): number | undefined {
  if (tech === 'fibra' && fibra != null) return fibra;
  if (tech === 'satelite' && satelite != null) return satelite;
  return base;
}

/** The band's bonus as the switch leaves it: the amount when on, nothing when off. */
export function tierBonusValue(tier: Pick<QuantityTier, 'bonus' | 'bonus_enabled'>): number {
  const on = tier.bonus_enabled ?? ((tier.bonus ?? 0) > 0);
  return on ? (tier.bonus || 0) : 0;
}

/** Whether this product pays by quantity band right now. */
export function usesQuantityTiers(product: Pick<CatalogProduct, 'tiered_commission' | 'quantity_tiers'>): boolean {
  return product.tiered_commission ?? ((product.quantity_tiers?.length ?? 0) > 0);
}

/** True when the product is sold as more than one technology, so the sale has to pick. */
export function productNeedsTechnologyChoice(technologies: TelecomTechnology[] | undefined): boolean {
  return (technologies?.length ?? 0) > 1;
}

/**
 * The technologies a product is sold as, read off its TYPES: a product on the
 * Fibra type is fibre, one on both Fibra and Satélite makes the sale choose.
 * There used to be a separate "Tecnologia" field for this; two places to say
 * the same thing only gave them room to disagree. The old field is still
 * honoured for a product nobody has classified yet.
 */
export function productTechnologies(
  product: Pick<CatalogProduct, 'type_ids' | 'technologies'>,
): TelecomTechnology[] | undefined {
  if (product.type_ids && product.type_ids.length > 0) {
    const techs = TELECOM_TECHNOLOGIES.filter((t) => product.type_ids!.includes(t));
    return techs.length > 0 ? techs : undefined;
  }
  return product.technologies;
}

/**
 * One line of a product's commission table.
 *
 * These are NOT simultaneous beneficiaries — they are a rate table keyed by
 * WHO SOLD. Exactly one line pays on any given sale: the one matching the
 * seller. A named ('user') line wins over the generic ('profile') one.
 *
 * "Sara 70 / Vitor 60 / Vendedor 50" therefore means: Sara sells → she gets
 * 70; Vitor sells → he gets 60; anyone else holding the Vendedor profile
 * sells → they get 50. Never 180.
 *
 * 'pct' values are a percentage of the sale total.
 */
export interface CommissionSplit {
  kind: 'user' | 'profile';
  user_id?: string;
  profile_id?: string;
  type: CommissionType;
  value: number;
  // Per-technology rates, for a product sold as both Fibra and Satélite: the
  // same line pays differently depending on which one was installed. Absent
  // falls back to `value`, so a product with no technology split — every
  // product until now — keeps paying exactly what it always paid.
  value_fibra?: number;
  value_satelite?: number;
  // ...and how to read those rates. The same recipient is often paid a flat
  // fee on fibre and a percentage on satellite, so the €/% choice belongs to
  // the technology, not to the line. Absent falls back to `type`.
  type_fibra?: CommissionType;
  type_satelite?: CommissionType;
}

/** The €/% mode that applies to a split for a given technology. */
export function splitTypeForTech(split: CommissionSplit, tech?: TelecomTechnology): CommissionType {
  if (tech === 'fibra') return split.type_fibra ?? split.type;
  if (tech === 'satelite') return split.type_satelite ?? split.type;
  return split.type;
}

/**
 * One quantity band for a product linked to a telecom operator whose
 * commission_basis is 'per_sale' or 'monthly_volume' (see operators table).
 * `max: null` means "and above" (the last, open-ended band).
 *
 * 'per_sale' resolves the band from the quantity sold in ONE sale.
 * 'monthly_volume' resolves it from the accumulated monthly quantity (per
 * seller or org-wide, per the operator's volume_scope) — and when a new sale
 * pushes the total into a higher band, every sale that month in scope is
 * RE-resolved to that band, not just the new one.
 */
export interface QuantityTier {
  id: string;
  min: number;
  max: number | null;
  // Overrides the product's base price for units sold in this band (e.g. a
  // Digi line costs 6€ alone, 5,5€ each from 2, 5€ each from 3). Absent
  // falls back to the product's own `price` — most operators don't vary
  // price by quantity, only commission.
  price?: number;
  // What the operator pays the org per unit in THIS band. The operator's
  // rate moves with volume (that is the whole point of a Digi band), so it
  // lives here rather than on the product. Falls back to the product's own
  // `operator_pays` when a band doesn't set it.
  operator_pays?: number;
  // Same rate, per technology — the operator pays a different amount for a
  // fibre install than for a satellite one. Absent falls back to
  // `operator_pays` above.
  operator_pays_fibra?: number;
  operator_pays_satelite?: number;
  splits: CommissionSplit[];
  // One-off company-wide reward for REACHING this band (e.g. 15-19 contracts
  // this month earns +300€, 20-24 earns +600€) — added once, not per unit,
  // and shared out among this tier's own `splits` in proportion to their
  // `value`. For a 'monthly_volume' product only the sale that currently
  // carries the group's latest date gets it (server-side); for 'per_sale' it
  // applies to that one sale directly. Absent/0 means no bonus.
  bonus?: number;
  // Cards for THIS band, when a band includes a different number of SIMs
  // (one card in the first band, three from the second) or pays a different
  // rate per extra card. Absent falls back to the product's own values.
  included_cards?: number;
  extra_card_commission?: number;
  // The band's own switch for the bonus. Off keeps the amount stored but
  // pays nothing; absent = the old rule, a non-zero bonus applies.
  bonus_enabled?: boolean;
  // 'fixed' (default when absent): `bonus` is euros, paid as-is. 'pct':
  // `bonus` is a percentage of the tier's own combined commission (all
  // splits, at the quantity that matched the band) — e.g. 10 units earning
  // 100€ commission with a 50% bonus pays +50€.
  bonus_type?: CommissionType;
}

/**
 * Stable identity for one catalog entry — `name` alone stopped being unique
 * once the same product name can exist once per operator plus once with no
 * operator (see CreateTelecomProductModal). Used wherever the catalog admin
 * screen needs to find/edit/remove "this exact entry", not just "this name".
 */
export function catalogProductKey(product: Pick<CatalogProduct, 'name' | 'operator_id'>): string {
  return `${product.operator_id ?? ''}::${product.name}`;
}

export interface CatalogProduct {
  name: string;
  price: number;
  has_commission: boolean;
  commission_pct: number;
  // 'fixed' pays commission_fixed euros per unit. Absent means 'pct', so
  // catalogs saved before this option keep behaving exactly as before.
  commission_type?: CommissionType;
  commission_fixed?: number;
  // When set, the sale pays these people instead of a single commission.
  // Amounts are frozen per sale in sale_commission_splits.
  splits?: CommissionSplit[];
  // Links this product to a row in the `operators` table (Digi, Vodafone...).
  operator_id?: string;
  // Present only when the linked operator has a fixed commission_basis
  // ('per_sale'/'monthly_volume'). When set, this REPLACES `splits` as the
  // source of truth for the product's commission — the matching band's
  // splits are used instead. A product that doesn't actually vary by
  // quantity just gets one band spanning everything (min 1, max ∞).
  quantity_tiers?: QuantityTier[];
  // What the operator pays the org for one unit of this product (e.g. MEO
  // pays 70€ on "1P ou 2P"). The seller's own rate comes out of this, and
  // whatever is left over is the org's margin — see getSaleLineCommission.
  // No commission line may be configured above it.
  operator_pays?: number;
  // Same, per technology. Absent falls back to `operator_pays`.
  operator_pays_fibra?: number;
  operator_pays_satelite?: number;

  // Which product types this product belongs to (see types/product-types.ts).
  // The type decides the SHAPE of the commission; the numbers stay here.
  // A product may carry several: one that sells fibre AND cards is on both,
  // and pays both — except inside an exclusive group (Fibra vs Satélite),
  // where the sale picks one.
  type_ids?: string[];
  // Whether commission is paid by quantity band (quantity_tiers) or as flat
  // lines (splits). Explicit so a product can keep its bands stored while
  // switched off. Absent = the old rule: bands are used when there are any.
  tiered_commission?: boolean;
  // Which quantity picks the band: this sale's own, or the month's running
  // total (for the whole organization, or per seller). Absent falls back to
  // the operator's commission_basis / volume_scope, else to this sale's.
  tier_basis?: 'per_sale' | 'monthly_volume';
  tier_scope?: 'per_seller' | 'org_total';
  // Which technologies this product can be sold as. Absent or a single entry
  // means the sale doesn't ask — the line just takes that one (or none, for
  // products that predate this). Two entries make the choice mandatory on
  // the sale, since the commission depends on it.
  technologies?: TelecomTechnology[];
  // Flat commission per extra SIM card added on top of the ones the package
  // already includes (e.g. a Vodafone package with 2 included pays +10€ per
  // additional card, ported or brand new). Varies per product/operator —
  // absent or 0 means this product doesn't support extra cards at all, and
  // the "Cartões extra" fields don't show for it.
  extra_card_commission?: number;
  // How many SIM cards/lines one unit of this product already includes (e.g.
  // a "2P" package includes 2; Alarme or Energia Residencial include 0 — not
  // every product is a card at all). Added to the extra cards sold on the
  // same line to get the client's real card count — see sales.total_cartoes.
  // Absent defaults to 0, EXCEPT for a quantity-tiered product (one that
  // carries `quantidade`), which defaults to 1 so it keeps counting the way
  // it always did unless configured otherwise.
  included_cards?: number;
}

/**
 * How many cards a line carries, for computing what's extra over the
 * product's own `included_cards`. `total` is the current model — the seller
 * enters the real card count for the line, and the extra count is derived
 * (see getExtraCardCommission). `portabilidade`/`novos` is the OLD model,
 * read only from sales made before this: the seller entered the extras
 * directly, split by whether each one ported a number or is brand new.
 */
export interface ExtraCards {
  total?: number;
  portabilidade?: number;
  novos?: number;
}

/**
 * Commission earned for one unit of a catalog product, in euros.
 *
 * `splits` win whenever they exist: they are what the server actually pays
 * out (generate_sale_commission_splits reads them), while has_commission /
 * commission_fixed / commission_pct are a legacy mirror that older catalog
 * entries never had kept in sync — reading those alone showed 0 € for
 * products whose splits pay hundreds.
 *
 * A 'profile' split only pays when the seller holds that profile, which this
 * can't know, so treat the result as the ceiling: the server freezes the real
 * per-person amounts on the sale.
 */
export function getCatalogCommission(product: CatalogProduct): number {
  if (product.splits && product.splits.length > 0) {
    const fixedSum = product.splits.filter(s => s.type === 'fixed').reduce((sum, s) => sum + (s.value || 0), 0);
    const pctSum = product.splits.filter(s => s.type === 'pct').reduce((sum, s) => sum + (s.value || 0), 0);
    return fixedSum + Math.round((product.operator_pays ?? product.price) * pctSum) / 100;
  }
  if (!product.has_commission) return 0;
  const fixedPart = product.commission_fixed ?? 0;
  const pctPart = Math.round(product.price * (product.commission_pct ?? 0)) / 100;
  return fixedPart + pctPart;
}

/**
 * Pool total for extra SIM cards on a line — a flat per-card rate (the
 * product's own `extra_card_commission`) times every extra card. Not
 * multiplied by `quantidade`: these are literal cards counted once for the
 * whole line, not a per-package rate.
 *
 * `extraCards.total` is the seller-entered card count for the WHOLE line —
 * how many extra it represents is derived by subtracting what the product
 * already includes (`included_cards`, defaulting to 1 here since this only
 * ever applies to a product that deals in cards at all). Falls back to the
 * old portabilidade+novos sum for sales frozen before this field existed.
 */
export function getExtraCardCommission(product: CatalogProduct, extraCards?: ExtraCards, quantity?: number): number {
  const cards = cardConfigFor(product, quantity);
  const rate = cards.extra_card_commission ?? 0;
  if (!rate || !extraCards) return 0;
  const count = extraCards.total != null
    ? Math.max(0, extraCards.total - (cards.included_cards ?? 1))
    : Math.max(0, extraCards.portabilidade || 0) + Math.max(0, extraCards.novos || 0);
  return Math.round(rate * count * 100) / 100;
}

/**
 * The card rules that apply at a given quantity: the matching band's own
 * `included_cards` / `extra_card_commission` when it sets them, else the
 * product's. The band is looked up on THIS line's quantity — how many cards
 * come with two units is a fact about those two units, not about the
 * monthly volume Digi resolves commission bands on.
 */
export function cardConfigFor(
  product: CatalogProduct,
  quantity?: number,
): { included_cards?: number; extra_card_commission?: number } {
  const qty = commissionUnits(quantity);
  const tier = usesQuantityTiers(product)
    ? product.quantity_tiers?.find((t) => qty >= t.min && (t.max == null || qty <= t.max))
    : undefined;
  return {
    included_cards: tier?.included_cards ?? product.included_cards,
    extra_card_commission: tier?.extra_card_commission ?? product.extra_card_commission,
  };
}

/**
 * Commission for `quantity` units of a catalog product. When the product has
 * quantity_tiers (an operator with commission_basis 'per_sale' or
 * 'monthly_volume'), the whole quantity is resolved against ONE band — the
 * band's splits are a per-unit rate, so the total is per-unit × quantity, not
 * graduated like a tax bracket. Falls back to getCatalogCommission (quantity
 * implicitly 1) for a product with no tiers.
 *
 * For 'monthly_volume' operators this is only a same-sale ESTIMATE: the real
 * band (and whether earlier sales this month get re-resolved to it) is
 * decided server-side from the accumulated monthly total, not from this
 * sale's quantity alone.
 */
export function getCatalogCommissionForQuantity(product: CatalogProduct, quantity: number, extraCards?: ExtraCards): number {
  const tiers = usesQuantityTiers(product) ? product.quantity_tiers : undefined;
  if (!tiers || tiers.length === 0) return getCatalogCommission(product) + getExtraCardCommission(product, extraCards);

  const qty = commissionUnits(quantity);
  const tier = tiers.find(t => qty >= t.min && (t.max == null || qty <= t.max));
  if (!tier) return 0;

  const unitPrice = tier.price ?? product.price;
  const fixedPerUnit = tier.splits.filter(s => s.type === 'fixed').reduce((sum, s) => sum + (s.value || 0), 0);
  const pctPerUnit = tier.splits.filter(s => s.type === 'pct').reduce((sum, s) => sum + (s.value || 0), 0);
  const pctBase = tier.operator_pays ?? product.operator_pays ?? unitPrice;
  const perUnit = fixedPerUnit + Math.round(pctBase * pctPerUnit) / 100;
  const base = perUnit * qty;
  // The bonus is a flat, once-off reward for reaching the band, not a
  // per-unit rate — added once, never multiplied by quantity. 'pct' is a
  // percentage of `base` (the tier's own combined commission at this
  // quantity). For 'monthly_volume' this is only an ESTIMATE (same caveat as
  // above): the real value is awarded to a single sale server-side, computed
  // against the group's accumulated quantity, not this one.
  const bonusAmount = tier.bonus_type === 'pct' ? (base * tierBonusValue(tier)) / 100 : tierBonusValue(tier);
  return Math.round((base + bonusAmount) * 100) / 100 + getExtraCardCommission(product, extraCards, qty);
}

/**
 * Euro value of one split, where 'pct' is a percentage of a base.
 *
 * Which base depends on the technology:
 *
 *   fibre    — what the OPERATOR PAYS the org for the unit, not the price
 *              the client pays. In telecom the client pays the operator, the
 *              product's own price is 0, and a percentage of 0 is 0. Callers
 *              fall back to the unit price for a product with no operator
 *              payment configured (every non-telecom product), so a plain
 *              catalog keeps meaning "% of the sale".
 *
 *   satellite — a percentage of what THIS SAME LINE pays in fibre. Satellite
 *              is priced as a cut of the fibre rate: a seller on 170 € of
 *              fibre earns 30 % of his own 170 €, i.e. 51 €, not 30 % of the
 *              200 € the operator pays. Getting this wrong paid every seller
 *              the same 60 € and wiped out the organization's margin.
 *
 * `fibraPctBase` is the operator's FIBRE payment, needed only when the fibre
 * rate is itself a percentage; it defaults to `pctBase`.
 */
function splitEuroValue(
  split: CommissionSplit,
  pctBase: number,
  tech?: TelecomTechnology,
  fibraPctBase?: number,
): number {
  const value = pickByTech(split.value, split.value_fibra, split.value_satelite, tech) || 0;
  if (splitTypeForTech(split, tech) === 'fixed') return value;
  const base = tech === 'satelite'
    ? splitEuroValue(split, fibraPctBase ?? pctBase, 'fibra')
    : pctBase;
  return Math.round(base * value) / 100;
}

/**
 * The one line that pays on this sale: the seller's.
 *
 * A line naming him wins over the generic "Perfil: Vendedor" line — so a
 * table of "Sara 70 / Vitor 60 / Vendedor 50" pays Vitor his 60, not the 50.
 * A seller with no line at all earns nothing from this product.
 */
function sellerRatePerUnit(
  splits: CommissionSplit[] | undefined,
  pctBase: number,
  sellerUserId?: string | null,
  sellerProfileId?: string | null,
  tech?: TelecomTechnology,
  fibraPctBase?: number,
): number {
  if (!splits || splits.length === 0) return 0;
  const named = sellerUserId
    ? splits.find(s => s.kind === 'user' && s.user_id === sellerUserId)
    : undefined;
  if (named) return splitEuroValue(named, pctBase, tech, fibraPctBase);
  const byProfile = sellerProfileId
    ? splits.find(s => s.kind === 'profile' && s.profile_id === sellerProfileId)
    : undefined;
  return byProfile ? splitEuroValue(byProfile, pctBase, tech, fibraPctBase) : 0;
}

/**
 * Whether the product's commission table has ANY line that would pay this
 * seller — by name, or through his profile. A seller with none earns 0 on
 * the product, and the screen must say so rather than show "0,00 €" as if
 * it were a rate: a whole operator's catalog configured for one person
 * only reads as a bug to everyone else.
 */
export function sellerHasCommissionLine(
  product: CatalogProduct,
  quantity: number,
  sellerUserId?: string | null,
  sellerProfileId?: string | null,
): boolean {
  const qty = commissionUnits(quantity);
  const tiers = usesQuantityTiers(product) ? product.quantity_tiers : undefined;
  const tier = tiers && tiers.length > 0
    ? tiers.find(t => qty >= t.min && (t.max == null || qty <= t.max))
    : undefined;
  const splits = tier ? tier.splits : product.splits;
  if (!splits || splits.length === 0) return false;
  return splits.some(s =>
    (s.kind === 'user' && !!sellerUserId && s.user_id === sellerUserId)
    || (s.kind === 'profile' && !!sellerProfileId && s.profile_id === sellerProfileId),
  );
}

/** What one sale line is worth, split three ways. */
export interface SaleLineCommission {
  /** What the operator pays the org for this line (incl. bonus and extra cards). */
  gross: number;
  /** What the person who made the sale takes home. */
  seller: number;
  /** What is left over for the organization. */
  org: number;
}

/**
 * The money on one product line of a sale.
 *
 * The operator pays the org a set amount per unit (`operator_pays`, per band
 * when the product has quantity tiers). Out of that, the SELLER takes his own
 * rate from the product's commission table — one line only, his — and the
 * difference stays with the org.
 *
 * The band's Bónus Geral and the extra-card money are paid by the operator on
 * top, and both go to the seller whole, so they raise `gross` and `seller`
 * equally and leave `org` untouched.
 *
 * A product with no `operator_pays` configured yet cannot say what the org
 * keeps, so it reports gross = seller and org = 0 rather than inventing a
 * margin (or a negative one).
 */
export function getSaleLineCommission(
  product: CatalogProduct,
  quantity: number,
  extraCards?: ExtraCards,
  sellerUserId?: string | null,
  sellerProfileId?: string | null,
  tech?: TelecomTechnology,
): SaleLineCommission {
  const qty = commissionUnits(quantity);
  const tiers = product.quantity_tiers;
  const tier = tiers && tiers.length > 0
    ? tiers.find(t => qty >= t.min && (t.max == null || qty <= t.max))
    : undefined;

  // A tiered product whose quantity matches no band pays nothing at all.
  if (tiers && tiers.length > 0 && !tier) return { gross: 0, seller: 0, org: 0 };

  const unitPrice = tier?.price ?? product.price;
  const splits = tier ? tier.splits : product.splits;

  const operatorPerUnit =
    pickByTech(tier?.operator_pays, tier?.operator_pays_fibra, tier?.operator_pays_satelite, tech)
    ?? pickByTech(product.operator_pays, product.operator_pays_fibra, product.operator_pays_satelite, tech)
    ?? null;
  // The fibre payment as well: a satellite percentage is a cut of the fibre
  // rate, and that rate is itself a percentage on some products.
  const operatorFibraPerUnit =
    pickByTech(tier?.operator_pays, tier?.operator_pays_fibra, tier?.operator_pays_satelite, 'fibra')
    ?? pickByTech(product.operator_pays, product.operator_pays_fibra, product.operator_pays_satelite, 'fibra')
    ?? null;

  const sellerPerUnit = sellerRatePerUnit(
    splits,
    operatorPerUnit ?? unitPrice,
    sellerUserId,
    sellerProfileId,
    tech,
    operatorFibraPerUnit ?? unitPrice,
  );
  const sellerBase = sellerPerUnit * qty;

  const bonus = tier
    ? (tier.bonus_type === 'pct'
        ? (sellerBase * tierBonusValue(tier)) / 100
        : tierBonusValue(tier))
    : 0;
  const extra = getExtraCardCommission(product, extraCards, qty);

  const grossBase = operatorPerUnit != null ? operatorPerUnit * qty : sellerBase;

  const round = (n: number) => Math.round(n * 100) / 100;
  const gross = round(grossBase + bonus + extra);
  const seller = round(sellerBase + bonus + extra);
  return { gross, seller, org: round(gross - seller) };
}

/**
 * The extra-card money that lands with the person looking at the screen.
 *
 * It belongs to the SELLER, whole — it is what the operator pays for the
 * card he sold, not a pot to divide. Sharing it out in proportion to the
 * base commission (as this first did) paid a seller on a 530€ product
 * 10 × 170/530 = 3,21€ for a 10€ card. So it is all-or-nothing: the seller
 * gets the lot, everyone else gets zero from it.
 */
export function getExtraCardCommissionForSeller(
  product: CatalogProduct,
  extraCards: ExtraCards | undefined,
  viewerIsSeller: boolean,
  quantity?: number,
): number {
  return viewerIsSeller ? getExtraCardCommission(product, extraCards, quantity) : 0;
}

/**
 * Unit price for `quantity` units of a catalog product — the matching
 * band's own price when the product has quantity_tiers (e.g. a Digi line is
 * 6€ alone, 5€ each from 3), else the product's flat price. Multiply by
 * quantity yourself for a line total.
 */
export function getCatalogPriceForQuantity(product: CatalogProduct, quantity: number): number {
  const tiers = product.quantity_tiers;
  if (!tiers || tiers.length === 0) return product.price;

  const qty = Math.max(1, Math.round(quantity || 1));
  const tier = tiers.find(t => qty >= t.min && (t.max == null || qty <= t.max));
  return tier?.price ?? product.price;
}

/**
 * Derives the legacy scalar commission fields (has_commission, commission_pct,
 * commission_fixed, commission_type) from the splits list, so screens that
 * still read those fields — the sale-creation prefill via getCatalogCommission,
 * mainly — show a sensible number before generate_sale_commission_splits()
 * (see 20260831210000_sale_commission_splits.sql) freezes the real per-person
 * amounts server-side. Splits are the single source of truth the user edits;
 * these fields are just kept in sync automatically.
 */
export function deriveCommissionFields(
  splits: CommissionSplit[],
): Pick<CatalogProduct, 'has_commission' | 'commission_pct' | 'commission_fixed' | 'commission_type'> {
  const fixedSum = splits.filter(s => s.type === 'fixed').reduce((sum, s) => sum + (s.value || 0), 0);
  const pctSum = splits.filter(s => s.type === 'pct').reduce((sum, s) => sum + (s.value || 0), 0);
  return {
    has_commission: splits.length > 0,
    commission_fixed: fixedSum,
    commission_pct: pctSum,
    commission_type: fixedSum > 0 && pctSum === 0 ? 'fixed' : 'pct',
  };
}
