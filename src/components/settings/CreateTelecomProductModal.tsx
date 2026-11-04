import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OperatorField, PriceField, OperatorPaysField, OperatorPaysHint, ProductTypesField, CommissionSection, useProductOperatorContext } from './ProductCommissionFields';
import { TonedField, tonedInputClass } from './FieldTone';
import type { Operator } from '@/hooks/useOperators';
import type { CatalogProduct } from '@/types/proposals';
import { useLanguage } from '@/i18n';

const EMPTY_PRODUCT: CatalogProduct = {
  name: '',
  price: 0,
  has_commission: false,
  commission_pct: 0,
  commission_fixed: 0,
  splits: [],
};

interface Member {
  user_id: string;
  full_name: string;
}

interface Profile {
  id: string;
  name: string;
}

interface CreateTelecomProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Products already in the catalog, to reject duplicates — scoped per
   * operator (or per "no operator"), not globally: "1P" can exist both
   * without an operator (same commission for MEO/Vodafone/NOS) AND again
   * just for Digi (different commission), because at sale time a product
   * with no operator shows up for every operator's picker.
   */
  existingProducts: Pick<CatalogProduct, 'name' | 'operator_id'>[];
  operators: Operator[];
  members: Member[];
  profiles: Profile[];
  onCreate: (product: CatalogProduct) => void;
  isPending?: boolean;
}

/**
 * Creates one entry of the "Outros Serviços" catalog
 * (organizations.servicos_products_config). Full-screen, one pass — in the
 * order the operator decides everything after it: operadora, nome, preço
 * (skipped once escalões take over pricing) and the commission rules, all
 * set up here before the product is created.
 */
export function CreateTelecomProductModal({
  open,
  onOpenChange,
  existingProducts,
  operators,
  members,
  profiles,
  onCreate,
  isPending,
}: CreateTelecomProductModalProps) {
  const [draft, setDraft] = useState<CatalogProduct>(EMPTY_PRODUCT);
  const { t } = useLanguage();

  useEffect(() => {
    if (open) setDraft(EMPTY_PRODUCT);
  }, [open]);

  const trimmed = draft.name.trim();
  // Scoped per operator: "1P" without an operator and "1P" just for Digi can
  // coexist — only a clash within the SAME operator (or the same "no
  // operator" bucket) is a real duplicate.
  const isDuplicate = existingProducts.some(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase() && (p.operator_id ?? null) === (draft.operator_id ?? null),
  );
  const { operator, isTiered, operatorRequiresTiers, scopeLabel, tierBasis, tierScope } = useProductOperatorContext(draft, operators);

  // Nothing is persisted until "Criar Produto", so typing and "committing" a
  // field are the same action here — unlike the edit dialog, there is no
  // draft/saved distinction yet.
  const patch = (updates: Partial<CatalogProduct>) => setDraft(prev => ({ ...prev, ...updates }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed || isDuplicate) return;
    onCreate({ ...draft, name: trimmed });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex flex-col p-0 gap-0 overflow-hidden">
        <form onSubmit={handleSubmit} className="flex flex-col h-full min-h-0">
          <DialogHeader className="shrink-0 border-b px-4 sm:px-6 py-4 pr-14">
            <div className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-primary" />
              <DialogTitle className="text-base sm:text-lg">{t('Novo Produto Telecom')}</DialogTitle>
            </div>
            <DialogDescription>{t('Operadora, nome, preço e regras de comissão do produto.')}</DialogDescription>
          </DialogHeader>

          {/* Fixed header, outside the scroll box — same as the edit dialog,
              with the name in it. */}
          <div className="shrink-0 space-y-3 border-b px-4 sm:px-6 py-3">
            <ProductTypesField product={draft} onCommit={patch} hint={false} />

            {/* Same header as the edit page, with the name in it: one row of
                equal boxes, in the order the money is read. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <TonedField tone="neutral" label={t('Nome *')}>
                <Input
                  id="telecom-name"
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder={t('Ex: 3P - 34 a 42')}
                  autoFocus
                  className={`${tonedInputClass} w-full font-normal`}
                />
                {isDuplicate && (
                  <p className="text-xs text-destructive">{t('Já existe um produto com este nome.')}</p>
                )}
              </TonedField>
              <OperatorField product={draft} operators={operators} onCommit={patch} />
              <PriceField product={draft} onChange={patch} onCommit={patch} />
              <OperatorPaysField product={draft} onChange={patch} onCommit={patch} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-6">
            <OperatorPaysHint />

            <CommissionSection
              product={draft}
              operator={operator}
              isTiered={isTiered}
              operatorRequiresTiers={operatorRequiresTiers}
              tierBasis={tierBasis}
              tierScope={tierScope}
              scopeLabel={scopeLabel}
              members={members}
              profiles={profiles}
              onChange={patch}
              onCommit={patch}
            />
          </div>

          <div className="shrink-0 border-t px-4 sm:px-6 py-3 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('Cancelar')}
            </Button>
            <Button type="submit" disabled={!trimmed || isDuplicate || isPending}>
              {isPending ? t('A criar...') : t('Criar Produto')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
