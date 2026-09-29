import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { RefreshCw } from 'lucide-react';
import { useUpdateProduct } from '@/hooks/useProducts';
import { useOrganization } from '@/hooks/useOrganization';
import { effectiveProductTaxRate, effectiveTaxExemptionReason, type OrganizationTaxConfig } from '@/lib/product-fiscal';
import { ProductImageGallery } from './ProductImageGallery';
import { ProductFiscalFields } from './ProductFiscalFields';
import { ProductStripeSync } from './ProductStripeSync';
import type { Product } from '@/types/proposals';

interface EditProductModalProps {
  product: Product;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditProductModal({ product, open, onOpenChange }: EditProductModalProps) {
  const updateProduct = useUpdateProduct();
  const { data: org } = useOrganization();
  // Per-product commission field is relevant for telecom (matrix products) or
  // when a non-telecom org chose the "per product/service" commission mode.
  const settings = (org?.sales_settings as { commission_mode?: string; commission_percentage?: number | null }) || {};
  const isTelecom = (org as { niche?: string } | undefined)?.niche === "telecom";
  const commissionMode = settings.commission_mode || ((settings.commission_percentage ?? 0) > 0 ? "global" : "per_product");
  const showCommission = isTelecom || commissionMode === "per_product";
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description || '');
  const [price, setPrice] = useState(product.price?.toString() || '');
  const [isActive, setIsActive] = useState(product.is_active);
  const [isRecurring, setIsRecurring] = useState(product.is_recurring);
  const [commissionValue, setCommissionValue] = useState(product.commission_value?.toString() || '');
  const [commissionRenewalValue, setCommissionRenewalValue] = useState(product.commission_renewal_value?.toString() ?? '0');
  const [taxValue, setTaxValue] = useState<number | null>(product.tax_value ?? null);
  const [taxExemptionReason, setTaxExemptionReason] = useState(product.tax_exemption_reason ?? '');
  const [priceIncludesVat, setPriceIncludesVat] = useState(product.price_includes_vat ?? false);
  const [retentionRate, setRetentionRate] = useState(String(product.retention_rate ?? 0));
  const organizationTaxConfig = org?.tax_config as OrganizationTaxConfig | null | undefined;
  const exemptionMissing = effectiveProductTaxRate(taxValue, organizationTaxConfig) === 0
    && !effectiveTaxExemptionReason(taxExemptionReason, organizationTaxConfig);
  const retentionInvalid = !Number.isFinite(Number(retentionRate))
    || Number(retentionRate) < 0
    || Number(retentionRate) > 100;

  useEffect(() => {
    setName(product.name);
    setDescription(product.description || '');
    setPrice(product.price?.toString() || '');
    setIsActive(product.is_active);
    setIsRecurring(product.is_recurring);
    setCommissionValue(product.commission_value?.toString() || '');
    setCommissionRenewalValue(product.commission_renewal_value?.toString() ?? '0');
    setTaxValue(product.tax_value ?? null);
    setTaxExemptionReason(product.tax_exemption_reason ?? '');
    setPriceIncludesVat(product.price_includes_vat ?? false);
    setRetentionRate(String(product.retention_rate ?? 0));
  }, [product]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || exemptionMissing || retentionInvalid) return;

    updateProduct.mutate({
      id: product.id,
      name: name.trim(),
      description: description.trim() || null,
      price: price ? parseFloat(price) : null,
      is_active: isActive,
      is_recurring: isRecurring,
      tax_value: taxValue,
      tax_exemption_reason: taxExemptionReason.trim() || null,
      price_includes_vat: priceIncludesVat,
      retention_rate: Number(retentionRate) || 0,
      invoicexpress_id: product.invoicexpress_id,
      commission_value: commissionValue ? parseFloat(commissionValue) : null,
      commission_renewal_value: commissionRenewalValue !== '' ? parseFloat(commissionRenewalValue) : 0,
    }, {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar Produto</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="max-h-[60dvh] space-y-4 overflow-y-auto pr-1">
            <div className="space-y-2">
            <Label htmlFor="edit-name">Nome *</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-description">Descrição</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-price">Preço Base (€)</Label>
            <Input
              id="edit-price"
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <ProductFiscalFields
            price={price}
            taxValue={taxValue}
            onTaxValueChange={setTaxValue}
            taxExemptionReason={taxExemptionReason}
            onTaxExemptionReasonChange={setTaxExemptionReason}
            priceIncludesVat={priceIncludesVat}
            onPriceIncludesVatChange={setPriceIncludesVat}
            retentionRate={retentionRate}
            onRetentionRateChange={setRetentionRate}
            organizationTaxConfig={organizationTaxConfig}
          />

          {showCommission && (
          <div className="rounded-lg border bg-primary/5 p-4 space-y-3">
            <p className="text-sm font-medium">Comissão por unidade</p>
            <p className="text-xs text-muted-foreground -mt-1">
              {isTelecom
                ? "Valor pago ao comercial por cada unidade vendida deste produto. Vendas de energia (com CPE) ignoram este campo e usam o motor próprio."
                : "Valor pago ao comercial por cada unidade vendida deste produto."}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-commission" className="text-xs">Angariação (€)</Label>
                <Input
                  id="edit-commission"
                  type="number"
                  step="0.01"
                  min="0"
                  value={commissionValue}
                  onChange={(e) => setCommissionValue(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-commission-renewal" className="text-xs">
                  Renovação (€)
                </Label>
                <Input
                  id="edit-commission-renewal"
                  type="number"
                  step="0.01"
                  min="0"
                  value={commissionRenewalValue}
                  onChange={(e) => setCommissionRenewalValue(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>
          )}

          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-primary" />
                <Label htmlFor="edit-recurring" className="font-medium cursor-pointer">
                  Produto Recorrente
                </Label>
              </div>
              <Switch
                id="edit-recurring"
                checked={isRecurring}
                onCheckedChange={setIsRecurring}
              />
            </div>
            {isRecurring && (
              <p className="text-xs text-muted-foreground">
                Este produto é cobrado mensalmente. Vendas com este produto terão opção de renovação.
              </p>
            )}
            {/* Usa o is_recurring GRAVADO, não o do formulário: sincronizar um
                produto que ainda não foi guardado como recorrente faria a edge
                function recusar com "o produto não é recorrente". */}
            <ProductStripeSync productId={product.id} isRecurring={product.is_recurring} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="edit-active">Produto ativo</Label>
            <Switch
              id="edit-active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>

          <div className="rounded-lg border p-3">
            <ProductImageGallery productId={product.id} />
          </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={updateProduct.isPending || !name.trim() || exemptionMissing || retentionInvalid}>
              {updateProduct.isPending ? 'A guardar...' : 'Guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
