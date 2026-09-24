import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { RefreshCw } from 'lucide-react';
import { useCreateProduct } from '@/hooks/useProducts';
import { useAuth } from '@/contexts/AuthContext';
import { effectiveProductTaxRate, effectiveTaxExemptionReason, type OrganizationTaxConfig } from '@/lib/product-fiscal';
import { ProductStripeSync } from './ProductStripeSync';
import { ProductFiscalFields } from './ProductFiscalFields';
import type { Product } from '@/types/proposals';

interface CreateProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (product: Product) => void;
}

export function CreateProductModal({ open, onOpenChange, onCreated }: CreateProductModalProps) {
  const createProduct = useCreateProduct();
  const { organization } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [commissionValue, setCommissionValue] = useState('');
  const [commissionRenewalValue, setCommissionRenewalValue] = useState('0');
  const [taxValue, setTaxValue] = useState<number | null>(null);
  const [taxExemptionReason, setTaxExemptionReason] = useState('');
  const [priceIncludesVat, setPriceIncludesVat] = useState(false);
  const [retentionRate, setRetentionRate] = useState('0');
  const organizationTaxConfig = organization?.tax_config as OrganizationTaxConfig | null | undefined;
  const exemptionMissing = effectiveProductTaxRate(taxValue, organizationTaxConfig) === 0
    && !effectiveTaxExemptionReason(taxExemptionReason, organizationTaxConfig);
  const retentionInvalid = !Number.isFinite(Number(retentionRate))
    || Number(retentionRate) < 0
    || Number(retentionRate) > 100;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || exemptionMissing || retentionInvalid) return;

    createProduct.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      price: price ? parseFloat(price) : undefined,
      is_recurring: isRecurring,
      tax_value: taxValue,
      tax_exemption_reason: taxExemptionReason.trim() || null,
      price_includes_vat: priceIncludesVat,
      retention_rate: Number(retentionRate) || 0,
      commission_value: commissionValue ? parseFloat(commissionValue) : null,
      commission_renewal_value: commissionRenewalValue !== '' ? parseFloat(commissionRenewalValue) : 0,
    }, {
      onSuccess: (product) => {
        setName('');
        setDescription('');
        setPrice('');
        setIsRecurring(false);
        setCommissionValue('');
        setCommissionRenewalValue('0');
        setTaxValue(null);
        setTaxExemptionReason('');
        setPriceIncludesVat(false);
        setRetentionRate('0');
        onOpenChange(false);
        if (onCreated) onCreated(product);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo Produto/Serviço</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="max-h-[75dvh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label htmlFor="name">Nome *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Consulta Inicial"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrição opcional do produto ou serviço"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="price">Preço Base (€)</Label>
            <Input
              id="price"
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

          <div className="rounded-lg border bg-primary/5 p-4 space-y-3">
            <p className="text-sm font-medium">Comissão por unidade</p>
            <p className="text-xs text-muted-foreground -mt-1">
              Valor pago ao comercial por cada unidade vendida.
              Vendas de energia (com CPE) ignoram este campo e usam o motor próprio.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="commission" className="text-xs">Angariação (€)</Label>
                <Input
                  id="commission"
                  type="number"
                  step="0.01"
                  min="0"
                  value={commissionValue}
                  onChange={(e) => setCommissionValue(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="commission-renewal" className="text-xs">
                  Renovação (€)
                </Label>
                <Input
                  id="commission-renewal"
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

          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-primary" />
                <Label htmlFor="recurring" className="font-medium cursor-pointer">
                  Produto Recorrente
                </Label>
              </div>
              <Switch
                id="recurring"
                checked={isRecurring}
                onCheckedChange={setIsRecurring}
              />
            </div>
            {isRecurring && (
              <>
                <p className="text-xs text-muted-foreground">
                  Este produto é cobrado mensalmente. Vendas com este produto terão opção de renovação.
                </p>
                {/* Sem productId ainda: o controlo explica que é preciso gravar
                    primeiro, em vez de aparecer desligado sem motivo aparente. */}
                <ProductStripeSync productId={null} isRecurring />
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createProduct.isPending || !name.trim() || exemptionMissing || retentionInvalid}>
              {createProduct.isPending ? 'A criar...' : 'Criar Produto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
