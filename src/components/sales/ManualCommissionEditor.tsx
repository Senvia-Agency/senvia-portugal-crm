import { useEffect, useId, useState } from 'react';
import { Calculator, Lock, PenLine, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format';
import { intlLocale, useLanguage } from '@/i18n';
import {
  FORMULA_ERROR_MESSAGES,
  MAX_FORMULA_NUMBERS,
  OP_SYMBOL,
  evaluateFormula,
  isDraftEmpty,
  parseFormulaNumber,
  type DraftToken,
  type FormulaOp,
} from '@/lib/manual-commission';

const OPS: FormulaOp[] = ['+', '-', '*', '/'];
const OP_NAMES: Record<FormulaOp, string> = { '+': 'Somar', '-': 'Subtrair', '*': 'Multiplicar', '/': 'Dividir' };

/** One number box. Keeps the typed text while editing, so "0," is not swallowed. */
function NumberBox({ value, placeholder, disabled, invalid, onChange, ariaLabel }: {
  readonly value: number | null;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly onChange: (value: number | null) => void;
  readonly ariaLabel: string;
}) {
  const show = (v: number | null) => (v == null ? '' : new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 4, useGrouping: false }).format(v));
  const [text, setText] = useState(show(value));
  useEffect(() => {
    if (parseFormulaNumber(text) !== value) setText(show(value));
    // Only an outside change of the value resets the text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      inputMode="decimal"
      value={text}
      disabled={disabled}
      placeholder={placeholder ?? '0'}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      onChange={e => { setText(e.target.value); onChange(parseFormulaNumber(e.target.value)); }}
      className={cn('h-10 w-24 text-center tabular-nums', invalid && 'border-destructive focus-visible:ring-destructive')}
    />
  );
}

export interface ManualCommissionEditorProps {
  readonly tokens: DraftToken[];
  readonly onChange: (tokens: DraftToken[]) => void;
  /** 'sale': the seller fills the sum. 'template': an admin sets the service's model. */
  readonly mode: 'sale' | 'template';
  /** A sale whose service has a model: only the boxes can change. */
  readonly lockedShape?: boolean;
  /** Show errors on empty boxes (the person tried to save). */
  readonly showErrors?: boolean;
  /** On a sale, an untouched sum is allowed: it is entered later and pays 0 until then. */
  readonly allowEmpty?: boolean;
  readonly disabled?: boolean;
}

/**
 * Builds a sum with numbers and + − × ÷ and shows the result live. × and ÷ go
 * before + and −, as on a calculator. The database recomputes the same sum.
 */
export function ManualCommissionEditor({ tokens, onChange, mode, lockedShape, showErrors, allowEmpty, disabled }: ManualCommissionEditorProps) {
  const { t } = useLanguage();
  const resultId = useId();
  const isTemplate = mode === 'template';
  const canEditShape = !disabled && !lockedShape;
  // A model is checked with 1 in each box, just to show its shape works.
  const result = evaluateFormula(isTemplate ? tokens.map(tk => (tk.t === 'num' && tk.slot ? { ...tk, v: tk.v ?? 1 } : tk)) : tokens);
  const empty = !isTemplate && isDraftEmpty(tokens);
  const numbers = Math.ceil(tokens.length / 2);

  const update = (index: number, token: DraftToken) => onChange(tokens.map((tk, i) => (i === index ? token : tk)));
  const removeNumber = (index: number) => {
    if (tokens.length <= 1) { onChange([{ t: 'num', v: null }]); return; }
    const next = [...tokens];
    next.splice(index === 0 ? 0 : index - 1, 2);
    onChange(next);
  };
  const append = () => {
    if (numbers >= MAX_FORMULA_NUMBERS) return;
    onChange([...tokens, { t: 'op', v: '*' }, isTemplate ? { t: 'num', v: null, slot: true } : { t: 'num', v: null }]);
  };

  const quietErrors: string[] = ['blank', 'empty'];
  const showResultError = !result.ok && !(empty && allowEmpty) && (showErrors || !quietErrors.includes(result.error));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2" role="group" aria-label={isTemplate ? t('Modelo da conta') : t('Conta da comissão')} aria-describedby={resultId}>
        {tokens.map((token, index) => {
          if (token.t === 'op') {
            return (
              <Select key={index} value={token.v} disabled={!canEditShape} onValueChange={op => update(index, { t: 'op', v: op as FormulaOp })}>
                <SelectTrigger className="h-10 w-14 justify-center gap-1 px-2 text-base font-semibold" aria-label={t('Operação {{n}}', { n: (index + 1) / 2 })}>
                  <SelectValue>{OP_SYMBOL[token.v]}</SelectValue>
                </SelectTrigger>
                <SelectContent className="min-w-[9rem]">
                  {OPS.map(op => (
                    <SelectItem key={op} value={op}>
                      <span className="mr-2 inline-block w-4 text-center text-base font-semibold">{OP_SYMBOL[op]}</span>{t(OP_NAMES[op])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          }
          const position = index / 2 + 1;
          const removable = canEditShape && tokens.length > 1;
          // On a sale with a model, fixed numbers come from the model and stay.
          const fixedOnSale = !isTemplate && lockedShape && !token.slot;
          const invalid = !isTemplate && showErrors && token.v == null && !(allowEmpty && empty);
          const caption = isTemplate
            ? (token.slot ? t('Vendedor preenche') : t('Fixo'))
            : (token.label || (fixedOnSale ? t('Fixo') : t('Número {{n}}', { n: position })));
          return (
            <div key={index} className="flex flex-col gap-1">
              <span className="max-w-[7.5rem] truncate text-[11px] font-medium text-muted-foreground">{caption}</span>
              <div className="flex items-center gap-1">
                {isTemplate && token.slot ? (
                  <Input value={token.label ?? ''} disabled={disabled} maxLength={30}
                    onChange={e => update(index, { ...token, label: e.target.value || undefined })}
                    placeholder={t('Nome, ex.: Valor')} aria-label={t('Nome da caixa {{n}}', { n: position })}
                    className="h-10 w-28 border-dashed bg-muted/40 text-center text-xs" />
                ) : (
                  <NumberBox value={token.v} placeholder={token.label} disabled={disabled || fixedOnSale} invalid={invalid}
                    ariaLabel={token.label || t('Número {{n}}', { n: position })}
                    onChange={v => update(index, { ...token, v })} />
                )}
                {isTemplate && !disabled && (
                  <button type="button" aria-pressed={!token.slot}
                    onClick={() => update(index, token.slot ? { t: 'num', v: token.v ?? 0 } : { t: 'num', v: null, label: token.label, slot: true })}
                    title={token.slot ? t('Fixar este número') : t('Deixar o vendedor preencher')}
                    aria-label={token.slot ? t('Fixar o número {{n}}', { n: position }) : t('Deixar o vendedor preencher o número {{n}}', { n: position })}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {token.slot ? <PenLine className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                  </button>
                )}
                {removable && (
                  <button type="button" onClick={() => removeNumber(index)} aria-label={t('Tirar o número {{n}} da conta', { n: position })}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {canEditShape && (
          <Button type="button" variant="outline" size="sm" className="h-10" disabled={numbers >= MAX_FORMULA_NUMBERS} onClick={append}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />{t('Número')}
          </Button>
        )}
      </div>

      <div id={resultId} aria-live="polite"
        className={cn('flex items-center justify-between gap-3 rounded-lg border px-3 py-2',
          showResultError ? 'border-destructive/40 bg-destructive/5' : result.ok && !isTemplate ? 'border-primary/25 bg-primary/5' : 'bg-muted/40')}>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calculator className="h-4 w-4 shrink-0" />
          {isTemplate ? t('Modelo') : t('Comissão do vendedor')}
        </span>
        {showResultError && !result.ok ? (
          <span className="text-right text-xs font-medium text-destructive">{t(FORMULA_ERROR_MESSAGES[result.error])}</span>
        ) : isTemplate ? (
          <span className="text-right text-xs text-muted-foreground">{result.ok ? t('Conta válida. O vendedor preenche as caixas em cada venda.') : t('Complete o modelo')}</span>
        ) : result.ok ? (
          <span className="text-base font-semibold tabular-nums text-foreground">{formatCurrency(result.amount)}</span>
        ) : (
          <span className="text-right text-xs text-muted-foreground">{empty && allowEmpty ? t('Sem conta: a venda grava com 0 € e a conta é lançada depois') : t('Preencha os números')}</span>
        )}
      </div>
      {numbers > 1 && (
        <p className="text-[11px] text-muted-foreground">{t('Multiplicar e dividir contam antes de somar e subtrair, como numa calculadora.')}</p>
      )}
    </div>
  );
}
