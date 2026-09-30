import { Trash2, User, Shield, Wallet, CreditCard } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { TonedField, tonedInputClass } from './FieldTone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  TELECOM_TECHNOLOGIES,
  TELECOM_TECHNOLOGY_LABELS,
  productNeedsTechnologyChoice,
  splitTypeForTech,
  type CommissionSplit,
  type TelecomTechnology,
} from '@/types/proposals';

interface Member {
  user_id: string;
  full_name: string;
}

interface Profile {
  id: string;
  name: string;
}

interface CommissionSplitRowProps {
  split: CommissionSplit;
  members: Member[];
  profiles: Profile[];

  onChange: (updates: Partial<CommissionSplit>, commit?: boolean) => void;
  onCommit: () => void;
  onRemove: () => void;
  /** Extra field rendered on the same line, before the remove button (e.g. a tier's Bónus Geral). */
  trailing?: React.ReactNode;
  /** Which technologies the product is sold as. Two of them split the value into one box each. */
  technologies?: TelecomTechnology[];
  /** The product pays extra SIM cards: show whether this recipient gets them. */
  extraCards?: boolean;
}

/** One "who gets paid, how much" line — Tipo / Quem recebe / Valor / remove. Shared
 * between the flat commission editor and each quantity-tier's recipient list. */
export function CommissionSplitRow({
  split,
  members,
  profiles,

  onChange,
  onCommit,
  onRemove,
  trailing,
  technologies,
  extraCards,
}: CommissionSplitRowProps) {
  const byTech = productNeedsTechnologyChoice(technologies);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <TonedField tone="neutral" label="Tipo">
        <Select
          value={split.kind}
          onValueChange={(v) =>
            onChange(
              // Switching kind clears the other side's reference.
              v === 'user'
                ? { kind: 'user', profile_id: undefined }
                : { kind: 'profile', user_id: undefined },
              true,
            )
          }
        >
          <SelectTrigger className={cn(tonedInputClass, 'w-[110px] font-normal')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="user">
              <span className="flex items-center gap-1.5">
                <User className="h-3 w-3" />
                Pessoa
              </span>
            </SelectItem>
            <SelectItem value="profile">
              <span className="flex items-center gap-1.5">
                <Shield className="h-3 w-3" />
                Perfil
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      </TonedField>

      <TonedField
        tone="neutral"
        label={split.kind === 'user' ? 'Quem recebe' : 'Perfil do vendedor'}
        className="flex-1 min-w-[160px]"
      >
        {split.kind === 'user' ? (
          <Select value={split.user_id || ''} onValueChange={(v) => onChange({ user_id: v }, true)}>
            <SelectTrigger className={cn(tonedInputClass, 'w-full font-normal')}>
              <SelectValue placeholder="Escolher pessoa..." />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Select value={split.profile_id || ''} onValueChange={(v) => onChange({ profile_id: v }, true)}>
            <SelectTrigger className={cn(tonedInputClass, 'w-full font-normal')}>
              <SelectValue placeholder="Escolher perfil..." />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </TonedField>

      {/* One box per technology when the product is sold as both: the same
          recipient is paid a different rate for a fibre install than for a
          satellite one. A per-technology box left empty falls back to the
          single value, so switching a product to "ambos" never zeroes a rate
          that was already configured. */}
      {byTech && (
        <div className="flex items-end gap-2">
          {TELECOM_TECHNOLOGIES.map((tech) => {
            const field = tech === 'fibra' ? 'value_fibra' : 'value_satelite';
            const typeField = tech === 'fibra' ? 'type_fibra' : 'type_satelite';
            const shown = split[field] ?? split.value;
            // Each technology carries its own €/% mode: the same operator
            // often pays a flat fee on fibre and a percentage on satellite.
            const mode = splitTypeForTech(split, tech);
            return (
              /* A satellite percentage is a cut of THIS line's own fibre rate,
                 not of what the operator pays — say so, or the same "30" reads
                 as two different numbers. */
              <TonedField
                key={tech}
                tone="commission"
                icon={<Wallet className="h-3 w-3 shrink-0" />}
                label={`${TELECOM_TECHNOLOGY_LABELS[tech]} ${mode === 'fixed' ? '(€)' : tech === 'satelite' ? '(% da fibra)' : '(%)'}`}
              >
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    step={mode === 'fixed' ? '0.01' : '0.1'}
                    min="0"
                    max={mode === 'fixed' ? undefined : '100'}
                    value={shown || ''}
                    onChange={(e) => onChange({ [field]: parseFloat(e.target.value) || 0 })}
                    onBlur={onCommit}
                    placeholder="0"
                    className={cn(tonedInputClass, 'w-[72px]')}
                  />
                  <div className="flex overflow-hidden rounded-md border shrink-0">
                    {(['fixed', 'pct'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => onChange({ [typeField]: m }, true)}
                        className={cn(
                          'px-1.5 py-1 text-[11px] leading-4 transition-colors',
                          mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                        )}
                      >
                        {m === 'fixed' ? '€' : '%'}
                      </button>
                    ))}
                  </div>
                </div>
              </TonedField>
            );
          })}
        </div>
      )}

      {/* Only for a product with a single technology — when it is sold as
          both, each technology above carries its own value AND its own €/%. */}
      {!byTech && (
      <TonedField
        tone="commission"
        icon={<Wallet className="h-3 w-3 shrink-0" />}
        label={split.type === 'fixed' ? 'Comissão (€)' : 'Comissão (%)'}
      >
        <div className="flex items-center gap-1">
          {!byTech && (
            <Input
              type="number"
              step={split.type === 'fixed' ? '0.01' : '0.1'}
              min="0"
              max={split.type === 'fixed' ? undefined : '100'}
              value={split.value || ''}
              onChange={(e) => onChange({ value: parseFloat(e.target.value) || 0 })}
              onBlur={onCommit}
              placeholder="0"
              className={cn(tonedInputClass, 'w-[90px]')}
            />
          )}
          <div className="flex overflow-hidden rounded-md border shrink-0">
            <button
              type="button"
              onClick={() => onChange({ type: 'fixed' }, true)}
              className={cn(
                'px-2 py-1 text-[11px] leading-4 transition-colors',
                split.type === 'fixed' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              €
            </button>
            <button
              type="button"
              onClick={() => onChange({ type: 'pct' }, true)}
              className={cn(
                'px-2 py-1 text-[11px] leading-4 transition-colors',
                split.type === 'pct' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              %
            </button>
          </div>
        </div>
      </TonedField>
      )}

      {/* The org pays extra cards out of its own margin, so someone already
          paid the operator's whole amount must not get them. On by default:
          absent means the seller gets the extra, as before. */}
      {extraCards && (
        <TonedField tone="cards" icon={<CreditCard className="h-3 w-3 shrink-0" />} label="Cartões extra">
          <div className="flex h-8 items-center">
            <Switch
              checked={split.extra_cards !== false}
              onCheckedChange={(on) => onChange({ extra_cards: on ? undefined : false }, true)}
              aria-label="Recebe a comissão dos cartões extra"
            />
          </div>
        </TonedField>
      )}

      {trailing}

      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}
