/**
 * Shared "Outros Serviços" section for proposals/sales.
 * Supports both legacy (fields-based) and new catalog format.
 */
import { useEffect, useState } from 'react';
import { Radio, Wrench, X, Package, Tags } from 'lucide-react';
import { useProductTypes } from '@/hooks/useProductTypes';
import { Toggle } from '@/components/ui/toggle';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableCombobox, type ComboboxOption } from '@/components/ui/searchable-combobox';
import { NumberInput } from '@/components/shared/NumberInput';
import { cn } from '@/lib/utils';
import { commissionUnits, normalizeOperationalUnits } from '@/lib/sale-units';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers } from '@/hooks/useTeam';
import type {
  ServicosDetails,
  ServicosProductDetail,
  ServicosProductConfig,
  CatalogProduct,
  ModeloServico,
  ExtraCards,
  TelecomTechnology,
} from '@/types/proposals';
import {
  FIELD_LABELS,
  getSaleLineCommission,
  sellerHasCommissionLine,
  getCatalogPriceForQuantity,
  TELECOM_TECHNOLOGIES,
  TELECOM_TECHNOLOGY_LABELS,
  productNeedsTechnologyChoice,
  productTechnologies,
  cardConfigFor,
} from '@/types/proposals';
import { useLanguage, tr, intlLocale } from "@/i18n";

interface OperatorRef {
  id: string;
  name: string;
}

interface ServicosSectionProps {
  modeloServico: ModeloServico;
  onModeloServicoChange: (v: ModeloServico) => void;
  servicosProdutos: string[];
  servicosDetails: ServicosDetails;
  attempted?: boolean;
  isNewFormat: boolean;
  configs?: ServicosProductConfig[];
  catalog?: CatalogProduct[] | null;
  /** So the "add product" search can also match by operator name (Digi, Vodafone...). */
  operators?: OperatorRef[];
  /**
   * Who made this sale/proposal — the extra-card money is his, whole. Absent
   * means "being created now", so the person at the screen is the seller.
   */
  sellerUserId?: string | null;
  onToggleProduct: (name: string) => void;
  /** For legacy format: update a single numeric field */
  onUpdateDetail: (product: string, field: string, value: number | undefined) => void;
  /** For new format: set the full details for a product */
  onSetProductDetail: (product: string, detail: ServicosProductDetail) => void;
  /** Reports the seller's commission total up (catalog format only), so the
   *  sale's summary can show it instead of a price the client never pays. */
  onSellerCommissionChange?: (total: number) => void;
  isAutoCalculated?: (product: string) => boolean;
  totalKwp?: number;
  totalComissao?: number;
  hideModeloServico?: boolean;
}

export function ServicosSection({
  modeloServico,
  onModeloServicoChange,
  servicosProdutos,
  servicosDetails,
  attempted,
  isNewFormat,
  configs = [],
  catalog,
  operators = [],
  sellerUserId,
  onToggleProduct,
  onUpdateDetail,
  onSetProductDetail,
  onSellerCommissionChange,
  isAutoCalculated,
  totalKwp,
  totalComissao,
  hideModeloServico,
}: ServicosSectionProps) {
  const { t } = useLanguage();
  return (
    <div className="space-y-4 p-4 rounded-lg border bg-secondary/30 border-border">
      <div className="flex items-center gap-2 text-foreground">
        <Wrench className="h-4 w-4" />
        <span className="font-medium text-sm">{t("Outros Serviços")}</span>
      </div>

      {/* Modelo de Serviço */}
      {!hideModeloServico && (
        <div className="space-y-2">
          <Label className="text-sm">{t("Modelo de Serviço")}</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={modeloServico === 'transacional' ? 'default' : 'outline'} size="sm" className="h-9" onClick={() => onModeloServicoChange('transacional')}>
              {t("Transacional")}
            </Button>
            <Button type="button" variant={modeloServico === 'saas' ? 'default' : 'outline'} size="sm" className="h-9" onClick={() => onModeloServicoChange('saas')}>
              {t("SAAS")}
            </Button>
          </div>
        </div>
      )}

      {isNewFormat && catalog ? (
        <CatalogProducts
          catalog={catalog}
          operators={operators}
          sellerUserId={sellerUserId}
          servicosProdutos={servicosProdutos}
          servicosDetails={servicosDetails}
          onToggleProduct={onToggleProduct}
          onSetProductDetail={onSetProductDetail}
          onSellerCommissionChange={onSellerCommissionChange}
          attempted={attempted}
        />
      ) : (
        <LegacyProducts
          configs={configs}
          servicosProdutos={servicosProdutos}
          servicosDetails={servicosDetails}
          onToggleProduct={onToggleProduct}
          onUpdateDetail={onUpdateDetail}
          isAutoCalculated={isAutoCalculated}
          attempted={attempted}
          totalKwp={totalKwp}
          totalComissao={totalComissao}
        />
      )}
    </div>
  );
}

// ─── New Catalog Format ───

function CatalogProducts({
  catalog,
  operators,
  sellerUserId,
  servicosProdutos,
  servicosDetails,
  onToggleProduct,
  onSetProductDetail,
  onSellerCommissionChange,
  attempted,
}: {
  catalog: CatalogProduct[];
  operators: OperatorRef[];
  sellerUserId?: string | null;
  servicosProdutos: string[];
  servicosDetails: ServicosDetails;
  onToggleProduct: (name: string) => void;
  onSetProductDetail: (product: string, detail: ServicosProductDetail) => void;
  /** Reports the seller's total up, so the sale's summary can show the
   *  commission instead of a price the client never pays. */
  onSellerCommissionChange?: (total: number) => void;
  attempted?: boolean;
}) {
  const { t } = useLanguage();
  // Three numbers per line, each with one meaning (see getSaleLineCommission):
  //   gross  — what the operator pays the org. This is what gets STORED in
  //            detail.comissao and saved to sales.comissao.
  //   seller — what the person who made the sale takes home.
  //   org    — the difference, the organization's margin.
  const { user } = useAuth();
  const { data: teamMembers = [] } = useTeamMembers();
  const currentUserId = user?.id;
  // Rates are keyed by WHO SOLD: the sale's own seller on an existing sale,
  // the person filling the form on a new one.
  const sellerId = sellerUserId ?? currentUserId;
  const sellerProfileId = teamMembers.find((m) => m.user_id === sellerId)?.profile_id ?? null;
  const viewerIsSeller = sellerId === currentUserId;
  // The operator gross and the org's margin are the company's numbers, not a
  // salesperson's. He sees what he earns; only an admin sees the rest.

  const lineCommission = (product: CatalogProduct, qty: number, extraCards?: ExtraCards, tech?: TelecomTechnology) =>
    getSaleLineCommission(product, qty, extraCards, sellerId, sellerProfileId, tech);

  const operatorById = new Map(operators.map((o) => [o.id, o.name]));

  /**
   * The catalog entry a product NAME resolves to for a given operator
   * context — the operator-specific entry when there is one, else the
   * operator-agnostic one. Now that the same name can exist once per
   * operator (see CreateTelecomProductModal), a bare `catalog.find(name)`
   * is ambiguous; every lookup below goes through this instead.
   */
  const resolveProduct = (name: string, operatorId: string | null | undefined): CatalogProduct | undefined => {
    const specific = operatorId ? catalog.find((c) => c.name === name && c.operator_id === operatorId) : undefined;
    return specific ?? catalog.find((c) => c.name === name && !c.operator_id);
  };

  // Which operator this "add product" search is shopping for. A product with
  // no operator_id at all (e.g. "1P" priced the same for MEO/Vodafone/NOS)
  // shows up no matter which operator is picked here; a product tied to a
  // SPECIFIC operator (e.g. "1P" for Digi, which pays differently) only shows
  // up under that one — and, when both exist for the same name, the
  // operator-specific one wins over the generic one (an explicit override).
  // The sale starts from the product TYPE (Fibra, Satélite, Cartões…), which
  // is also what the sale is about; the operator is a fact about the
  // product and comes along with it. Only types that actually have a
  // product are offered.
  const [addTypeId, setAddTypeId] = useState<string | null>(null);
  const { active: productTypes, byId: typeById } = useProductTypes();
  const typesWithProducts = productTypes.filter((t) => catalog.some((c) => (c.type_ids ?? []).includes(t.id)));

  const totalPrice = servicosProdutos.reduce((sum, p) => sum + (servicosDetails[p]?.price || 0), 0);
  // The pool that actually gets saved to the sale (sales.comissao), across
  // every recipient — shown under the seller's own total so the sale can be
  // checked without logging in as each person who gets paid.
  const totalPoolComissao = servicosProdutos.reduce((sum, p) => sum + (servicosDetails[p]?.comissao || 0), 0);
  // Shown in the "Comissão Total" box below — the seller's own total, not the
  // pool (which is still what gets saved to the sale, via detail.comissao).
  // Resolved by the operator FROZEN on this line, not the current picker —
  // a line added under Digi stays a Digi line even if the picker moves on.
  const { totalSellerComissao } = servicosProdutos.reduce(
    (acc, p) => {
      const detail = servicosDetails[p];
      const catProduct = resolveProduct(p, detail?.operator_id);
      if (!catProduct) return acc;
      const line = lineCommission(
        catProduct,
        detail?.quantidade ?? 1,
        detail?.total_cards != null
          ? { total: detail.total_cards }
          : { portabilidade: detail?.extra_cards_portability, novos: detail?.extra_cards_new },
        detail?.tecnologia,
      );
      return {
        totalSellerComissao: acc.totalSellerComissao + line.seller,
        totalOrgComissao: acc.totalOrgComissao + line.org,
        totalGrossComissao: acc.totalGrossComissao + line.gross,
      };
    },
    { totalSellerComissao: 0, totalOrgComissao: 0, totalGrossComissao: 0 },
  );

  useEffect(() => {
    onSellerCommissionChange?.(totalSellerComissao);
  }, [totalSellerComissao, onSellerCommissionChange]);

  // Build combobox options: for the chosen operator, every product tied to it
  // plus every operator-agnostic one — deduplicated by name (the specific
  // entry wins), excluding names already added to this sale/proposta.
  const comboboxOptions: ComboboxOption[] = (() => {
    const seen = new Set<string>();
    const eligible = catalog.filter((c) => !addTypeId || (c.type_ids ?? []).includes(addTypeId));
    // Operator-specific entries first, so they claim the name before the
    // operator-agnostic fallback for the same name is considered.
    const ordered = [...eligible].sort((a, b) => (a.operator_id ? -1 : 0) - (b.operator_id ? -1 : 0));
    const options: ComboboxOption[] = [];
    for (const c of ordered) {
      if (seen.has(c.name) || servicosProdutos.includes(c.name)) continue;
      seen.add(c.name);
      const operatorName = c.operator_id ? operatorById.get(c.operator_id) : undefined;
      const priceText = c.price ? c.price.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' }) : null;
      const sublabel = [operatorName, priceText].filter(Boolean).join(' · ') || undefined;
      options.push({ value: c.name, label: c.name, sublabel });
    }
    return options;
  })();

  const handleAddProduct = (value: string | null) => {
    if (!value) return;
    onToggleProduct(value);
    // Same name once per operator plus once generic: the operator-bound
    // entry of the chosen type wins, then the generic one.
    const catProduct =
      catalog.find((c) => c.name === value && !!c.operator_id && (!addTypeId || (c.type_ids ?? []).includes(addTypeId)))
      ?? catalog.find((c) => c.name === value && !c.operator_id)
      ?? catalog.find((c) => c.name === value);
    if (catProduct) {
      const isTiered = !!catProduct.quantity_tiers?.length;
      const techs = productTechnologies(catProduct);
      // Picking the Fibra or Satélite TYPE already says which one this line
      // is; anything else leaves it to the single-technology rule below.
      const chosenTech = (addTypeId === 'fibra' || addTypeId === 'satelite') && techs?.includes(addTypeId)
        ? addTypeId
        : undefined;
      const tecnologia = chosenTech ?? (techs?.length === 1 ? techs[0] : undefined);
      // Pool total (every recipient combined) — this is what gets saved.
      const comissaoVal = lineCommission(catProduct, 1, undefined, tecnologia).gross;
      const priceVal = isTiered ? getCatalogPriceForQuantity(catProduct, 1) : catProduct.price;
      // The operator comes with the product. A product with none (the
      // Níveis sold under any brand) gets one on its own line, below.
      const frozenOperatorId = catProduct.operator_id;
      onSetProductDetail(value, {
        price: priceVal,
        commission_pct: catProduct.commission_pct,
        commission_type: catProduct.commission_type ?? 'pct',
        commission_fixed: catProduct.commission_fixed ?? 0,
        comissao: comissaoVal,
        quantidade: 1,
        operator_id: frozenOperatorId,
        operator_name: frozenOperatorId ? operatorById.get(frozenOperatorId) : undefined,
        // Undefined on a two-technology product picked under a non-technology
        // type (Cartões), on purpose: the sale cannot be saved until someone
        // says which one was installed.
        tecnologia,
      });
    }
  };

  return (
    <>
      <div className="space-y-3">
        <Label className="text-sm">{t("Produtos do Catálogo")}</Label>
        {attempted && servicosProdutos.length === 0 && (
          <p className="text-xs text-destructive">{t("Selecione pelo menos 1 produto")}</p>
        )}

        {/* Step one: the type. It narrows the search below and, for Fibra or
            Satélite, already settles the line's technology. Stays picked
            between additions. */}
        {typesWithProducts.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Tags className="h-3 w-3 shrink-0" /> {t("Tipo")}
            </Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {typesWithProducts.map((t) => {
                const on = addTypeId === t.id;
                return (
                  <Toggle
                    key={t.id}
                    size="sm"
                    variant="outline"
                    pressed={on}
                    onPressedChange={() => setAddTypeId(on ? null : t.id)}
                    className={cn(
                      'h-8 rounded-full px-3 text-xs font-medium',
                      on
                        ? 'border-primary/40 bg-primary/10 text-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary'
                        : 'border-dashed text-muted-foreground',
                    )}
                  >
                    {t.name}
                  </Toggle>
                );
              })}
            </div>
          </div>
        )}

        {/* Step two: the product, among those of the chosen type (all of
            them while no type is picked). */}
        <div className="space-y-1.5 border-t pt-3">
          <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Package className="h-3 w-3 shrink-0" /> {t("Produto")}
          </Label>
          <SearchableCombobox
            options={comboboxOptions}
            value={null}
            onValueChange={handleAddProduct}
            placeholder={t("Pesquisar e adicionar produto...")}
            searchPlaceholder={t("Escreva para pesquisar...")}
            emptyText={t("Nenhum produto encontrado.")}
            emptyValue="__none__"
            emptyLabel={t("Nenhum")}
          />
        </div>

        {/* Selected products as editable cards */}
        {servicosProdutos.map((productName) => {
          const detail = servicosDetails[productName] || {};
          const catProduct = resolveProduct(productName, detail.operator_id);
          if (!catProduct) return null;
          const price = detail.price ?? catProduct.price;
          const isTiered = !!catProduct.quantity_tiers?.length;
          const commissionPct = detail.commission_pct ?? catProduct.commission_pct;
          const quantidade = detail.quantidade ?? 1;
          const unitPrice = isTiered ? getCatalogPriceForQuantity(catProduct, quantidade) : (catProduct.price || 0);
          // Extra SIM cards on top of the package's included ones — only
          // relevant for products the admin configured a per-card rate for.
          // Both can be set on the band this quantity falls in.
          const cards = cardConfigFor(catProduct, quantidade);
          const supportsExtraCards = !!cards.extra_card_commission;
          // How many cards this line already includes by default — what the
          // seller sees pre-filled, and the baseline extras are counted from.
          const includedCards = cards.included_cards ?? 1;
          // A sale made before this field existed stored the EXTRAS instead of
          // the total. Ignoring them showed "1 cartão" on a line that is being
          // paid for two — the screen disagreeing with the commission it earns.
          const legacyExtras = (detail.extra_cards_portability ?? 0) + (detail.extra_cards_new ?? 0);
          const totalCards = detail.total_cards ?? includedCards + legacyExtras;
          const extraCardsCount = Math.max(0, totalCards - includedCards);
          const extraCards: ExtraCards = { total: totalCards };
          // Which technology this line is. Undefined on a product sold as both
          // until someone picks — and until then the line pays nothing, which is
          // the point: a wrong default would quietly pay the fibre rate on a
          // satellite install.
          const needsTech = productNeedsTechnologyChoice(productTechnologies(catProduct));
          const tecnologia = detail.tecnologia;
          const lineTypeNames = (catProduct.type_ids ?? [])
            .filter((id) => !(id === 'fibra' || id === 'satelite') || !tecnologia || id === tecnologia)
            .map((id) => typeById.get(id)?.name ?? id);
          const line = lineCommission(catProduct, quantidade, extraCards, tecnologia);
          const hasCommission = line.gross > 0 || isTiered || catProduct.has_commission;
          // What the SELLER takes on this line — the same number the box at
          // the foot of the card totals up. It used to read 0 for anyone who
          // was not the seller, so an admin saw "0,00 €" per line above a
          // "70,00 €" total on the same card.
          const myLineCommission = line.seller;
          const myUnitCommission = myLineCommission / commissionUnits(quantidade);

          return (
            <div key={productName} className="p-3 rounded-md bg-muted/50 border border-border/50 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{detail.name ?? productName}</span>
                  {catProduct.operator_id ? (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                      {detail.operator_name ?? operatorById.get(catProduct.operator_id)}
                    </Badge>
                  ) : operators.length > 0 && (
                    // A generic product (the Níveis) is sold under some brand:
                    // the seller says which, and it is frozen on the line so
                    // the operator filters and reports can see it.
                    <Select
                      value={detail.operator_id ?? '__none__'}
                      onValueChange={(v) => {
                        const id = v === '__none__' ? undefined : v;
                        onSetProductDetail(productName, { ...detail, operator_id: id, operator_name: id ? operatorById.get(id) : undefined });
                      }}
                    >
                      <SelectTrigger className="h-6 w-auto gap-1 px-2 text-[11px]">
                        <Radio className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <SelectValue placeholder={t("Operadora")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("Sem operadora")}</SelectItem>
                        {operators.map((op) => (
                          <SelectItem key={op.id} value={op.id}>{op.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {lineTypeNames.map((name) => (
                    <Badge key={name} variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal border-primary/30 bg-primary/5 text-primary">
                      {name}
                    </Badge>
                  ))}
                  {hasCommission && !isTiered && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                      {myUnitCommission.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })} {t("comissão/unid.")}
                    </Badge>
                  )}
                  {isTiered && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                      {t("Comissão por escalão")}
                    </Badge>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => onToggleProduct(productName)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("Nome")}</Label>
                  <Input
                    value={detail.name ?? catProduct.name}
                    onChange={(e) => {
                      onSetProductDetail(productName, { ...detail, name: e.target.value });
                    }}
                    className="h-8 text-sm"
                    placeholder={catProduct.name}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("Preço (€)")}</Label>
                  <NumberInput
                    step={0.01}
                    min={0}
                    value={price}
                    onCommit={(newPrice) => {
                      const comissao = lineCommission({ ...catProduct, price: newPrice }, quantidade, extraCards, tecnologia).gross;
                      onSetProductDetail(productName, { ...detail, price: newPrice, comissao });
                    }}
                    className="h-8"
                  />
                </div>
                {/* Quantity applies to every product — you can sell three of
                    the same package. Tiered products additionally resolve
                    their band (and price) from it. */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("Quantidade")}</Label>
                  <NumberInput
                    min={0.5}
                    step={0.5}
                    value={quantidade}
                    onCommit={(n) => {
                      const newQty = normalizeOperationalUnits(n);
                      const comissao = lineCommission(catProduct, newQty, extraCards, tecnologia).gross;
                      const newPrice = isTiered
                        ? getCatalogPriceForQuantity(catProduct, newQty) * newQty
                        : unitPrice * newQty;
                      onSetProductDetail(productName, { ...detail, quantidade: newQty, comissao, price: newPrice });
                    }}
                    className="h-8"
                  />
                </div>
                {needsTech && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("Tecnologia")}</Label>
                    <Select
                      value={tecnologia ?? ""}
                      onValueChange={(v) => {
                        const tech = v as TelecomTechnology;
                        const comissao = lineCommission(catProduct, quantidade, extraCards, tech).gross;
                        onSetProductDetail(productName, { ...detail, tecnologia: tech, comissao });
                      }}
                    >
                      <SelectTrigger className={cn("h-8 text-sm", !tecnologia && "border-destructive text-muted-foreground")}>
                        <SelectValue placeholder={t("Escolher")} />
                      </SelectTrigger>
                      <SelectContent>
                        {(productTechnologies(catProduct) ?? TELECOM_TECHNOLOGIES).map((t) => (
                          <SelectItem key={t} value={t}>{tr(TELECOM_TECHNOLOGY_LABELS[t])}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              {needsTech && !tecnologia && (
                <p className="text-[11px] text-destructive">
                  {t("Escolhe a tecnologia — a comissão desta linha depende dela.")}
                </p>
              )}
              {supportsExtraCards && (
                <div className="space-y-1 max-w-[200px]">
                  <Label className="text-xs text-muted-foreground">{t("Número de Cartões")}</Label>
                  <NumberInput
                    min={0}
                    step={1}
                    value={totalCards}
                    onCommit={(n) => {
                      const newTotal = Math.max(0, Math.round(n) || 0);
                      const nextExtra: ExtraCards = { total: newTotal };
                      const comissao = lineCommission(catProduct, quantidade, nextExtra, tecnologia).gross;
                      onSetProductDetail(productName, { ...detail, total_cards: newTotal, comissao });
                    }}
                    className="h-8"
                  />
                  {/* This product already includes some, so only the difference
                      pays extra-card commission — spell it out, since "3
                      cartões" alone doesn't say how many of those are extra. */}
                  <p className="text-[11px] text-muted-foreground">
                    {includedCards} {t("incluído")}{includedCards === 1 ? '' : 's'}
                    {extraCardsCount > 0 && <> · {extraCardsCount} {t("extra")}{extraCardsCount === 1 ? '' : 's'}</>}
                  </p>
                </div>
              )}
              {hasCommission && !sellerHasCommissionLine(catProduct, quantidade, sellerId, sellerProfileId) ? (
                // The product pays commission, just not to THIS seller: there is
                // no line with his name or his profile on it. "0,00 €" here read
                // as a broken calculation; it is a missing row in the catalog.
                <p className="text-xs text-amber-600">
                  {viewerIsSeller
                    ? t("Não tens linha de comissão neste produto — um admin acrescenta-a em Definições → Produtos.")
                    : t("O vendedor não tem linha de comissão neste produto — um admin acrescenta-a em Definições → Produtos.")}
                </p>
              ) : hasCommission && (
                <div className="text-xs text-muted-foreground">
                  {viewerIsSeller ? t("A tua parte ({{n}} unid.):", { n: quantidade }) : t("Comissão do vendedor ({{n}} unid.):", { n: quantidade })} <span className="font-medium text-foreground">
                    {myLineCommission.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })}
                  </span>
                  {/* The operator gross used to sit here. It is the
                      organization's number, not the sale's — it belongs to the
                      Financeiro cards, where only an admin ever looks. */}
                  {isTiered && !catProduct.quantity_tiers?.some(t => quantidade >= t.min && (t.max == null || quantidade <= t.max)) && (
                    <span className="ml-1 text-destructive">{t("(sem escalão para esta quantidade)")}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {servicosProdutos.length > 0 && (
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("Valor Total (€)")}</Label>
            <div className="h-8 flex items-center text-sm font-medium px-3 rounded-md bg-muted">
              {totalPrice ? totalPrice.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' }) : '—'}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {viewerIsSeller ? t("A Tua Comissão (€)") : t("Comissão do Vendedor (€)")}
            </Label>
            <div className="h-8 flex items-center text-sm font-medium px-3 rounded-md bg-muted">
              {totalSellerComissao ? totalSellerComissao.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' }) : '—'}
            </div>
            {/* No operator gross or org margin here. A sale shows what it pays
                the seller and nothing else — those two numbers belong to the
                organization's own cards (Financeiro, painel), not to a screen
                the seller has open in front of the client. */}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Legacy Format ───

function LegacyProducts({
  configs,
  servicosProdutos,
  servicosDetails,
  onToggleProduct,
  onUpdateDetail,
  isAutoCalculated,
  attempted,
  totalKwp,
  totalComissao,
}: {
  configs: ServicosProductConfig[];
  servicosProdutos: string[];
  servicosDetails: ServicosDetails;
  onToggleProduct: (name: string) => void;
  onUpdateDetail: (product: string, field: string, value: number | undefined) => void;
  isAutoCalculated?: (product: string) => boolean;
  attempted?: boolean;
  totalKwp?: number;
  totalComissao?: number;
}) {
  const { t } = useLanguage();
  return (
    <>
      <div className="space-y-3">
        <Label className="text-sm">{t("Produtos")}</Label>
        {attempted && servicosProdutos.length === 0 && (
          <p className="text-xs text-destructive">{t("Selecione pelo menos 1 produto")}</p>
        )}
        {configs.map((config) => {
          const isActive = servicosProdutos.includes(config.name);
          const detail = servicosDetails[config.name] || {};
          return (
            <div key={config.name} className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={`produto-${config.name}`}
                  checked={isActive}
                  onCheckedChange={() => onToggleProduct(config.name)}
                />
                <Label htmlFor={`produto-${config.name}`} className="text-sm cursor-pointer font-medium">
                  {config.name}
                </Label>
              </div>
              {isActive && (
                <div className="ml-6 flex flex-wrap gap-2">
                  {config.fields.map((field) => {
                    const isComissaoAuto = field === 'comissao' && isAutoCalculated?.(config.name);
                    return (
                      <div key={field} className="space-y-1 min-w-[100px] flex-1">
                        <Label className="text-xs text-muted-foreground">
                          {t(FIELD_LABELS[field])} <span className="text-destructive">*</span>
                          {isComissaoAuto && <span className="ml-1 text-primary">{t("(auto)")}</span>}
                        </Label>
                        {attempted && (detail[field] === undefined || detail[field] <= 0) && (
                          <p className="text-[10px] text-destructive">{t("Obrigatório")}</p>
                        )}
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={detail[field] ?? ''}
                          onChange={(e) => onUpdateDetail(config.name, field, e.target.value ? parseFloat(e.target.value) : undefined)}
                          placeholder={field === 'kwp' && config.kwpAuto ? t("Auto") : '0'}
                          className="h-8"
                          readOnly={(field === 'kwp' && !!config.kwpAuto && detail.valor !== undefined) || !!isComissaoAuto}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("kWp Total")}</Label>
          <div className="h-8 flex items-center text-sm font-medium px-3 rounded-md bg-muted">
            {totalKwp ? totalKwp.toLocaleString(intlLocale(), { maximumFractionDigits: 2 }) : '—'}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("Comissão Total (€)")}</Label>
          <div className="h-8 flex items-center text-sm font-medium px-3 rounded-md bg-muted">
            {totalComissao ? totalComissao.toLocaleString(intlLocale(), { maximumFractionDigits: 2 }) : '—'}
          </div>
        </div>
      </div>
    </>
  );
}
