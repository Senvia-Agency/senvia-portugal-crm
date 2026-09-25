import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Info } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { KeyInvoiceSeriesSettings } from './KeyInvoiceSeriesSettings';

interface FiscalSettingsTabProps {
  taxRate: string;
  setTaxRate: (value: string) => void;
  taxExemptionReason: string;
  setTaxExemptionReason: (value: string) => void;
  onSave: () => void;
  isPending: boolean;
}

const EXEMPTION_OPTIONS = [
  { value: 'M01', label: 'M01 - Artigo 16.º n.º 6 do CIVA' },
  { value: 'M02', label: 'M02 - Artigo 6.º do Decreto-Lei n.º 198/90' },
  { value: 'M04', label: 'M04 - Isento Artigo 13.º do CIVA' },
  { value: 'M05', label: 'M05 - Isento Artigo 14.º do CIVA' },
  { value: 'M06', label: 'M06 - Isento Artigo 15.º do CIVA' },
  { value: 'M07', label: 'M07 - Isento Artigo 9.º do CIVA' },
  { value: 'M09', label: 'M09 - IVA não confere direito a dedução' },
  { value: 'M10', label: 'M10 - IVA regime de isenção (Art. 53.º)' },
  { value: 'M11', label: 'M11 - Regime particular do tabaco' },
  { value: 'M12', label: 'M12 - Regime da margem de lucro' },
  { value: 'M13', label: 'M13 - Regime de IVA de Caixa' },
  { value: 'M16', label: 'M16 - Isento Artigo 14.º do RITI' },
];

export function FiscalSettingsTab({ taxRate, setTaxRate, taxExemptionReason, setTaxExemptionReason, onSave, isPending }: FiscalSettingsTabProps) {
  const { organization } = useAuth();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Configuração Fiscal</CardTitle>
          <CardDescription>Defina a taxa de IVA global aplicada a todos os produtos e faturas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg bg-muted/50 border p-3 flex items-start gap-2">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground">
            {taxRate === '0'
              ? 'A isenção aplica-se a todos os produtos e faturas da organização, mesmo que uma ficha de produto tenha uma taxa antiga.'
              : 'Esta taxa é usada por defeito. Produtos com uma taxa própria podem usar essa taxa. Alterações aqui afetam toda a organização.'}
          </p>
        </div>

        <div className="space-y-2">
          <Label>Taxa de IVA</Label>
          <Select value={taxRate} onValueChange={setTaxRate}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="23">IVA 23%</SelectItem>
              <SelectItem value="13">IVA 13% (Intermédia)</SelectItem>
              <SelectItem value="6">IVA 6% (Reduzida)</SelectItem>
              <SelectItem value="0">Isento de IVA</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Taxa de imposto aplicada nas faturas emitidas.
          </p>
        </div>

        {taxRate === '0' && (
          <div className="space-y-2">
            <Label>Motivo de Isenção (AT)</Label>
            <Select value={taxExemptionReason} onValueChange={setTaxExemptionReason}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o motivo..." />
              </SelectTrigger>
              <SelectContent>
                {EXEMPTION_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!taxExemptionReason && (
              <p className="text-xs text-destructive">
                Obrigatório para emissão de faturas isentas de IVA.
              </p>
            )}
          </div>
        )}

        <Button onClick={onSave} disabled={isPending || (taxRate === '0' && !taxExemptionReason)}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar
        </Button>
      </CardContent>
    </Card>
    {organization?.billing_provider === 'keyinvoice' && (
      <Card>
        <CardHeader>
          <CardTitle>Séries KeyInvoice</CardTitle>
          <CardDescription>Escolha as séries usadas nos documentos fiscais recorrentes automáticos.</CardDescription>
        </CardHeader>
        <CardContent>
          <KeyInvoiceSeriesSettings />
        </CardContent>
      </Card>
    )}
    </div>
  );
}
