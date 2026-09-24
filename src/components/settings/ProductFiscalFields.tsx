import { Calculator } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { formatCurrency } from '@/lib/format';
import {
  effectiveProductTaxRate,
  effectiveTaxExemptionReason,
  grossUnitPrice,
  PORTUGUESE_VAT_RATES,
  type OrganizationTaxConfig,
} from '@/lib/product-fiscal';

export const INHERIT_TAX_RATE = '__organization__';

const EXEMPTION_OPTIONS = [
  { value: 'M01', label: 'M01 — Artigo 16.º n.º 6 do CIVA' },
  { value: 'M02', label: 'M02 — Artigo 6.º do Decreto-Lei n.º 198/90' },
  { value: 'M04', label: 'M04 — Isento Artigo 13.º do CIVA' },
  { value: 'M05', label: 'M05 — Isento Artigo 14.º do CIVA' },
  { value: 'M06', label: 'M06 — Isento Artigo 15.º do CIVA' },
  { value: 'M07', label: 'M07 — Isento Artigo 9.º do CIVA' },
  { value: 'M09', label: 'M09 — IVA não confere direito a dedução' },
  { value: 'M10', label: 'M10 — Regime de isenção (Art. 53.º)' },
  { value: 'M11', label: 'M11 — Regime particular do tabaco' },
  { value: 'M12', label: 'M12 — Regime da margem de lucro' },
  { value: 'M13', label: 'M13 — Regime de IVA de Caixa' },
  { value: 'M16', label: 'M16 — Isento Artigo 14.º do RITI' },
] as const;

interface ProductFiscalFieldsProps {
  price: string;
  taxValue: number | null;
  onTaxValueChange: (value: number | null) => void;
  taxExemptionReason: string;
  onTaxExemptionReasonChange: (value: string) => void;
  priceIncludesVat: boolean;
  onPriceIncludesVatChange: (value: boolean) => void;
  retentionRate: string;
  onRetentionRateChange: (value: string) => void;
  organizationTaxConfig?: OrganizationTaxConfig | null;
}

export function ProductFiscalFields({
  price,
  taxValue,
  onTaxValueChange,
  taxExemptionReason,
  onTaxExemptionReasonChange,
  priceIncludesVat,
  onPriceIncludesVatChange,
  retentionRate,
  onRetentionRateChange,
  organizationTaxConfig,
}: ProductFiscalFieldsProps) {
  const effectiveTax = effectiveProductTaxRate(taxValue, organizationTaxConfig);
  const effectiveExemption = effectiveTaxExemptionReason(taxExemptionReason, organizationTaxConfig);
  const numericPrice = Number(price);
  const numericRetention = Number(retentionRate);
  const retentionInvalid = !Number.isFinite(numericRetention) || numericRetention < 0 || numericRetention > 100;
  const grossPreview = grossUnitPrice(
    Number.isFinite(numericPrice) ? numericPrice : 0,
    { tax_value: taxValue, price_includes_vat: priceIncludesVat },
    organizationTaxConfig,
  );

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <div className="flex items-start gap-2">
        <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-medium">Configuração fiscal</p>
          <p className="text-xs text-muted-foreground">
            Estes valores ficam associados ao produto e são congelados em cada venda faturada.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Taxa de IVA</Label>
          <Select
            value={taxValue === null ? INHERIT_TAX_RATE : String(taxValue)}
            onValueChange={(value) => onTaxValueChange(value === INHERIT_TAX_RATE ? null : Number(value))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT_TAX_RATE}>
                Herdar da organização ({effectiveProductTaxRate(null, organizationTaxConfig)}%)
              </SelectItem>
              {taxValue !== null && !PORTUGUESE_VAT_RATES.some((rate) => rate === taxValue) && (
                <SelectItem value={String(taxValue)}>IVA {taxValue}%</SelectItem>
              )}
              {PORTUGUESE_VAT_RATES.map((rate) => (
                <SelectItem key={rate} value={String(rate)}>
                  {rate === 0 ? 'Isento de IVA' : `IVA ${rate}%`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="retention-rate">Retenção (%)</Label>
          <Input
            id="retention-rate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={retentionRate}
            onChange={(event) => onRetentionRateChange(event.target.value)}
          />
          {retentionInvalid && (
            <p className="text-xs text-destructive">A retenção tem de estar entre 0% e 100%.</p>
          )}
          {!retentionInvalid && numericRetention > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              A retenção fica registada; a emissão automática aguarda validação manual enquanto este cenário não estiver homologado na conta demo.
            </p>
          )}
        </div>
      </div>

      {effectiveTax === 0 && (
        <div className="space-y-2">
          <Label>Motivo de isenção (AT) *</Label>
          <Select value={taxExemptionReason || organizationTaxConfig?.tax_exemption_reason || ''} onValueChange={onTaxExemptionReasonChange}>
            <SelectTrigger>
              <SelectValue placeholder="Selecionar motivo de isenção" />
            </SelectTrigger>
            <SelectContent>
              {EXEMPTION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!effectiveExemption && (
            <p className="text-xs text-destructive">Obrigatório para emitir documentos com IVA a 0%.</p>
          )}
          {!taxExemptionReason && organizationTaxConfig?.tax_exemption_reason && (
            <p className="text-xs text-muted-foreground">A usar o motivo definido na organização.</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-4 rounded-md border bg-background p-3">
        <div>
          <Label htmlFor="price-includes-vat" className="cursor-pointer">O preço já inclui IVA</Label>
          <p className="text-xs text-muted-foreground">
            {priceIncludesVat
              ? 'O Stripe mantém este preço.'
              : `O IVA de ${effectiveTax}% é acrescentado na cobrança.`}
          </p>
        </div>
        <Switch id="price-includes-vat" checked={priceIncludesVat} onCheckedChange={onPriceIncludesVatChange} />
      </div>

      {Number.isFinite(numericPrice) && numericPrice > 0 && (
        <p className="text-xs text-muted-foreground">
          Valor bruto previsto para cobrança: <span className="font-medium text-foreground">{formatCurrency(grossPreview)}</span>
        </p>
      )}
    </div>
  );
}
