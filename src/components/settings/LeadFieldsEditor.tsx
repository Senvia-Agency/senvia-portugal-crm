import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Loader2, User, Mail, Phone, Globe, Thermometer, DollarSign, MessageSquare, Save, Eye, EyeOff, AlertCircle, FileText, Building2, ClipboardList, Zap } from 'lucide-react';
import { useLeadFieldsSettings, useUpdateLeadFieldsSettings } from '@/hooks/useLeadFieldsSettings';
import { LeadFieldKey, LeadFieldsSettings, DEFAULT_LEAD_FIELDS_SETTINGS, LEAD_FIELD_ORDER } from '@/types/field-settings';
import { useLanguage } from '@/i18n';
import { Alert, AlertDescription } from '@/components/ui/alert';

const FIELD_ICONS: Record<LeadFieldKey, React.ReactNode> = {
  company_nif: <FileText className="h-4 w-4" />,
  company_name: <Building2 className="h-4 w-4" />,
  name: <User className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  phone: <Phone className="h-4 w-4" />,
  source: <Globe className="h-4 w-4" />,
  temperature: <Thermometer className="h-4 w-4" />,
  tipologia: <ClipboardList className="h-4 w-4" />,
  consumo_anual: <Zap className="h-4 w-4" />,
  value: <DollarSign className="h-4 w-4" />,
  notes: <MessageSquare className="h-4 w-4" />,
};

export function LeadFieldsEditor() {
  const { data: savedSettings, isLoading } = useLeadFieldsSettings();
  const updateSettings = useUpdateLeadFieldsSettings();
  const { t } = useLanguage();
  const [settings, setSettings] = useState<LeadFieldsSettings>(DEFAULT_LEAD_FIELDS_SETTINGS);
  const [hasChanges, setHasChanges] = useState(false);

  const hasIdentificationField = useMemo(() => {
    return (
      (settings.name.visible && settings.name.required) ||
      (settings.company_name.visible && settings.company_name.required) ||
      (settings.company_nif.visible && settings.company_nif.required)
    );
  }, [settings.name, settings.company_name, settings.company_nif]);

  useEffect(() => {
    if (savedSettings) {
      setSettings(savedSettings);
      setHasChanges(false);
    }
  }, [savedSettings]);

  const updateField = (fieldKey: LeadFieldKey, updates: Partial<{ visible: boolean; required: boolean; label: string }>) => {
    setSettings(prev => ({
      ...prev,
      [fieldKey]: {
        ...prev[fieldKey],
        ...updates,
        ...(updates.visible === false ? { required: false } : {}),
      },
    }));
    setHasChanges(true);
  };

  const handleSave = () => {
    updateSettings.mutate(settings, { onSuccess: () => setHasChanges(false) });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          {t('Campos de Leads')}
        </CardTitle>
        <CardDescription>{t('Configure quais campos são visíveis e obrigatórios ao criar ou editar leads.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground pb-2 border-b">
          <div className="flex items-center gap-1.5"><Eye className="h-4 w-4" /><span>{t('Visível')}</span></div>
          <div className="flex items-center gap-1.5"><span className="text-destructive font-medium">*</span><span>{t('Obrigatório')}</span></div>
        </div>

        <div className="space-y-3">
          {LEAD_FIELD_ORDER.map((fieldKey) => {
            const field = settings[fieldKey] ?? DEFAULT_LEAD_FIELDS_SETTINGS[fieldKey];
            return (
              <div key={fieldKey} className={`flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border ${field.visible ? 'bg-card' : 'bg-muted/30'}`}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className={`p-2 rounded-md ${field.visible ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {FIELD_ICONS[fieldKey]}
                  </div>
                  <Input value={field.label} onChange={(e) => updateField(fieldKey, { label: e.target.value })} className="flex-1 h-9" disabled={!field.visible} />
                </div>
                <div className="flex items-center gap-4 sm:gap-6 ml-10 sm:ml-0">
                  <div className="flex items-center gap-2">
                    <Switch id={`visible-${fieldKey}`} checked={field.visible} onCheckedChange={(checked) => updateField(fieldKey, { visible: checked })} />
                    <Label htmlFor={`visible-${fieldKey}`} className="text-xs text-muted-foreground cursor-pointer">
                      {field.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id={`required-${fieldKey}`} checked={field.required} onCheckedChange={(checked) => updateField(fieldKey, { required: checked })} disabled={!field.visible} />
                    <Label htmlFor={`required-${fieldKey}`} className={`text-xs cursor-pointer ${field.required ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>*</Label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {!hasIdentificationField && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{t('Pelo menos um campo de identificação (Nome, Nome Empresa ou NIF Empresa) deve ser visível e obrigatório.')}</AlertDescription>
          </Alert>
        )}

        <p className="text-xs text-muted-foreground">{t('Pelo menos um campo de identificação (Nome, Nome Empresa ou NIF) é necessário para identificar cada lead.')}</p>

        <div className="flex justify-end pt-4">
          <Button onClick={handleSave} disabled={!hasChanges || updateSettings.isPending || !hasIdentificationField}>
            {updateSettings.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            {t('Guardar Alterações')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
