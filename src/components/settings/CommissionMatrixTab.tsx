import { useState, useEffect, useRef, useCallback, forwardRef } from 'react';
import { Calculator, Info, Plus, Trash2, Sun, Battery, Gauge, Home, Save, FileSpreadsheet, Zap } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { useLanguage } from '@/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useOrganization, useUpdateOrganization } from '@/hooks/useOrganization';
import { useServicosProducts } from '@/hooks/useServicosProducts';
import { CommissionGlobalSettings } from './CommissionGlobalSettings';
import type { CommissionMatrix, CommissionRule, SolarTier, EnergyCommissionConfig, EnergyMarginBand, TierDerivationRule, TierRules } from '@/hooks/useCommissionMatrix';
import { DEFAULT_ENERGY_CONFIG, DEFAULT_TIER_RULES } from '@/hooks/useCommissionMatrix';

const METHOD_LABELS: Record<string, string> = {
  tiered_kwp: 'Escalões por kWp',
  base_plus_per_kwp: 'Base + € × kWp',
  formula_percentage: 'Fórmula kWp + %',
  percentage_valor: '% da Venda/Proposta',
};

const ALL_METHODS = ['tiered_kwp', 'base_plus_per_kwp', 'formula_percentage', 'percentage_valor'] as const;

const DEFAULT_TIER: SolarTier = { kwpMin: 0, kwpMax: 0, baseTransaccional: 0, adicTransaccional: 0, baseAas: 0, adicAas: 0 };

const PRODUCT_ICONS: Record<string, React.ElementType> = {
  Solar: Sun,
  Baterias: Battery,
  Carregadores: Battery,
  Condensadores: Gauge,
  Coberturas: Home,
};

function getProductIcon(product: string) {
  for (const [key, Icon] of Object.entries(PRODUCT_ICONS)) {
    if (product.toLowerCase().includes(key.toLowerCase())) return Icon;
  }
  return Calculator;
}

function getFormulaPreview(rule: CommissionRule): string {
  switch (rule.method) {
    case 'tiered_kwp':
      return 'Comissão = Base + (kWp - kWpMin) × Adicional (por escalão, Trans. ou AAS)';
    case 'base_plus_per_kwp':
      return 'Comissão = Base (€) + (€/kWp × kWp da proposta)';
    case 'formula_percentage':
      return 'kWp = (Valor × Factor) / Divisor → Comissão = kWp resultado × %';
    case 'percentage_valor':
      return 'Comissão = Valor da proposta × %';
  }
}

function getDefaultRule(method: string): CommissionRule {
  return { method: method as CommissionRule['method'], tiers: [] };
}

// ─── Main Component ───

export function CommissionMatrixTab() {
  const { data: org } = useOrganization();
  const isTelecom = (org as { niche?: string } | undefined)?.niche === "telecom";
  const updateOrg = useUpdateOrganization();
  const { products: SERVICOS_PRODUCTS } = useServicosProducts();
  const { t } = useLanguage();
  const [localMatrix, setLocalMatrix] = useState<CommissionMatrix>({});
  const [openProduct, setOpenProduct] = useState<string | null>(null);
  const [openEnergy, setOpenEnergy] = useState(false);
  const [localEnergy, setLocalEnergy] = useState<EnergyCommissionConfig>(DEFAULT_ENERGY_CONFIG);

  useEffect(() => {
    const saved = (org as any)?.commission_matrix as (CommissionMatrix & { ee_gas?: EnergyCommissionConfig }) | null;
    const initial: CommissionMatrix = {};
    SERVICOS_PRODUCTS.forEach((p) => {
      const existing = saved?.[p];
      if (existing && !ALL_METHODS.includes(existing.method as any)) {
        initial[p] = { method: 'percentage_valor', tiers: existing.tiers || [] };
      } else {
        initial[p] = existing ?? { method: 'tiered_kwp', tiers: [] };
      }
    });
    setLocalMatrix(initial);
    setLocalEnergy(saved?.ee_gas ?? DEFAULT_ENERGY_CONFIG);
  }, [org, SERVICOS_PRODUCTS]);

  const handleSave = (product: string) => {
    const fullMatrix = { ...localMatrix, ee_gas: localEnergy };
    updateOrg.mutate({ commission_matrix: fullMatrix as any }, {
      onSuccess: () => setOpenProduct(null),
    });
  };

  const handleSaveEnergy = () => {
    const fullMatrix = { ...localMatrix, ee_gas: localEnergy };
    updateOrg.mutate({ commission_matrix: fullMatrix as any }, {
      onSuccess: () => setOpenEnergy(false),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Calculator className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">{t('Matriz de Comissões')}</h2>
      </div>
      <p className="text-sm text-muted-foreground -mt-4">
        {t('Configure como a comissão é calculada para cada produto. Clique num card para editar.')}
      </p>

      <CommissionGlobalSettings />

      {isTelecom && (<>
      <div>
        <h3 className="text-sm font-medium mb-3">{t('Por produto / serviço')}</h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {/* EE & Gás card */}
        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors border-amber-500/30"
          onClick={() => setOpenEnergy(true)}
        >
          <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
            <Zap className="h-8 w-8 text-amber-500" />
            <span className="text-sm font-medium leading-tight">{t('EE & Gás')}</span>
            <Badge variant="secondary" className="text-[10px]">
              {t('Bandas de Margem')}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {t('{{n}} banda(s)', { n: localEnergy.bands.length })}
            </span>
          </CardContent>
        </Card>

        {SERVICOS_PRODUCTS.map((product) => {
          const rule = localMatrix[product] ?? { method: 'tiered_kwp' as const, tiers: [] };
          const Icon = getProductIcon(product);
          const tierCount = rule.method === 'tiered_kwp' ? (rule.tiers?.length ?? 0) : null;

          return (
            <Card
              key={product}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => setOpenProduct(product)}
            >
              <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
                <Icon className="h-8 w-8 text-primary" />
                <span className="text-sm font-medium leading-tight">{product}</span>
                <Badge variant="secondary" className="text-[10px]">
                  {METHOD_LABELS[rule.method] ? t(METHOD_LABELS[rule.method]) : rule.method}
                </Badge>
                {tierCount !== null && (
                  <span className="text-[10px] text-muted-foreground">
                    {t('{{n}} escalão(ões)', { n: tierCount })}
                  </span>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {openProduct && (
        <ProductModal
          product={openProduct}
          rule={localMatrix[openProduct] ?? { method: 'tiered_kwp', tiers: [] }}
          onMethodChange={(m) =>
            setLocalMatrix((prev) => ({ ...prev, [openProduct]: getDefaultRule(m) }))
          }
          onRuleChange={(r) =>
            setLocalMatrix((prev) => ({ ...prev, [openProduct]: r }))
          }
          onSave={() => handleSave(openProduct)}
          isSaving={updateOrg.isPending}
          onClose={() => setOpenProduct(null)}
        />
      )}

      {openEnergy && (
        <EnergyModal
          config={localEnergy}
          onChange={setLocalEnergy}
          onSave={handleSaveEnergy}
          isSaving={updateOrg.isPending}
          onClose={() => setOpenEnergy(false)}
        />
      )}
      </>)}
    </div>
  );
}

// ─── Product Modal ───

function ProductModal({
  product,
  rule,
  onMethodChange,
  onRuleChange,
  onSave,
  isSaving,
  onClose,
}: {
  product: string;
  rule: CommissionRule;
  onMethodChange: (method: string) => void;
  onRuleChange: (rule: CommissionRule) => void;
  onSave: () => void;
  isSaving: boolean;
  onClose: () => void;
}) {
  const Icon = getProductIcon(product);
  const { t } = useLanguage();

  const renderEditor = () => {
    switch (rule.method) {
      case 'tiered_kwp':
        return <TieredTableEditor rule={rule} onChange={onRuleChange} />;
      case 'base_plus_per_kwp':
        return <BasePlusKwpEditor rule={rule} onChange={onRuleChange} />;
      case 'formula_percentage':
        return <FormulaPercentageEditor rule={rule} onChange={onRuleChange} />;
      case 'percentage_valor':
        return <PercentageValorEditor rule={rule} onChange={onRuleChange} />;
      default:
        return null;
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent variant="fullScreen" className="flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="shrink-0 border-b px-4 sm:px-6 py-4 pr-14">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            <DialogTitle className="text-base sm:text-lg">{product}</DialogTitle>
          </div>
          <DialogDescription>{t('Configure o método de cálculo da comissão.')}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-6">
          <div className="space-y-1.5 max-w-xs">
            <Label className="text-xs text-muted-foreground">{t('Método de Cálculo')}</Label>
            <Select value={rule.method} onValueChange={onMethodChange}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>{t(METHOD_LABELS[m])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {renderEditor()}

          <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
            <span>{t(getFormulaPreview(rule))}</span>
          </div>
        </div>

        <div className="shrink-0 border-t px-4 sm:px-6 py-3 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            {t('Cancelar')}
          </Button>
          <Button onClick={onSave} disabled={isSaving} className="gap-1.5">
            <Save className="h-4 w-4" />
            {isSaving ? t('A guardar...') : t('Guardar')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Base + € × kWp Editor ───

function BasePlusKwpEditor({ rule, onChange }: { rule: CommissionRule; onChange: (r: CommissionRule) => void }) {
  const update = (field: keyof CommissionRule, value: number) => onChange({ ...rule, [field]: value });
  const { t } = useLanguage();

  return (
    <div className="space-y-5">
      <div className="text-sm font-medium">{t('Configuração da Fórmula')}</div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">{t('Transacional')}</Label>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">{t('Base (€)')}</span>
            <DecimalInput className="h-9 w-24" value={rule.baseTrans ?? 0} onChange={(v) => update('baseTrans', v)} />
            <span className="text-sm text-muted-foreground">+</span>
            <span className="text-sm text-muted-foreground">€/kWp</span>
            <DecimalInput className="h-9 w-24" value={rule.ratePerKwpTrans ?? 0} onChange={(v) => update('ratePerKwpTrans', v)} />
            <span className="text-sm text-muted-foreground">×</span>
            <Badge variant="outline" className="text-xs">{t('kWp (auto)')}</Badge>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">AAS</Label>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">{t('Base (€)')}</span>
            <DecimalInput className="h-9 w-24" value={rule.baseAas ?? 0} onChange={(v) => update('baseAas', v)} />
            <span className="text-sm text-muted-foreground">+</span>
            <span className="text-sm text-muted-foreground">€/kWp</span>
            <DecimalInput className="h-9 w-24" value={rule.ratePerKwpAas ?? 0} onChange={(v) => update('ratePerKwpAas', v)} />
            <span className="text-sm text-muted-foreground">×</span>
            <Badge variant="outline" className="text-xs">{t('kWp (auto)')}</Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Fórmula kWp + % Editor ───

function FormulaPercentageEditor({ rule, onChange }: { rule: CommissionRule; onChange: (r: CommissionRule) => void }) {
  const update = (field: keyof CommissionRule, value: number) => onChange({ ...rule, [field]: value });
  const { t } = useLanguage();

  return (
    <div className="space-y-5">
      <div className="text-sm font-medium">{t('Derivação do kWp')}</div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">kWp =</span>
          <span className="text-sm text-muted-foreground">(</span>
          <Badge variant="outline" className="text-xs">{t('Valor (auto)')}</Badge>
          <span className="text-sm text-muted-foreground">×</span>
          <DecimalInput className="h-9 w-24" value={rule.factor ?? 0} onChange={(v) => update('factor', v)} />
          <span className="text-sm text-muted-foreground">)</span>
          <span className="text-sm text-muted-foreground">/</span>
          <DecimalInput className="h-9 w-24" value={rule.divisor ?? 0} onChange={(v) => update('divisor', v)} />
        </div>

        <div className="text-sm font-medium pt-2">{t('Comissão')}</div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">{t('Transacional')}</Label>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">{t('Comissão =')}</span>
            <Badge variant="outline" className="text-xs">{t('kWp resultado')}</Badge>
            <span className="text-sm text-muted-foreground">×</span>
            <DecimalInput className="h-9 w-20" value={rule.pctTrans ?? 0} onChange={(v) => update('pctTrans', v)} />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">AAS</Label>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">{t('Comissão =')}</span>
            <Badge variant="outline" className="text-xs">{t('kWp resultado')}</Badge>
            <span className="text-sm text-muted-foreground">×</span>
            <DecimalInput className="h-9 w-20" value={rule.pctAas ?? 0} onChange={(v) => update('pctAas', v)} />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── % da Venda/Proposta Editor ───

function PercentageValorEditor({ rule, onChange }: { rule: CommissionRule; onChange: (r: CommissionRule) => void }) {
  const update = (field: keyof CommissionRule, value: number) => onChange({ ...rule, [field]: value });
  const { t } = useLanguage();

  return (
    <div className="space-y-5">
      <div className="text-sm font-medium">{t('Percentagem sobre o Valor')}</div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">{t('Transacional')}</Label>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs">{t('Valor (auto)')}</Badge>
            <span className="text-sm text-muted-foreground">×</span>
            <DecimalInput className="h-9 w-20" value={rule.pctTrans ?? 0} onChange={(v) => update('pctTrans', v)} />
            <span className="text-sm text-muted-foreground">%</span>
            <span className="text-sm text-muted-foreground">{t('→ Comissão')}</span>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">AAS</Label>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs">{t('Valor (auto)')}</Badge>
            <span className="text-sm text-muted-foreground">×</span>
            <DecimalInput className="h-9 w-20" value={rule.pctAas ?? 0} onChange={(v) => update('pctAas', v)} />
            <span className="text-sm text-muted-foreground">%</span>
            <span className="text-sm text-muted-foreground">{t('→ Comissão')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tiered Table Editor (only for tiered_kwp) ───

interface ColumnDef {
  field: keyof SolarTier;
  label: string;
}

const TIERED_COLUMNS: ColumnDef[] = [
  { field: 'kwpMin', label: 'kWp Min' },
  { field: 'kwpMax', label: 'kWp Max' },
  { field: 'baseTransaccional', label: 'Base Trans. (€)' },
  { field: 'adicTransaccional', label: 'Adic. Trans. (€/kWp)' },
  { field: 'baseAas', label: 'Base AAS (€)' },
  { field: 'adicAas', label: 'Adic. AAS (€/kWp)' },
];

function TieredTableEditor({
  rule,
  onChange,
}: {
  rule: CommissionRule;
  onChange: (rule: CommissionRule) => void;
}) {
  const tiers = rule.tiers || [];
  const fileRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();

  const updateTier = (index: number, field: keyof SolarTier, value: number) => {
    const newTiers = tiers.map((t, i) => (i === index ? { ...t, [field]: value } : t));
    onChange({ ...rule, tiers: newTiers });
  };

  const addTier = () => {
    const lastMax = tiers.length > 0 ? tiers[tiers.length - 1].kwpMax : 0;
    onChange({ ...rule, tiers: [...tiers, { ...DEFAULT_TIER, kwpMin: lastMax }] });
  };

  const removeTier = (index: number) => {
    onChange({ ...rule, tiers: tiers.filter((_, i) => i !== index) });
  };

  const COLUMN_MAP: Record<string, keyof SolarTier> = {};
  const addMapping = (keys: string[], field: keyof SolarTier) => {
    keys.forEach((k) => { COLUMN_MAP[k.toLowerCase().replace(/[\s._]/g, '')] = field; });
  };
  addMapping(['kWp Min', 'kwpmin', 'kwp_min', 'kwpMin', 'kWpMin'], 'kwpMin');
  addMapping(['kWp Max', 'kwpmax', 'kwp_max', 'kwpMax', 'kWpMax'], 'kwpMax');
  addMapping(['Base Trans', 'Base Trans.', 'base_transaccional', 'baseTransaccional', 'basetrans'], 'baseTransaccional');
  addMapping(['Adic Trans', 'Adic. Trans.', 'Adic Trans.', 'adic_transaccional', 'adicTransaccional', 'adictrans'], 'adicTransaccional');
  addMapping(['Base AAS', 'base_aas', 'baseAas', 'baseaas'], 'baseAas');
  addMapping(['Adic AAS', 'Adic. AAS', 'adic_aas', 'adicAas', 'adicaas'], 'adicAas');

  const resolveField = (header: string): keyof SolarTier | null => {
    const normalized = header.toLowerCase().replace(/[\s._]/g, '');
    return COLUMN_MAP[normalized] ?? null;
  };

  const parseNum = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const s = String(val).replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  const handleImportFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
        if (json.length === 0) { toast.error(t('Ficheiro vazio')); return; }

        const headers = Object.keys(json[0]);
        const fieldMap: Record<string, keyof SolarTier> = {};
        headers.forEach((h) => {
          const field = resolveField(h);
          if (field) fieldMap[h] = field;
        });

        if (Object.keys(fieldMap).length === 0) {
          toast.error(t('Nenhuma coluna reconhecida. Use: kWp Min, kWp Max, Base Trans., Adic. Trans., Base AAS, Adic. AAS'));
          return;
        }

        const imported: SolarTier[] = json.map((row) => {
          const tier: SolarTier = { ...DEFAULT_TIER };
          Object.entries(fieldMap).forEach(([header, field]) => {
            (tier as any)[field] = parseNum(row[header]);
          });
          return tier;
        });

        onChange({ ...rule, tiers: [...tiers, ...imported] });
        toast.success(t('{{n}} escalão(ões) importados', { n: imported.length }));
      } catch {
        toast.error(t('Erro ao ler o ficheiro'));
      }
    };
    reader.readAsArrayBuffer(file);
  }, [tiers, rule, onChange]);

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">{t('Escalões')}</div>

      <div className="relative w-full overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {TIERED_COLUMNS.map((col) => (
                <TableHead key={col.field} className="text-xs whitespace-nowrap">{t(col.label)}</TableHead>
              ))}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tiers.length === 0 && (
              <TableRow>
                <TableCell colSpan={TIERED_COLUMNS.length + 1} className="text-center text-sm text-muted-foreground py-6">
                  {t('Nenhum escalão configurado. Adicione uma linha ou importe um ficheiro.')}
                </TableCell>
              </TableRow>
            )}
            {tiers.map((tier, idx) => (
              <TableRow key={idx}>
                {TIERED_COLUMNS.map((col) => (
                  <TableCell key={col.field} className="p-1.5">
                    <DecimalInput
                      className={`h-8 text-xs ${col.field === 'kwpMin' || col.field === 'kwpMax' ? 'w-20' : 'w-24'}`}
                      value={tier[col.field]}
                      onChange={(v) => updateTier(idx, col.field, v)}
                    />
                  </TableCell>
                ))}
                <TableCell className="p-1.5">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeTier(idx)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addTier} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          {t('Adicionar Linha')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          className="gap-1.5"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          {t('Importar Escalões')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImportFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

// ─── Energy (EE & Gás) Modal ───

const DEFAULT_ENERGY_BANDS: EnergyMarginBand[] = [
  { marginMin: -999999, ponderadorLow: 0, valorLow: 0, ponderador: 0, valor: 0, ponderadorHigh: 0, valorHigh: 0 },
  { marginMin: 0, ponderadorLow: 3.01, valorLow: 0, ponderador: 4.00, valor: 0, ponderadorHigh: 6.00, valorHigh: 0 },
  { marginMin: 500, ponderadorLow: 3.01, valorLow: 15.04, ponderador: 4.00, valor: 20, ponderadorHigh: 6.00, valorHigh: 30 },
  { marginMin: 1000, ponderadorLow: 3.01, valorLow: 30.08, ponderador: 4.00, valor: 40, ponderadorHigh: 6.00, valorHigh: 60 },
  { marginMin: 2000, ponderadorLow: 2.83, valorLow: 60.15, ponderador: 3.76, valor: 80, ponderadorHigh: 5.64, valorHigh: 120 },
  { marginMin: 5000, ponderadorLow: 1.14, valorLow: 145.11, ponderador: 1.52, valor: 193, ponderadorHigh: 2.28, valorHigh: 289.50 },
  { marginMin: 10000, ponderadorLow: 0.96, valorLow: 202.26, ponderador: 1.28, valor: 269, ponderadorHigh: 1.92, valorHigh: 403.50 },
  { marginMin: 20000, ponderadorLow: 0.60, valorLow: 298.50, ponderador: 0.80, valor: 397, ponderadorHigh: 1.20, valorHigh: 595.50 },
];

function EnergyModal({
  config,
  onChange,
  onSave,
  isSaving,
  onClose,
}: {
  config: EnergyCommissionConfig;
  onChange: (c: EnergyCommissionConfig) => void;
  onSave: () => void;
  isSaving: boolean;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const bands = config.bands;
  const { t } = useLanguage();
  const tierRules: TierRules = config.tierRules ?? DEFAULT_TIER_RULES;

  const updateTierRules = (newRules: TierRules) => {
    onChange({ ...config, tierRules: newRules });
  };

  // Map tier key to the band fields it controls (ponderador + valor)
  const TIER_POND_FIELD: Record<string, keyof EnergyMarginBand> = { low: 'ponderadorLow', mid: 'ponderador', high: 'ponderadorHigh' };
  const TIER_VAL_FIELD: Record<string, keyof EnergyMarginBand> = { low: 'valorLow', mid: 'valor', high: 'valorHigh' };

  const applyDerivation = (sourceVal: number, rule: TierDerivationRule): number => {
    if (rule.operation === 'none') return sourceVal;
    const result = rule.operation === 'divide' ? sourceVal / rule.value : sourceVal * rule.value;
    return Math.round(result * 100) / 100;
  };

  const updateBand = (idx: number, field: keyof EnergyMarginBand, value: number) => {
    const newBands = bands.map((b, i) => {
      if (i !== idx) return b;
      const updated = { ...b, [field]: value };

      // Determine which tier was edited
      const editedTierKey =
        (field === 'ponderadorLow' || field === 'valorLow') ? 'low' :
        (field === 'ponderador' || field === 'valor') ? 'mid' :
        (field === 'ponderadorHigh' || field === 'valorHigh') ? 'high' : null;

      const isPonderador = ['ponderador', 'ponderadorLow', 'ponderadorHigh'].includes(field);
      const isValorField = ['valor', 'valorLow', 'valorHigh'].includes(field);

      if (editedTierKey) {
        const sourceKey = `from_${editedTierKey}` as TierDerivationRule['source'];
        // Recalculate all tiers that derive from this edited tier
        (['low', 'mid', 'high'] as const).forEach((tk) => {
          if (tk === editedTierKey) return;
          const rule = tierRules[tk];
          if (rule.source !== sourceKey) return;
          if (isPonderador) {
            const pondField = TIER_POND_FIELD[tk];
            updated[pondField] = applyDerivation(value, rule);
          }
          if (isValorField) {
            const valField = TIER_VAL_FIELD[tk];
            updated[valField] = applyDerivation(value, rule);
          }
        });
      }

      return updated;
    });
    onChange({ ...config, bands: newBands });
  };

  const addBand = () => {
    const lastMin = bands.length > 0 ? bands[bands.length - 1].marginMin : 0;
    onChange({ ...config, bands: [...bands, { marginMin: lastMin + 1000, ponderadorLow: 0, valorLow: 0, ponderador: 0, valor: 0, ponderadorHigh: 0, valorHigh: 0 }] });
  };

  const removeBand = (idx: number) => {
    onChange({ ...config, bands: bands.filter((_, i) => i !== idx) });
  };

  const loadDefaults = () => {
    onChange({ ...config, bands: DEFAULT_ENERGY_BANDS });
  };

  const formatNum = (n: number) => n.toFixed(2).replace('.', ',');


  const handleImportFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
        if (json.length === 0) { toast.error(t('Ficheiro vazio')); return; }

        const parseNum = (val: any): number => {
          if (typeof val === 'number') return val;
          if (!val) return 0;
          const s = String(val).replace(',', '.');
          const n = parseFloat(s);
          return isNaN(n) ? 0 : n;
        };

        const imported: EnergyMarginBand[] = json.map((row) => {
          const keys = Object.keys(row);
          return {
            marginMin: parseNum(row[keys[0]]),
            ponderadorLow: parseNum(row[keys[1]]),
            valorLow: parseNum(row[keys[2]]),
            ponderador: parseNum(row[keys[3]]),
            valor: parseNum(row[keys[4]]),
            ponderadorHigh: parseNum(row[keys[5]]),
            valorHigh: parseNum(row[keys[6]]),
          };
        });

        onChange({ ...config, bands: [...bands, ...imported] });
        toast.success(t('{{n}} banda(s) importadas', { n: imported.length }));
      } catch {
        toast.error(t('Erro ao ler o ficheiro'));
      }
    };
    reader.readAsArrayBuffer(file);
  }, [bands, config, onChange]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent variant="fullScreen" className="flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="shrink-0 border-b px-4 sm:px-6 py-4 pr-14">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            <DialogTitle className="text-base sm:text-lg">{t('EE & Gás — Comissões por Margem')}</DialogTitle>
          </div>
          <DialogDescription>
            {t('Configure as bandas de margem e comissões para cada faixa de volume.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-6">

          {/* Tier derivation rules */}
          <div className="space-y-3">
            <div className="text-sm font-medium">{t('Regras de Derivação por Volume')}</div>
            <p className="text-xs text-muted-foreground">{t('Selecione a coluna de referência e, opcionalmente, uma operação (× ou ÷) com um valor para derivar automaticamente.')}</p>
            <div className="grid gap-3">
              {([
                { key: 'low' as const, label: '0-300 MWh', selfSource: 'from_low' as const },
                { key: 'mid' as const, label: '301-600 MWh', selfSource: 'from_mid' as const },
                { key: 'high' as const, label: '601+ MWh', selfSource: 'from_high' as const },
              ]).map(({ key, label, selfSource }) => {
                const rule = tierRules[key];
                const isSelf = rule.source === selfSource;
                return (
                  <div key={key} className="flex flex-wrap items-center gap-2 rounded-md border p-3 bg-muted/30">
                    <span className="text-xs font-medium w-24 shrink-0">{label}</span>
                    <Select
                      value={rule.source}
                      onValueChange={(v) => {
                        const newSource = v as TierDerivationRule['source'];
                        const newRule: TierDerivationRule = newSource === selfSource
                          ? { source: newSource, operation: 'multiply', value: 1 }
                          : { ...rule, source: newSource };
                        updateTierRules({ ...tierRules, [key]: newRule });
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="from_low">0-300 MWh</SelectItem>
                        <SelectItem value="from_mid">301-600 MWh</SelectItem>
                        <SelectItem value="from_high">601+ MWh</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={rule.operation}
                      onValueChange={(v) => updateTierRules({ ...tierRules, [key]: { ...rule, operation: v as 'multiply' | 'divide' | 'none' } })}
                    >
                      <SelectTrigger className="h-8 text-xs w-[70px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        <SelectItem value="multiply">×</SelectItem>
                        <SelectItem value="divide">÷</SelectItem>
                      </SelectContent>
                    </Select>
                    {rule.operation !== 'none' && (
                      <Input
                        type="number"
                        step="0.01"
                        min={0.01}
                        className="h-8 text-xs w-20"
                        value={rule.value}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v) && v > 0) updateTierRules({ ...tierRules, [key]: { ...rule, value: v } });
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bands table */}
          <div className="space-y-3">
            <div className="text-sm font-medium">{t('Bandas de Margem')}</div>
            <div className="relative w-full overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead rowSpan={2} className="text-xs whitespace-nowrap align-bottom border-r">{t('Banda de Margem (€)')}</TableHead>
                     <TableHead colSpan={2} className="text-xs text-center border-r">300 MWh</TableHead>
                     <TableHead colSpan={2} className="text-xs text-center border-r">301-600 MWh</TableHead>
                     <TableHead colSpan={2} className="text-xs text-center border-r">601+ MWh</TableHead>
                     <TableHead rowSpan={2} className="w-10 align-bottom" />
                   </TableRow>
                   <TableRow>
                     <TableHead className="text-[10px] text-center">{t('Pond. (%)')}</TableHead>
                     <TableHead className="text-[10px] text-center border-r">{t('Valor (€)')}</TableHead>
                     <TableHead className="text-[10px] text-center">{t('Pond. (%)')}</TableHead>
                     <TableHead className="text-[10px] text-center border-r">{t('Valor (€)')}</TableHead>
                     <TableHead className="text-[10px] text-center">{t('Pond. (%)')}</TableHead>
                     <TableHead className="text-[10px] text-center border-r">{t('Valor (€)')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bands.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">
                        {t('Nenhuma banda configurada. Adicione uma linha, importe um ficheiro ou carregue valores padrão.')}
                      </TableCell>
                    </TableRow>
                  )}
                  {bands.map((band, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="p-1.5 border-r">
                        <DecimalInput className="h-8 text-xs w-24" value={band.marginMin} onChange={(v) => updateBand(idx, 'marginMin', v)} />
                      </TableCell>
                       {/* 300 MWh */}
                       <TableCell className="p-1.5">
                         <DecimalInput className="h-8 text-xs w-20" value={band.ponderadorLow} onChange={(v) => updateBand(idx, 'ponderadorLow', v)} />
                       </TableCell>
                       <TableCell className="p-1.5 border-r">
                         <DecimalInput className="h-8 text-xs w-24" value={band.valorLow} onChange={(v) => updateBand(idx, 'valorLow', v)} />
                       </TableCell>
                       {/* 301-600 MWh */}
                       <TableCell className="p-1.5">
                         <DecimalInput className="h-8 text-xs w-20" value={band.ponderador} onChange={(v) => updateBand(idx, 'ponderador', v)} />
                       </TableCell>
                       <TableCell className="p-1.5 border-r">
                         <DecimalInput className="h-8 text-xs w-24" value={band.valor} onChange={(v) => updateBand(idx, 'valor', v)} />
                       </TableCell>
                       {/* 601+ MWh */}
                       <TableCell className="p-1.5">
                         <DecimalInput className="h-8 text-xs w-20" value={band.ponderadorHigh} onChange={(v) => updateBand(idx, 'ponderadorHigh', v)} />
                       </TableCell>
                       <TableCell className="p-1.5 border-r">
                         <DecimalInput className="h-8 text-xs w-24" value={band.valorHigh} onChange={(v) => updateBand(idx, 'valorHigh', v)} />
                       </TableCell>
                      <TableCell className="p-1.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeBand(idx)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button type="button" variant="outline" size="sm" onClick={addBand} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                {t('Adicionar Banda')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1.5">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                {t('Importar')}
              </Button>
              {bands.length === 0 && (
                <Button type="button" variant="outline" size="sm" onClick={loadDefaults} className="gap-1.5">
                  {t('Carregar Predefinidos')}
                </Button>
              )}
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImportFile(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          {/* Formula preview */}
          <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
            <span>{t('Comissão = Valor + (Margem − Limite_Banda) × (Ponderador / 100). Cada faixa de volume (300, 301-600, 601+) usa os seus valores próprios.')}</span>
          </div>
        </div>

        <div className="shrink-0 border-t px-4 sm:px-6 py-3 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>{t('Cancelar')}</Button>
          <Button onClick={onSave} disabled={isSaving} className="gap-1.5">
            <Save className="h-4 w-4" />
            {isSaving ? t('A guardar...') : t('Guardar')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Decimal Input ───

const DecimalInput = forwardRef<HTMLInputElement, {
  value: number;
  onChange: (v: number) => void;
  className?: string;
}>(({ value, onChange, className }, ref) => {
  const format = (n: number) => (n === 0 ? '0' : String(n).replace('.', ','));
  const [text, setText] = useState(() => format(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(format(value));
  }, [value, focused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9.,]/g, '');
    setText(raw);
  };

  const handleBlur = () => {
    setFocused(false);
    const normalized = text.replace(',', '.');
    const parsed = parseFloat(normalized);
    const final = isNaN(parsed) ? 0 : parsed;
    onChange(final);
    setText(format(final));
  };

  return (
    <Input
      ref={ref}
      type="text"
      inputMode="decimal"
      className={className}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
});
DecimalInput.displayName = 'DecimalInput';
