import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { invalidateSaleFinance } from '@/lib/sale-finance-cache';
import { formatCurrency } from '@/lib/format';
import {
  FORMULA_ERROR_MESSAGES,
  draftFromSale,
  draftToFormula,
  evaluateFormula,
  manualCommissionErrorMessage,
  type DraftToken,
  type FormulaToken,
} from '@/lib/manual-commission';
import { ManualCommissionEditor } from './ManualCommissionEditor';
import { useLanguage } from '@/i18n';

const REASON_MIN = 3;
const REASON_MAX = 500;

/**
 * Correct (or enter) the manual-commission sum of one sale line, with a
 * mandatory reason. update_sale_manual_commission recomputes the value,
 * updates the sale and its splits, and logs the change with the reason.
 */
export function ManualCommissionCorrectDialog({ open, onOpenChange, saleId, product, formula, template, currentAmount }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly saleId: string;
  readonly product: string;
  readonly formula: FormulaToken[] | null | undefined;
  readonly template: FormulaToken[] | null | undefined;
  readonly currentAmount: number;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<DraftToken[]>(() => draftFromSale(formula, template));
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setDraft(draftFromSale(formula, template)); setReason(''); setAttempted(false); }
    // Reset each time it opens, from what the sale has now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const result = evaluateFormula(draft);
  const trimmed = reason.trim();
  const reasonError = trimmed.length < REASON_MIN ? t('Indique o motivo da correção.') : trimmed.length > REASON_MAX ? t('O motivo pode ter no máximo 500 caracteres.') : null;
  const unchanged = JSON.stringify(draftToFormula(draft)) === JSON.stringify(formula ?? null);

  const save = async () => {
    setAttempted(true);
    const next = draftToFormula(draft);
    if (!next) { toast.error(t(FORMULA_ERROR_MESSAGES[result.error ?? 'blank'])); return; }
    if (reasonError) return;
    setSaving(true);
    try {
      // Not in the generated types until the migration is applied.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc('update_sale_manual_commission', {
        p_sale_id: saleId, p_product: product, p_formula: next, p_reason: trimmed,
      });
      if (error) throw error;
      invalidateSaleFinance(queryClient);
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      toast.success(t('Comissão corrigida. A alteração ficou no histórico.'));
      onOpenChange(false);
    } catch (error) {
      toast.error(manualCommissionErrorMessage(error) ?? t('Não foi possível corrigir a comissão. Tente novamente.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{formula?.length ? t('Corrigir a conta da comissão') : t('Lançar a conta da comissão')}</DialogTitle>
          <DialogDescription>
            {product} · {t('Hoje: {{value}}', { value: formatCurrency(currentAmount) })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ManualCommissionEditor mode="sale" tokens={draft} onChange={setDraft} lockedShape={!!template?.length} showErrors={attempted} disabled={saving} />
          <div className="space-y-1.5">
            <Label htmlFor="manual-commission-reason">{t('Motivo')}</Label>
            <Textarea id="manual-commission-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX + 50} rows={3}
              placeholder={t('Ex.: valor do contrato corrigido pelo cliente')} disabled={saving}
              aria-invalid={attempted && !!reasonError} aria-describedby="manual-commission-reason-help"
              className={attempted && reasonError ? 'border-destructive focus-visible:ring-destructive' : undefined} />
            <p id="manual-commission-reason-help" className={attempted && reasonError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
              {attempted && reasonError ? reasonError : t('Fica no histórico da venda, com o seu nome e a hora.')}
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('Cancelar')}</Button>
          <Button type="button" onClick={save} disabled={saving || unchanged}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('Guardar correção')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
