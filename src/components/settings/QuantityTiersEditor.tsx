import { Banknote, CreditCard, Gift, Plus, Tag, Wallet, X } from 'lucide-react';
import { TonedField, tonedInputClass } from './FieldTone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { CommissionSplitRow } from './CommissionSplitRow';
import {  TELECOM_TECHNOLOGIES,  TELECOM_TECHNOLOGY_LABELS,  productNeedsTechnologyChoice,  type CommissionSplit,  type QuantityTier,  type TelecomTechnology,} from '@/types/proposals';

interface Member {
  user_id: string;
  full_name: string;
}

interface Profile {
  id: string;
  name: string;
}

interface QuantityTiersEditorProps {
  tiers: QuantityTier[];
  members: Member[];
  profiles: Profile[];
  /** Product's flat price — shown as the placeholder when a band has no price override of its own. */
  basePrice: number;
  /** Explains what the quantity is counted against ("nesta venda" or "no mês, por vendedor"...). */
  scopeLabel: string;
  onChange: (tiers: QuantityTier[]) => void;
  onCommit: (tiers: QuantityTier[]) => void;
  /** Which technologies the product is sold as — drives one rate box per technology. */
  technologies?: TelecomTechnology[];
  /** Product of the Cartões type: each band may include a different number of SIMs. */
  showCards?: boolean;
  /** The product (or a band) pays extra SIM cards — each line shows whether its person gets them. */
  extraCards?: boolean;
}

/**
 * Quantity bands for a product linked to a 'per_sale'/'monthly_volume' telecom
 * operator. Each band is one compact row (De/Até + who gets paid + valor) —
 * a band almost always pays one person, so that is the row you see by
 * default; "+ juntar mais alguém" only appears when you actually need a
 * second recipient in the same band, instead of a permanently-visible second
 * "add" button that reads as a sibling of "Adicionar escalão".
 */
export function QuantityTiersEditor({
  tiers,
  members,
  profiles,
  basePrice,
  scopeLabel,
  onChange,
  onCommit,
  technologies,
  showCards = false,
  extraCards = false,
}: QuantityTiersEditorProps) {
  const byTech = productNeedsTechnologyChoice(technologies);
  const addTier = () => {
    const lastMax = tiers.length > 0 ? tiers[tiers.length - 1].max : 0;
    const nextMin = (lastMax ?? 0) + 1;
    onCommit([...tiers, {
      id: crypto.randomUUID(),
      min: nextMin,
      max: null,
      splits: [{ kind: 'user', type: 'fixed', value: 0 }],
    }]);
  };

  const updateTier = (id: string, updates: Partial<QuantityTier>, commit = false) => {
    const next = tiers.map(t => (t.id === id ? { ...t, ...updates } : t));
    if (commit) onCommit(next);
    else onChange(next);
  };

  const removeTier = (id: string) => {
    onCommit(tiers.filter(t => t.id !== id));
  };

  const updateSplit = (tierId: string, index: number, updates: Partial<CommissionSplit>, commit = false) => {
    const tier = tiers.find(t => t.id === tierId);
    if (!tier) return;
    const nextSplits = tier.splits.map((s, i) => (i === index ? { ...s, ...updates } : s));
    updateTier(tierId, { splits: nextSplits }, commit);
  };

  const addSplit = (tierId: string) => {
    const tier = tiers.find(t => t.id === tierId);
    if (!tier) return;
    updateTier(tierId, { splits: [...tier.splits, { kind: 'user', type: 'fixed', value: 0 }] }, true);
  };

  const removeSplit = (tierId: string, index: number) => {
    const tier = tiers.find(t => t.id === tierId);
    if (!tier) return;
    updateTier(tierId, { splits: tier.splits.filter((_, i) => i !== index) }, true);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Escalões por quantidade ({scopeLabel})</Label>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={addTier}>
          <Plus className="h-3 w-3 mr-1" />
          Adicionar escalão
        </Button>
      </div>

      {tiers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Sem escalões configurados. Sem eles, nenhuma comissão é gerada para este produto.
        </p>
      ) : (
        <div className="space-y-2">
          {tiers.map((tier) => (
            <div key={tier.id} className="rounded-lg border bg-muted/20 p-2.5 space-y-2">
              {/* Wraps on purpose: with two technologies this row carries six
                  fields, and without wrapping the "Operadora paga" boxes were
                  simply cut off the right edge of the dialog. */}
              <div className="flex flex-wrap items-end gap-2">
                {/* First in the row and in its own tinted box: this is the
                    operator's money, and every commission below is carved out
                    of it. Sitting last among identical grey inputs, it went
                    unnoticed — the person configuring the product never saw it. */}
                {/* One box: the operator pays the same on fibre and satellite. */}
                {([null] as (TelecomTechnology | null)[]).map((tech) => {
                  const field = tech === "fibra" ? "operator_pays_fibra"
                    : tech === "satelite" ? "operator_pays_satelite" : "operator_pays";
                  return (
                    <TonedField
                      key={field}
                      tone="operator"
                      icon={<Banknote className="h-3 w-3 shrink-0" />}
                      label={tech ? `Operadora paga · ${TELECOM_TECHNOLOGY_LABELS[tech]} (€)` : "Operadora paga (€)"}
                    >
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={tier[field] ?? ""}
                        onChange={(e) => updateTier(tier.id, { [field]: e.target.value ? parseFloat(e.target.value) : undefined })}
                        onBlur={() => onCommit(tiers)}
                        className={cn(tonedInputClass, 'w-28')}
                      />
                    </TonedField>
                  );
                })}
                <TonedField tone="neutral" label="De (unid.)">
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={tier.min || ''}
                    onChange={(e) => updateTier(tier.id, { min: parseInt(e.target.value, 10) || 1 })}
                    onBlur={() => onCommit(tiers)}
                    className={cn(tonedInputClass, 'w-20')}
                  />
                </TonedField>
                <TonedField tone="neutral" label="Até (unid.)">
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="∞"
                    value={tier.max ?? ''}
                    onChange={(e) => updateTier(tier.id, { max: e.target.value ? parseInt(e.target.value, 10) : null })}
                    onBlur={() => onCommit(tiers)}
                    className={cn(tonedInputClass, 'w-20')}
                  />
                </TonedField>
                <TonedField
                  tone="price"
                  icon={<Tag className="h-3 w-3 shrink-0" />}
                  label="Preço de Venda (€)"
                >
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={basePrice ? basePrice.toFixed(2) : '0.00'}
                    value={tier.price ?? ''}
                    onChange={(e) => updateTier(tier.id, { price: e.target.value ? parseFloat(e.target.value) : undefined })}
                    onBlur={() => onCommit(tiers)}
                    className={cn(tonedInputClass, 'w-24')}
                  />
                </TonedField>
                {showCards && (
                  <>
                    <TonedField tone="cards" icon={<CreditCard className="h-3 w-3 shrink-0" />} label="Cartões incluídos">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="produto"
                        value={tier.included_cards ?? ''}
                        onChange={(e) => updateTier(tier.id, { included_cards: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                        onBlur={() => onCommit(tiers)}
                        className={cn(tonedInputClass, 'w-20')}
                      />
                    </TonedField>
                    <TonedField tone="commission" icon={<Wallet className="h-3 w-3 shrink-0" />} label="Vendedor / cartão extra (€)">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="produto"
                        value={tier.extra_card_commission ?? ''}
                        onChange={(e) => updateTier(tier.id, { extra_card_commission: e.target.value ? parseFloat(e.target.value) : undefined })}
                        onBlur={() => onCommit(tiers)}
                        className={cn(tonedInputClass, 'w-24')}
                      />
                    </TonedField>
                    <TonedField tone="operator" icon={<Banknote className="h-3 w-3 shrink-0" />} label="Operadora / cartão extra (€)">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="produto"
                        value={tier.extra_card_operator_pays ?? ''}
                        onChange={(e) => updateTier(tier.id, { extra_card_operator_pays: e.target.value ? parseFloat(e.target.value) : undefined })}
                        onBlur={() => onCommit(tiers)}
                        className={cn(tonedInputClass, 'w-24')}
                      />
                    </TonedField>
                  </>
                )}
                <div className="flex-1 min-w-0" />
                {/* The bonus belongs to the band, so it lives on the band's row:
                    a switch, and the amount only while it is on. */}
                <div className="flex items-center gap-1.5 self-center pt-3">
                  <Switch
                    id={`bonus-${tier.id}`}
                    className="scale-75"
                    checked={tier.bonus_enabled ?? ((tier.bonus ?? 0) > 0)}
                    onCheckedChange={(on) => updateTier(tier.id, { bonus_enabled: on }, true)}
                  />
                  <Label htmlFor={`bonus-${tier.id}`} className="text-[10px] text-muted-foreground">Bónus</Label>
                </div>
                {(tier.bonus_enabled ?? ((tier.bonus ?? 0) > 0)) && (
                  <BonusField tier={tier} onCommit={() => onCommit(tiers)} updateTier={updateTier} />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  title="Eliminar escalão"
                  onClick={() => removeTier(tier.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="ml-1 pl-3 border-l-2 border-border space-y-1.5">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <Label className="text-[10px] font-medium text-foreground">Comissão</Label>
                  <p className="text-xs text-muted-foreground">
                    {tier.max == null
                      ? `A partir de ${tier.min} unidades`
                      : tier.min <= 1
                        ? `Até ${tier.max} unidades`
                        : `De ${tier.min} até ${tier.max} unidades`}
                    {tier.price != null && ` — ${tier.price.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} €/unid.`}
                    {tier.operator_pays != null && (
                      <span className="font-medium text-amber-700 dark:text-amber-400">
                        {` · a operadora paga ${tier.operator_pays.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} €/unid.`}
                      </span>
                    )}

                    {!!tier.bonus && (
                      tier.bonus_type === 'pct'
                        ? ` + bónus único de ${tier.bonus.toLocaleString('pt-PT', { minimumFractionDigits: 2 })}% da comissão ao atingir`
                        : ` + bónus único de ${tier.bonus.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} € ao atingir`
                    )}
                  </p>
                </div>
                {tier.splits.length === 0 ? (
                  <>
                    <p className="text-xs text-muted-foreground">Sem comissão — ninguém recebe por este escalão.</p>

                  </>
                ) : (
                  tier.splits.map((split, index) => (
                    <CommissionSplitRow
                      key={index}
                      split={split}
                      members={members}
                      profiles={profiles}
                      technologies={technologies}
                      extraCards={extraCards}
                      onChange={(updates, commit) => updateSplit(tier.id, index, updates, commit)}
                      onCommit={() => onCommit(tiers)}
                      onRemove={() => removeSplit(tier.id, index)}

                    />
                  ))
                )}
                <button
                  type="button"
                  className="text-[11px] font-medium text-primary hover:underline"
                  onClick={() => addSplit(tier.id)}
                >
                  + juntar mais alguém a este escalão
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tier-wide one-off reward — rendered inline on the first commission row (see `trailing` above). */
function BonusField({
  tier,
  updateTier,
  onCommit,
}: {
  tier: QuantityTier;
  updateTier: (id: string, updates: Partial<QuantityTier>, commit?: boolean) => void;
  onCommit: () => void;
}) {
  const bonusType = tier.bonus_type ?? 'fixed';
  return (
    <TonedField tone="bonus" icon={<Gift className="h-3 w-3 shrink-0" />} label="Bónus Geral">
      <div className="flex items-center gap-1">
        <Input
          type="number"
          step={bonusType === 'fixed' ? '0.01' : '0.1'}
          min="0"
          max={bonusType === 'pct' ? '100' : undefined}
          placeholder="0"
          value={tier.bonus ?? ''}
          onChange={(e) => updateTier(tier.id, { bonus: e.target.value ? parseFloat(e.target.value) : undefined })}
          onBlur={onCommit}
          className={cn(tonedInputClass, 'w-20')}
        />
        <div className="flex overflow-hidden rounded-md border shrink-0">
          <button
            type="button"
            onClick={() => updateTier(tier.id, { bonus_type: 'fixed' }, true)}
            className={cn(
              'px-2 py-1 text-[11px] leading-4 transition-colors',
              bonusType === 'fixed' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            €
          </button>
          <button
            type="button"
            onClick={() => updateTier(tier.id, { bonus_type: 'pct' }, true)}
            className={cn(
              'px-2 py-1 text-[11px] leading-4 transition-colors',
              bonusType === 'pct' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            %
          </button>
        </div>
      </div>
    </TonedField>
  );
}
