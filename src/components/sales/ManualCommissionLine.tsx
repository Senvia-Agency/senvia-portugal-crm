import { useState } from 'react';
import { format } from 'date-fns';
import { Calculator, ChevronDown, History, PenLine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import { draftFromSale, evaluateFormula, formulaToText, type FormulaToken } from '@/lib/manual-commission';
import type { ManualCommissionChange } from '@/hooks/useManualCommissionChanges';
import { dateLocale, intlLocale, useLanguage } from '@/i18n';

function sumText(formula: FormulaToken[] | null | undefined): string | null {
  if (!formula?.length) return null;
  return formulaToText(draftFromSale(formula, null), intlLocale());
}

/**
 * The manual-commission sum of one sale line, with who changed it and when.
 * Correcting it opens the sale editor; the database logs each change.
 */
export function ManualCommissionLine({ formula, amount, weekly, payoutDate, changes, changesLoading, nameOf, onCorrect }: {
  readonly formula: FormulaToken[] | null | undefined;
  /** The value frozen on the line by the database. */
  readonly amount: number | null | undefined;
  readonly weekly: boolean;
  /** yyyy-MM-dd of the weekly payout, when known. */
  readonly payoutDate?: string | null;
  readonly changes: ManualCommissionChange[];
  readonly changesLoading?: boolean;
  readonly nameOf: (userId: string) => string;
  /** Absent when this person cannot edit the sale. */
  readonly onCorrect?: () => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const text = sumText(formula);
  const result = formula?.length ? evaluateFormula(draftFromSale(formula, null)) : null;
  const value = amount ?? (result?.ok ? result.amount : 0);

  return (
    <div className="mt-1.5 space-y-2 rounded-md border border-dashed border-primary/30 bg-background/60 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Calculator className="h-3.5 w-3.5 text-primary" />{t('Comissão manual')}
        </span>
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
          {weekly
            ? (payoutDate ? t('Semanal, paga a {{date}}', { date: format(new Date(`${payoutDate}T12:00:00`), 'EEEE dd/MM', { locale: dateLocale() }) }) : t('Semanal, fecha à sexta'))
            : t('Mensal')}
        </Badge>
      </div>
      {text ? (
        <p className="text-sm tabular-nums">
          <span className="text-muted-foreground">{text} = </span>
          <span className="font-semibold text-foreground">{formatCurrency(value)}</span>
        </p>
      ) : (
        <p className="text-sm text-amber-700 dark:text-amber-300">{t('Conta por lançar. Esta linha paga 0 € até alguém lançar a conta.')}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {onCorrect && (
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={onCorrect}>
            <PenLine className="mr-1.5 h-3.5 w-3.5" />{text ? t('Corrigir conta') : t('Lançar conta')}
          </Button>
        )}
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs text-muted-foreground" aria-expanded={open}>
              <History className="mr-1.5 h-3.5 w-3.5" />
              {t('Histórico')}{changes.length > 0 && ` (${changes.length})`}
              <ChevronDown className={cn('ml-1 h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1">
            {changesLoading ? (
              <div className="space-y-1.5"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
            ) : changes.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('Ainda sem alterações registadas.')}</p>
            ) : (
              <ol className="space-y-2 border-l pl-3">
                {changes.map(change => {
                  const before = sumText(change.old_formula);
                  const after = sumText(change.new_formula);
                  return (
                    <li key={change.id} className="text-xs">
                      <p className="text-muted-foreground">
                        {format(new Date(change.changed_at), "dd/MM/yyyy HH:mm", { locale: dateLocale() })}
                        {' · '}
                        <span className="font-medium text-foreground">{change.changed_by ? nameOf(change.changed_by) : t('Sistema')}</span>
                      </p>
                      {before == null && change.old_amount == null ? (
                        <p>{t('Lançou')} <span className="tabular-nums">{after ?? '—'}</span> = <span className="font-medium tabular-nums">{formatCurrency(change.new_amount ?? 0)}</span></p>
                      ) : (
                        <p className="tabular-nums">
                          <span className="text-muted-foreground line-through decoration-muted-foreground/60">{before ?? t('sem conta')} = {formatCurrency(change.old_amount ?? 0)}</span>
                          {' → '}
                          <span>{after ?? t('sem conta')} = </span><span className="font-medium">{formatCurrency(change.new_amount ?? 0)}</span>
                        </p>
                      )}
                      {change.reason && <p className="mt-0.5 text-muted-foreground">{t("Motivo:")} <span className="text-foreground">{change.reason}</span></p>}
                    </li>
                  );
                })}
              </ol>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}
