import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Loader2, DollarSign, CreditCard, Calendar, MessageSquare, Save, Eye, EyeOff, ShoppingCart, FileText } from 'lucide-react';
import { useSaleFieldsSettings, useUpdateSaleFieldsSettings } from '@/hooks/useSaleFieldsSettings';
import { SaleFieldKey, SaleFieldsSettings, DEFAULT_SALE_FIELDS_SETTINGS, SALE_FIELD_ORDER } from '@/types/field-settings';
import { useAuth } from '@/contexts/AuthContext';
import { useModules } from '@/hooks/useModules';
import { useLanguage } from '@/i18n';

const FIELD_ICONS: Record<SaleFieldKey, React.ReactNode> = {
  value: <DollarSign className="h-4 w-4" />,
  payment_method: <CreditCard className="h-4 w-4" />,
  due_date: <Calendar className="h-4 w-4" />,
  notes: <MessageSquare className="h-4 w-4" />,
  edp_proposal_number: <FileText className="h-4 w-4" />,
};

export function SaleFieldsEditor() {
  const { t } = useLanguage();
  const { data: savedSettings, isLoading } = useSaleFieldsSettings();
  const updateSettings = useUpdateSaleFieldsSettings();
  const { organization } = useAuth();
  const { modules } = useModules();
  const showEnergy = organization?.niche === 'telecom' && modules.energy;
  // EDP proposal number is energy-specific — only configurable for energy orgs
  const fieldOrder = showEnergy ? SALE_FIELD_ORDER : SALE_FIELD_ORDER.filter((k) => k !== 'edp_proposal_number');
  const [settings, setSettings] = useState<SaleFieldsSettings>(DEFAULT_SALE_FIELDS_SETTINGS);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (savedSettings) { setSettings(savedSettings); setHasChanges(false); }
  }, [savedSettings]);

  const updateField = (fieldKey: SaleFieldKey, updates: Partial<{ visible: boolean; required: boolean; label: string }>) => {
    setSettings(prev => ({
      ...prev,
      [fieldKey]: { ...prev[fieldKey], ...updates, ...(updates.visible === false ? { required: false } : {}) },
    }));
    setHasChanges(true);
  };

  const handleSave = () => {
    updateSettings.mutate(settings, { onSuccess: () => setHasChanges(false) });
  };

  if (isLoading) {
    return <Card><CardContent className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" />{t('Campos de Vendas')}</CardTitle>
        <CardDescription>{t('Configure quais campos são visíveis e obrigatórios ao criar vendas.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground pb-2 border-b">
          <div className="flex items-center gap-1.5"><Eye className="h-4 w-4" /><span>{t('Visível')}</span></div>
          <div className="flex items-center gap-1.5"><span className="text-destructive font-medium">*</span><span>{t('Obrigatório')}</span></div>
        </div>

        <div className="space-y-3">
          {fieldOrder.map((fieldKey) => {
            const field = settings[fieldKey] ?? DEFAULT_SALE_FIELDS_SETTINGS[fieldKey];
            return (
              <div key={fieldKey} className={`flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border ${field.visible ? 'bg-card' : 'bg-muted/30'}`}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className={`p-2 rounded-md ${field.visible ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{FIELD_ICONS[fieldKey]}</div>
                  <Input value={field.label} onChange={(e) => updateField(fieldKey, { label: e.target.value })} className="flex-1 h-9" disabled={!field.visible} />
                </div>
                <div className="flex items-center gap-4 sm:gap-6 ml-10 sm:ml-0">
                  <div className="flex items-center gap-2">
                    <Switch id={`sv-${fieldKey}`} checked={field.visible} onCheckedChange={(checked) => updateField(fieldKey, { visible: checked })} />
                    <Label htmlFor={`sv-${fieldKey}`} className="text-xs text-muted-foreground cursor-pointer">{field.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id={`sr-${fieldKey}`} checked={field.required} onCheckedChange={(checked) => updateField(fieldKey, { required: checked })} disabled={!field.visible} />
                    <Label htmlFor={`sr-${fieldKey}`} className={`text-xs cursor-pointer ${field.required ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>*</Label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end pt-4">
          <Button onClick={handleSave} disabled={!hasChanges || updateSettings.isPending}>
            {updateSettings.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            {t('Guardar Alterações')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
