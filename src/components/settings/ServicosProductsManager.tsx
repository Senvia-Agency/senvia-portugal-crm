import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Trash2, Settings2, Check, Loader2, Pencil, Radio, Package, AlertCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useOrganization, useUpdateOrganization } from '@/hooks/useOrganization';
import { CreateTelecomProductModal } from './CreateTelecomProductModal';
import { ProductEditDialog } from './ProductEditDialog';
import { useTeamMembers } from '@/hooks/useTeam';
import { useOrganizationProfiles } from '@/hooks/useOrganizationProfiles';
import { useOperators, type Operator } from '@/hooks/useOperators';
import { catalogProductKey, type CatalogProduct } from '@/types/proposals';
import type { Json } from '@/integrations/supabase/types';
import { intlLocale, tr, useLanguage } from '@/i18n';

/** Short summary for the compact row — what the commission column shows. */
function commissionSummary(product: CatalogProduct, operator: Operator | null): string {
  // A fixed commission_basis wins regardless of kind — an energia operator
  // can opt out of Matriz de Comissões (see ProductCommissionFields).
  const isTiered = !!operator && !!operator.commission_basis;
  // A classified product follows its type, whatever the operator's kind.
  if (!isTiered && operator?.kind === 'energia' && !(product.type_ids?.length)) return tr('Ver Matriz de Comissões');
  if (isTiered) {
    const n = product.quantity_tiers?.length ?? 0;
    if (n === 0) return tr('Sem escalões');
    return tr(n === 1 ? '{{n}} escalão' : '{{n}} escalões', { n });
  }
  const n = product.splits?.length ?? 0;
  if (n === 0) return tr('Sem comissão');
  return tr(n === 1 ? '{{n}} linha' : '{{n}} linhas', { n });
}

/** Price column for the compact row — a range across bands when the product is tiered, else the flat price. */
function priceSummary(product: CatalogProduct): string {
  const tiers = product.quantity_tiers;
  if (tiers && tiers.length > 0) {
    const prices = tiers.map(t => t.price ?? product.price).filter((p): p is number => p != null);
    if (prices.length === 0) return '—';
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const fmt = (v: number) => v.toLocaleString(intlLocale(), { minimumFractionDigits: 2 });
    return min === max ? `${fmt(min)} €` : `${fmt(min)} – ${fmt(max)} €`;
  }
  return product.price ? `${product.price.toLocaleString(intlLocale(), { minimumFractionDigits: 2 })} €` : '—';
}

const SEM_OPERADORA = '__sem_operadora__';

export function ServicosProductsManager() {
  // Loading and failure must not look like an empty catalog: a request that
  // errors out used to render "Ainda não tem produtos configurados" over a
  // catalog of 25, and nobody could tell the difference from the screen.
  const { data: org, isLoading: orgLoading, error: orgError, refetch: refetchOrg } = useOrganization();
  // Saves happen as the user edits, so a toast per field would be noise.
  const updateOrg = useUpdateOrganization({ silent: true });
  const { data: teamMembers } = useTeamMembers();
  const { profiles } = useOrganizationProfiles();
  const { data: operators = [] } = useOperators();
  const { t } = useLanguage();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  // Orgs still on the old [{name, fields}] shape cannot be edited here. Saving
  // would replace their catalog with an empty one, so we block it instead.
  const [isLegacyConfig, setIsLegacyConfig] = useState(false);
  // While an edit is unsaved, the org refetch must not overwrite what is on
  // screen: the server still holds the previous value.
  const dirtyRef = useRef(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (dirtyRef.current) return;
    const saved = (org as any)?.servicos_products_config as CatalogProduct[] | null;
    const hasSaved = !!saved && Array.isArray(saved) && saved.length > 0;
    const isCatalog = hasSaved && typeof saved![0].price === 'number';
    setIsLegacyConfig(hasSaved && !isCatalog);
    // Start with an empty catalog for new orgs
    setProducts(isCatalog ? saved! : []);
  }, [org]);

  useEffect(() => () => clearTimeout(savedTimerRef.current), []);

  const persist = (next: CatalogProduct[]) => {
    if (isLegacyConfig) return;
    dirtyRef.current = true;
    updateOrg.mutate(
      { servicos_products_config: next as unknown as Json },
      {
        onSuccess: () => {
          dirtyRef.current = false;
          setJustSaved(true);
          clearTimeout(savedTimerRef.current);
          savedTimerRef.current = setTimeout(() => setJustSaved(false), 2000);
        },
        // Keep dirtyRef set on failure so the refetch cannot discard the edit.
      },
    );
  };

  const addProduct = (product: CatalogProduct) => {
    const next = [...products, product];
    setProducts(next);
    persist(next);
  };

  const removeProduct = (key: string) => {
    const next = products.filter(p => catalogProductKey(p) !== key);
    setProducts(next);
    persist(next);
  };

  /** Local edit only. Text fields save on blur, so typing does not hit the DB. */
  const updateProduct = (key: string, updates: Partial<CatalogProduct>) => {
    dirtyRef.current = true;
    setProducts(prev => prev.map(p => (catalogProductKey(p) === key ? { ...p, ...updates } : p)));
  };

  /** For controls with no blur of their own: switches, selects, blur handlers. */
  const updateAndSave = (key: string, updates: Partial<CatalogProduct>) => {
    const next = products.map(p => (catalogProductKey(p) === key ? { ...p, ...updates } : p));
    setProducts(next);
    persist(next);
  };

  // Grouped by operator so a long catalog reads as a handful of collapsed
  // sections instead of one unbroken wall of cards. Groups with no products
  // are skipped; "Sem operadora" comes first since that is the common case
  // for orgs that haven't set up operators yet.
  const groups = useMemo(() => {
    const byOperator = new Map<string, CatalogProduct[]>();
    for (const product of products) {
      const key = product.operator_id ?? SEM_OPERADORA;
      const list = byOperator.get(key) ?? [];
      list.push(product);
      byOperator.set(key, list);
    }
    const ordered: { key: string; operator: Operator | null; products: CatalogProduct[] }[] = [];
    if (byOperator.has(SEM_OPERADORA)) {
      ordered.push({ key: SEM_OPERADORA, operator: null, products: byOperator.get(SEM_OPERADORA)! });
    }
    for (const op of operators) {
      if (byOperator.has(op.id)) {
        ordered.push({ key: op.id, operator: op, products: byOperator.get(op.id)! });
      }
    }
    return ordered;
  }, [products, operators]);

  const editingProduct = products.find(p => catalogProductKey(p) === editingKey) ?? null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            {t('Produtos Telecom (Serviços)')}
          </CardTitle>
          <CardDescription>
            {t('Configure os produtos disponíveis para propostas e vendas de "Outros Serviços". Na hora da venda, os valores podem ser editados sem alterar o catálogo.')}
          </CardDescription>
        </div>
        <div className="flex items-center gap-3">
          {updateOrg.isPending ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('A guardar...')}
            </span>
          ) : justSaved ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="h-3 w-3 text-green-500" />
              {t('Guardado')}
            </span>
          ) : null}
          <Button onClick={() => setCreateOpen(true)} size="sm" disabled={isLegacyConfig}>
            <Plus className="h-4 w-4 mr-2" />
            {t('Adicionar')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLegacyConfig && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 mb-4">
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t('Esta organização tem um catálogo no formato antigo, que este ecrã não sabe editar. Guardar aqui apagaria esse catálogo, por isso a gravação está bloqueada. Contacta o suporte para o converter.')}
            </p>
          </div>
        )}

        {groups.length > 0 && (
          <Accordion type="multiple" className="border rounded-lg overflow-hidden">
            {groups.map(({ key, operator, products: groupProducts }) => (
              <AccordionItem key={key} value={key} className="last:border-b-0 px-3">
                <AccordionTrigger className="py-2.5 hover:no-underline">
                  <span className="flex items-center gap-2 text-sm">
                    {operator ? <Radio className="h-3.5 w-3.5 text-primary" /> : <Package className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span className="font-medium">{operator?.name ?? t('Sem operadora')}</span>
                    {operator && (
                      <Badge variant={operator.kind === 'telecom' ? 'default' : 'secondary'} className="text-[10px]">
                        {operator.kind === 'telecom' ? t('Telecom') : t('Energia')}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {t(groupProducts.length === 1 ? '{{n}} produto' : '{{n}} produtos', { n: groupProducts.length })}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-2">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-8 text-xs">{t('Nome')}</TableHead>
                        <TableHead className="h-8 text-xs">{t('Preço Base')}</TableHead>
                        <TableHead className="h-8 text-xs">{t('Comissão')}</TableHead>
                        <TableHead className="h-8 text-xs w-20" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groupProducts.map((product) => {
                        const key = catalogProductKey(product);
                        return (
                          <TableRow key={key} className="cursor-pointer" onClick={() => setEditingKey(key)}>
                            <TableCell className="py-1.5 text-sm font-medium">{product.name}</TableCell>
                            <TableCell className="py-1.5 text-sm text-muted-foreground">
                              {priceSummary(product)}
                            </TableCell>
                            <TableCell className="py-1.5 text-xs text-muted-foreground">{commissionSummary(product, operator)}</TableCell>
                            <TableCell className="py-1.5 text-right">
                              <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingKey(key)}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeProduct(key)}>
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}

        {products.length === 0 && !isLegacyConfig && orgLoading && (
          <div className="space-y-2 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {products.length === 0 && !isLegacyConfig && !orgLoading && orgError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {t('Não foi possível carregar o catálogo.')}
            </p>
            <p className="mt-1 break-words font-mono text-xs text-muted-foreground">
              {(orgError as Error).message}
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => refetchOrg()}>
              {t('Tentar novamente')}
            </Button>
          </div>
        )}

        {products.length === 0 && !isLegacyConfig && !orgLoading && !orgError && (
          <div className="py-10 text-center">
            <Settings2 className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">{t('Ainda não tem produtos configurados.')}</p>
            <p className="text-sm text-muted-foreground">
              {t('Adicione produtos para os poder vender em propostas e vendas.')}
            </p>
          </div>
        )}
      </CardContent>

      <CreateTelecomProductModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        existingProducts={products.map(p => ({ name: p.name, operator_id: p.operator_id }))}
        operators={operators}
        members={(teamMembers ?? []).map(m => ({ user_id: m.user_id, full_name: m.full_name }))}
        profiles={(profiles ?? []).map(p => ({ id: p.id, name: p.name }))}
        onCreate={addProduct}
        isPending={updateOrg.isPending}
      />

      <ProductEditDialog
        product={editingProduct}
        onOpenChange={(open) => !open && setEditingKey(null)}
        operators={operators}
        members={(teamMembers ?? []).map(m => ({ user_id: m.user_id, full_name: m.full_name }))}
        profiles={(profiles ?? []).map(p => ({ id: p.id, name: p.name }))}
        onChange={updateProduct}
        onCommit={updateAndSave}
      />
    </Card>
  );
}
