import { Radio, Cable, Plus, Banknote, Tag, Wallet, CreditCard, Tags } from 'lucide-react';
import { TonedField, tonedInputClass } from './FieldTone';
import { Toggle } from '@/components/ui/toggle';
import { useProductTypes } from '@/hooks/useProductTypes';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { productTechnologies } from '@/types/proposals';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CommissionSplitsEditor } from './CommissionSplitsEditor';
import { QuantityTiersEditor } from './QuantityTiersEditor';
import type { Operator } from '@/hooks/useOperators';
import type { CatalogProduct, CommissionSplit, QuantityTier, TelecomTechnology } from '@/types/proposals';
import {
  deriveCommissionFields,
  productNeedsTechnologyChoice,
  TELECOM_TECHNOLOGIES,
  TELECOM_TECHNOLOGY_LABELS,
} from '@/types/proposals';

const NO_OPERATOR = '__none__';
// Radix Select needs a non-empty value for every option.


interface Member {
  user_id: string;
  full_name: string;
}

interface Profile {
  id: string;
  name: string;
}

/**
 * Resolves the linked operator and what that means for the commission editor
 * below. A fixed commission_basis (per_sale/monthly_volume) wins regardless
 * of kind — an energia operator can opt out of Matriz de Comissões and use
 * the same escalões editor as telecom. A product that doesn't actually vary
 * by quantity just gets ONE band covering everything (min 1, max ∞) — same
 * editor, same mechanism, no separate "flat commission" mode to maintain.
 */
/** Whether the card fields apply: the product is on the Cartões type, or is not classified yet. */
export function sellsCards(product: Pick<CatalogProduct, 'type_ids'>): boolean {
  const ids = product.type_ids ?? [];
  return ids.length === 0 || ids.includes('cartoes');
}

export function useProductOperatorContext(product: CatalogProduct, operators: Operator[]) {
  const operator = operators.find(o => o.id === product.operator_id) ?? null;
  // An operator can MANDATE bands (Digi resolves them off the monthly
  // volume). Every other product may opt in per product — a band is just a
  // quantity range, and "the operator pays 70 € for one and 200 € for three"
  // is as true of a product with no operator attached as of a Digi one.
  const operatorRequiresTiers = !!operator && !!operator.commission_basis;
  const hasTiers = (product.quantity_tiers?.length ?? 0) > 0;
  // The product's own switch wins. Without one, the old rule: an operator
  // that resolves bands, or bands already configured, means tiered.
  const isTiered = product.tiered_commission ?? (operatorRequiresTiers || hasTiers);
  // Which quantity picks the band: the product says, else the operator.
  const tierBasis = product.tier_basis ?? operator?.commission_basis ?? 'per_sale';
  const tierScope = product.tier_scope ?? operator?.volume_scope ?? 'org_total';
  const scopeLabel = tierBasis === 'monthly_volume'
    ? (tierScope === 'org_total' ? 'volume mensal da organização' : 'volume mensal do vendedor')
    : 'nesta venda';
  return { operator, isTiered, operatorRequiresTiers, scopeLabel, tierBasis, tierScope };
}

export function OperatorField({
  product,
  operators,
  onCommit,
}: {
  product: CatalogProduct;
  operators: Operator[];
  onCommit: (updates: Partial<CatalogProduct>) => void;
}) {
  return (
    <TonedField tone="neutral" icon={<Radio className="h-3 w-3 shrink-0" />} label="Operadora">
      <Select
        value={product.operator_id ?? NO_OPERATOR}
        onValueChange={(v) => onCommit({ operator_id: v === NO_OPERATOR ? undefined : v })}
      >
        <SelectTrigger className={cn(tonedInputClass, 'w-full font-normal')}><SelectValue placeholder="Nenhuma" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_OPERATOR}>Nenhuma</SelectItem>
          {operators.map(op => (
            <SelectItem key={op.id} value={op.id}>{op.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </TonedField>
  );
}

export function PriceField({
  product,
  onChange,
  onCommit,
}: {
  product: CatalogProduct;
  onChange: (updates: Partial<CatalogProduct>) => void;
  onCommit: (updates: Partial<CatalogProduct>) => void;
}) {
  return (
    <TonedField tone="price" icon={<Tag className="h-3 w-3 shrink-0" />} label="Preço Base (€)">
      <Input
        type="number"
        step="0.01"
        min="0"
        value={product.price || ''}
        onChange={(e) => onChange({ price: parseFloat(e.target.value) || 0 })}
        onBlur={() => onCommit({})}
        placeholder="0.00"
        className={cn(tonedInputClass, 'w-full')}
      />
    </TonedField>
  );
}

/**
 * How many SIM cards one unit of this product already includes — e.g. a "2P"
 * package includes 2, while Alarme or Energia Residencial include 0. Rolled
 * up with the extra cards sold on the same line (see ExtraCardField) into
 * the client's total card count on their profile. Left blank, most products
 * count as 0 cards; a product priced by quantity (escalões) still defaults
 * to 1 per unit, matching how it always counted before this field existed.
 */
export function IncludedCardsField({
  product,
  onChange,
  onCommit,
}: {
  product: CatalogProduct;
  onChange: (updates: Partial<CatalogProduct>) => void;
  onCommit: (updates: Partial<CatalogProduct>) => void;
}) {
  return (
    <div className="space-y-1.5">
      <TonedField tone="cards" icon={<CreditCard className="h-3 w-3 shrink-0" />} label="Cartões incluídos">
        <Input
          type="number"
          step="1"
          min="0"
          value={product.included_cards ?? ''}
          onChange={(e) => onChange({ included_cards: parseInt(e.target.value, 10) || 0 })}
          onBlur={() => onCommit({})}
          placeholder="1"
          className={cn(tonedInputClass, 'w-full')}
        />
      </TonedField>
      <p className="text-[11px] text-muted-foreground">
        Quantos cartões já vêm incluídos em cada unidade vendida deste produto. Deixe em branco se este produto não representa cartões (ex.: Alarme, Energia).
        Soma-se aos cartões extra da venda para o total no perfil do cliente.
      </p>
    </div>
  );
}

/** The product pays extra SIM cards, flat or in one of its bands. */
function paysExtraCards(product: CatalogProduct): boolean {
  return (product.extra_card_commission ?? 0) > 0
    || (product.quantity_tiers ?? []).some((t) => (t.extra_card_commission ?? 0) > 0);
}

function hasExtraCardRate(product: CatalogProduct): boolean {
  return paysExtraCards(product)
    || (product.extra_card_operator_pays ?? 0) > 0
    || (product.quantity_tiers ?? []).some((t) => (t.extra_card_operator_pays ?? 0) > 0);
}

/**
 * Separate seller payout and operator contribution for each extra SIM card.
 */
export function ExtraCardField({
  product,
  onChange,
  onCommit,
}: {
  product: CatalogProduct;
  onChange: (updates: Partial<CatalogProduct>) => void;
  onCommit: (updates: Partial<CatalogProduct>) => void;
}) {
  return (
    <div className="space-y-1.5">
      <TonedField tone="commission" icon={<Wallet className="h-3 w-3 shrink-0" />} label="Comissão do vendedor por cartão extra (€)">
        <Input
          type="number"
          step="0.01"
          min="0"
          value={product.extra_card_commission || ''}
          onChange={(e) => onChange({ extra_card_commission: parseFloat(e.target.value) || 0 })}
          onBlur={() => onCommit({})}
          placeholder="0.00"
          className={cn(tonedInputClass, 'w-full')}
        />
      </TonedField>
      <TonedField tone="operator" icon={<Banknote className="h-3 w-3 shrink-0" />} label="Valor pago pela operadora por cartão extra (€)">
        <Input
          type="number"
          step="0.01"
          min="0"
          value={product.extra_card_operator_pays || ''}
          onChange={(e) => onChange({ extra_card_operator_pays: parseFloat(e.target.value) || 0 })}
          onBlur={() => onCommit({})}
          placeholder="0.00"
          className={cn(tonedInputClass, 'w-full')}
        />
      </TonedField>
      <p className="text-[11px] text-muted-foreground">
        São valores separados: a operadora acrescenta o valor indicado à comissão bruta, e o vendedor recebe a sua comissão por cartão extra.
      </p>
    </div>
  );
}

/**
 * What the operator pays the org per unit — the number the org's margin is
 * measured against. It had no field until now: the only way to set it was to
 * run SQL by hand. Only for products without escalões; a tiered product sets
 * it per band, where the operator's rate actually moves.
 */
export function OperatorPaysField({
  product,
  onChange,
  onCommit,
}: {
  product: CatalogProduct;
  onChange: (updates: Partial<CatalogProduct>) => void;
  onCommit: (updates: Partial<CatalogProduct>) => void;
}) {
  // One figure, whatever the technology: the operator pays the same for a
  // fibre install and a satellite one. (The seller's cut does differ, and
  // keeps its two columns in the commission lines.)
  const fields: { key: 'operator_pays'; label: string }[] =
    [{ key: 'operator_pays', label: 'Operadora paga (€)' }];

  return (
    <>
        {fields.map((f) => (
          <TonedField
            key={f.key}
            tone="operator"
            icon={<Banknote className="h-3 w-3 shrink-0" />}
            label={f.label}
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              value={product[f.key] ?? ''}
              onChange={(e) => onChange({ [f.key]: e.target.value ? parseFloat(e.target.value) : undefined })}
              onBlur={() => onCommit({})}
              placeholder="0.00"
              className={cn(tonedInputClass, 'w-full')}
            />
          </TonedField>
        ))}
    </>
  );
}

/** The one line under the header that says what "Operadora paga" means. */
export function OperatorPaysHint() {
  return (
    <p className="text-[11px] text-muted-foreground">
      Quanto a operadora paga à organização por unidade. A comissão do vendedor sai daqui; o que sobra
      é o Valor da Organização. Em branco, a venda não sabe dizer quanto fica para a empresa.
    </p>
  );
}

export function CommissionSection({
  product,
  operator,
  isTiered,
  operatorRequiresTiers,
  tierBasis,
  tierScope,
  scopeLabel,
  members,
  profiles,
  onChange,
  onCommit,
}: {
  product: CatalogProduct;
  operator: Operator | null;
  isTiered: boolean;
  operatorRequiresTiers: boolean;
  tierBasis: NonNullable<CatalogProduct['tier_basis']>;
  tierScope: NonNullable<CatalogProduct['tier_scope']>;
  scopeLabel: string;
  members: Member[];
  profiles: Profile[];
  onChange: (updates: Partial<CatalogProduct>) => void;
  onCommit: (updates: Partial<CatalogProduct>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label className="text-sm font-medium">Comissão</Label>
        {/* The same switch on every product, Digi included. ON keeps the
            bands stored while showing them; OFF keeps them stored while the
            calculator ignores them — flipping back loses nothing. */}
        <div className="flex items-center gap-2">
          <Switch
            id="tiered-commission"
            checked={isTiered}
            onCheckedChange={(on) => {
              if (on) {
                const existing = product.quantity_tiers ?? [];
                onCommit({
                  tiered_commission: true,
                  quantity_tiers: existing.length > 0 ? existing : [{
                    id: crypto.randomUUID(),
                    min: 1,
                    max: null,
                    price: product.price,
                    operator_pays: product.operator_pays,
                    operator_pays_fibra: product.operator_pays_fibra,
                    operator_pays_satelite: product.operator_pays_satelite,
                    splits: product.splits ?? [],
                  }],
                });
              } else {
                // Flat lines start from the first band when there are none yet.
                const first = product.quantity_tiers?.[0];
                const seedSplits = (product.splits?.length ?? 0) === 0 && first ? first.splits : undefined;
                onCommit({
                  tiered_commission: false,
                  ...(seedSplits ? { splits: seedSplits, ...deriveCommissionFields(seedSplits) } : {}),
                });
              }
            }}
          />
          <Label htmlFor="tiered-commission" className="text-xs text-muted-foreground">
            Comissão por escalão de quantidade
          </Label>
        </div>
        {/* Which quantity the band is read off. Per sale: this sale's own
            units decide its band, bonus included. Per month: the running
            monthly total decides, and earlier sales that month are re-banded
            when the total climbs — what Digi does. */}
        {isTiered && (
          <Select
            value={tierBasis === 'monthly_volume' ? `monthly_${tierScope}` : 'per_sale'}
            onValueChange={(v) =>
              onCommit(
                v === 'per_sale'
                  ? { tier_basis: 'per_sale' }
                  : { tier_basis: 'monthly_volume', tier_scope: v === 'monthly_org_total' ? 'org_total' : 'per_seller' },
              )
            }
          >
            <SelectTrigger className="h-8 w-full text-xs sm:w-[300px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="per_sale">Quantidade conta por venda</SelectItem>
              <SelectItem value="monthly_org_total">Quantidade conta ao mês — organização</SelectItem>
              <SelectItem value="monthly_per_seller">Quantidade conta ao mês — por vendedor</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Only an UNCLASSIFIED product of an energy operator still goes to the
          Matriz. Once it carries a type, the type's shape wins — Energia and
          Gás are "the operator pays X, the seller gets Y", like fibre. */}
      {operator?.kind === 'energia' && !isTiered && !(product.type_ids?.length) ? (
        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          Este produto usa a operadora <strong>{operator.name}</strong> (energia) — a comissão configura-se em
          Matriz de Comissões, não aqui.
        </div>
      ) : isTiered ? (
        <QuantityTiersEditor
          tiers={product.quantity_tiers ?? []}
          members={members}
          profiles={profiles}
          basePrice={product.price}
          scopeLabel={scopeLabel}
          onChange={(quantity_tiers: QuantityTier[]) => onChange({ quantity_tiers })}
          onCommit={(quantity_tiers: QuantityTier[]) => onCommit({ quantity_tiers })}
          technologies={productTechnologies(product)}
          showCards={sellsCards(product)}
          extraCards={paysExtraCards(product)}
        />
      ) : (
        <CommissionSplitsEditor
          splits={product.splits ?? []}
          members={members}
          profiles={profiles}
          onChange={(splits: CommissionSplit[]) => onChange({ splits, ...deriveCommissionFields(splits) })}
          onCommit={(splits: CommissionSplit[]) => onCommit({ splits, ...deriveCommissionFields(splits) })}
          technologies={productTechnologies(product)}
          extraCards={paysExtraCards(product)}
        />
      )}


      {/* Opting a plain product into quantity bands. The first band inherits
          everything already configured, so nothing has to be retyped and the
          product keeps paying exactly what it paid a second ago. */}


      {/* SIM cards only make sense on a product of the Cartões type. A
          product nobody has classified yet keeps the fields, as before. */}
      {sellsCards(product) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <IncludedCardsField product={product} onChange={onChange} onCommit={onCommit} />
          {hasExtraCardRate(product) && <ExtraCardField product={product} onChange={onChange} onCommit={onCommit} />}
        </div>
      )}
    </div>
  );
}

interface ProductCommissionFieldsProps {
  product: CatalogProduct;
  operators: Operator[];
  members: Member[];
  profiles: Profile[];
  onChange: (updates: Partial<CatalogProduct>) => void;
  onCommit: (updates: Partial<CatalogProduct>) => void;
}

/**
 * Operadora + Preço Base side by side, then the commission editor below.
 * Used as-is by the edit dialog (name isn't editable there, so this order is
 * fine); the create dialog composes OperatorField/PriceField/CommissionSection
 * itself instead, since Nome needs to sit between Operadora and Preço there.
 */
/**
 * Which product types this product belongs to.
 *
 * Multi-select on purpose: a package that carries fibre AND SIM cards is
 * both, and gets paid for both. Two types marked as alternatives (Fibra vs
 * Satélite) may be picked together — the sale then chooses between them.
 */
export function ProductTypesField({
  product,
  onCommit,
  hint = true,
}: {
  product: CatalogProduct;
  onCommit: (updates: Partial<CatalogProduct>) => void;
  /** The explanatory sentence under the chips — off inside the pinned header. */
  hint?: boolean;
}) {
  const { active, byId } = useProductTypes();
  const selected = new Set(product.type_ids ?? []);
  // An archived type stays visible while this product still carries it.
  const shown = [
    ...active,
    ...(product.type_ids ?? [])
      .filter((id) => !active.some((t) => t.id === id))
      .map((id) => byId.get(id))
      .filter((t): t is NonNullable<typeof t> => !!t),
  ];

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onCommit({ type_ids: [...next] });
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Tags className="h-3.5 w-3.5" />
        Tipos
      </Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {shown.map((t) => {
          const on = selected.has(t.id);
          return (
            <Toggle
              key={t.id}
              size="sm"
              variant="outline"
              pressed={on}
              onPressedChange={() => toggle(t.id)}
              className={cn(
                'h-8 rounded-full px-3 text-xs font-medium',
                on
                  ? 'border-primary/40 bg-primary/10 text-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary'
                  : 'border-dashed text-muted-foreground',
              )}
            >
              {t.name}
              {t.archived && ' (arquivado)'}
            </Toggle>
          );
        })}
      </div>
      {hint && (
        <p className="text-[11px] text-muted-foreground">
          O tipo decide a forma da comissão e é por ele que a venda começa. Um produto pode ter mais do que um —
          um pacote que leve fibra e cartões paga os dois.
        </p>
      )}
    </div>
  );
}

/**
 * The product's identity and its default figures: types, operator, price,
 * what the operator pays. Both dialogs render this ABOVE their scroll box,
 * so it stays put while the commission bands scroll underneath — a plain
 * header, not a sticky element, which had content bleeding through it.
 */
export function ProductHeaderFields({
  product,
  operators,
  onChange,
  onCommit,
}: {
  product: CatalogProduct;
  operators: Operator[];
  onChange: (updates: Partial<CatalogProduct>) => void;
  onCommit: (updates: Partial<CatalogProduct>) => void;
}) {
  return (
    <>
      <ProductTypesField product={product} onCommit={onCommit} hint={false} />
      {/* One row, equal boxes: who sells it, what the client pays, what the
          operator pays. On a tiered product these are the defaults a band may override. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <OperatorField product={product} operators={operators} onCommit={onCommit} />
        <PriceField product={product} onChange={onChange} onCommit={onCommit} />
        <OperatorPaysField product={product} onChange={onChange} onCommit={onCommit} />
      </div>
    </>
  );
}

export function ProductCommissionFields({
  product,
  operators,
  members,
  profiles,
  onChange,
  onCommit,
}: ProductCommissionFieldsProps) {
  const { operator, isTiered, operatorRequiresTiers, scopeLabel, tierBasis, tierScope } = useProductOperatorContext(product, operators);

  return (
    <>
      {/* The header (types, operator, price, operator pays) is rendered by
          the dialog above its scroll box — see ProductHeaderFields. */}
      {/* One sentence, not two: on a tiered product the defaults note
          already says what the figures above are for. */}
      {!isTiered && <OperatorPaysHint />}
      {isTiered && (
        <p className="text-xs text-muted-foreground -mt-3">
          Preço e "Operadora paga" acima são os valores por defeito. Cada escalão abaixo pode ter os seus, e esses ganham.
        </p>
      )}
      <CommissionSection
        product={product}
        operator={operator}
        isTiered={isTiered}
        operatorRequiresTiers={operatorRequiresTiers}
        tierBasis={tierBasis}
        tierScope={tierScope}
        scopeLabel={scopeLabel}
        members={members}
        profiles={profiles}
        onChange={onChange}
        onCommit={onCommit}
      />
    </>
  );
}
