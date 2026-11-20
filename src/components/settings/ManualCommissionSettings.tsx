import { useEffect, useRef, useState } from 'react';
import { CalendarClock, Calculator, ListChecks } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ManualCommissionEditor } from '@/components/sales/ManualCommissionEditor';
import { draftFromTemplate, draftToTemplate, type DraftToken } from '@/lib/manual-commission';
import type { CatalogProduct } from '@/types/proposals';
import { useLanguage } from '@/i18n';

const DEFAULT_TEMPLATE: DraftToken[] = [
  { t: 'num', v: null, label: 'Valor', slot: true },
  { t: 'op', v: '*' },
  { t: 'num', v: 0.15 },
];

/**
 * How this product pays the seller: by the catalog rules or by a sum the
 * seller builds on the sale (optionally from a model), and monthly or weekly.
 * docs/comissao-manual-contrato.md.
 */
export function ManualCommissionSettings({ product, onCommit }: {
  readonly product: CatalogProduct;
  readonly onCommit: (updates: Partial<CatalogProduct>) => void;
}) {
  const { t } = useLanguage();
  const manual = !!product.manual_commission;
  const savedTemplate = product.manual_commission_template;
  const [draft, setDraft] = useState<DraftToken[]>(() => (savedTemplate?.length ? draftFromTemplate(savedTemplate) : DEFAULT_TEMPLATE));
  const useTemplate = !!savedTemplate?.length;
  const [templateOn, setTemplateOn] = useState(useTemplate);
  const template = draftToTemplate(draft);

  // The model is saved by itself, a moment after the last change, once valid.
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const templateKey = template ? JSON.stringify(template) : null;
  const pending = useRef<number | null>(null);
  const lastSaved = useRef(JSON.stringify(savedTemplate ?? null));
  useEffect(() => {
    if (!manual || !templateOn || !templateKey) return;
    const next = templateKey;
    if (next === lastSaved.current) return;
    if (pending.current) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      lastSaved.current = next;
      commitRef.current({ manual_commission_template: JSON.parse(next) });
    }, 700);
    return () => { if (pending.current) window.clearTimeout(pending.current); };
  }, [manual, templateOn, templateKey]);

  return (
    <section className="space-y-4 rounded-xl border p-4">
      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-sm font-semibold"><Calculator className="h-4 w-4 text-primary" />{t('Como se calcula a comissão')}</Label>
        <ToggleGroup type="single" variant="outline" value={manual ? 'manual' : 'rules'}
          onValueChange={(value) => { if (value) onCommit({ manual_commission: value === 'manual' }); }}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ToggleGroupItem value="rules" className="h-auto flex-col items-start gap-0.5 whitespace-normal px-3 py-2.5 text-left data-[state=on]:border-primary data-[state=on]:bg-primary/5">
            <span className="text-sm font-medium">{t('Pelas regras do catálogo')}</span>
            <span className="text-xs font-normal text-muted-foreground">{t('Linhas de comissão, escalões e cartões extra, como hoje.')}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="manual" className="h-auto flex-col items-start gap-0.5 whitespace-normal px-3 py-2.5 text-left data-[state=on]:border-primary data-[state=on]:bg-primary/5">
            <span className="text-sm font-medium">{t('Manual')}</span>
            <span className="text-xs font-normal text-muted-foreground">{t('O vendedor monta a conta na venda, com números e + − × ÷.')}</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {manual && (
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor={`template-${product.name}`} className="flex items-center gap-2 text-sm font-medium"><ListChecks className="h-4 w-4" />{t('Modelo de conta')}</Label>
              <p className="text-xs text-muted-foreground">{t('Opcional. Com modelo, o vendedor só preenche as caixas e não muda o resto da conta.')}</p>
            </div>
            <Switch id={`template-${product.name}`} checked={templateOn}
              onCheckedChange={(on) => {
                setTemplateOn(on);
                if (!on) { lastSaved.current = 'null'; onCommit({ manual_commission_template: null }); }
              }} />
          </div>
          {templateOn && (
            <ManualCommissionEditor mode="template" tokens={draft} onChange={setDraft} />
          )}
          {templateOn && !template && (
            <p className="text-xs text-destructive">{t('Preencha os números fixos para o modelo ficar guardado.')}</p>
          )}
        </div>
      )}

      <div className="space-y-2 border-t pt-4">
        <Label className="flex items-center gap-2 text-sm font-medium"><CalendarClock className="h-4 w-4" />{t('Pagamento da comissão')}</Label>
        <ToggleGroup type="single" variant="outline" value={product.commission_payout === 'weekly' ? 'weekly' : 'monthly'}
          onValueChange={(value) => { if (value) onCommit({ commission_payout: value as 'monthly' | 'weekly' }); }}
          className="grid grid-cols-2 gap-2 sm:max-w-md">
          <ToggleGroupItem value="monthly" className="data-[state=on]:border-primary data-[state=on]:bg-primary/5">{t('Mensal')}</ToggleGroupItem>
          <ToggleGroupItem value="weekly" className="data-[state=on]:border-primary data-[state=on]:bg-primary/5">{t('Semanal, fecha à sexta')}</ToggleGroupItem>
        </ToggleGroup>
        {product.commission_payout === 'weekly' && (
          <p className="text-xs text-muted-foreground">{t('Paga na sexta-feira que fecha a semana da venda. Este serviço tem de ser vendido numa venda à parte dos serviços mensais.')}</p>
        )}
      </div>
    </section>
  );
}
