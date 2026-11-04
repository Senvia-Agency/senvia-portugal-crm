import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Loader2, User, Mail, Phone, Building, FileText, MapPin, MessageSquare, Save, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useClientFieldsSettings, useUpdateClientFieldsSettings } from '@/hooks/useClientFieldsSettings';
import { ClientFieldKey, ClientFieldsSettings, DEFAULT_CLIENT_FIELDS_SETTINGS } from '@/types/clients';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLanguage } from '@/i18n';

const FIELD_ICONS: Record<ClientFieldKey, React.ReactNode> = {
  name: <User className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  phone: <Phone className="h-4 w-4" />,
  company: <Building className="h-4 w-4" />,
  company_nif: <FileText className="h-4 w-4" />,
  nif: <FileText className="h-4 w-4" />,
  address: <MapPin className="h-4 w-4" />,
  notes: <MessageSquare className="h-4 w-4" />,
};

const FIELD_ORDER: ClientFieldKey[] = ['name', 'email', 'phone', 'company', 'company_nif', 'nif', 'address', 'notes'];

export function ClientFieldsEditor() {
  const { data: savedSettings, isLoading } = useClientFieldsSettings();
  const updateSettings = useUpdateClientFieldsSettings();
  const { t } = useLanguage();
  const [settings, setSettings] = useState<ClientFieldsSettings>(DEFAULT_CLIENT_FIELDS_SETTINGS);
  const [hasChanges, setHasChanges] = useState(false);

  // Validation: At least one of name or company must be visible AND required
  const hasIdentificationField = useMemo(() => {
    return (settings.name.visible && settings.name.required) || 
           (settings.company.visible && settings.company.required);
  }, [settings.name, settings.company]);

  // Initialize from saved settings
  useEffect(() => {
    if (savedSettings) {
      setSettings(savedSettings);
      setHasChanges(false);
    }
  }, [savedSettings]);

  const updateField = (
    fieldKey: ClientFieldKey, 
    updates: Partial<{ visible: boolean; required: boolean; label: string }>
  ) => {
    setSettings(prev => ({
      ...prev,
      [fieldKey]: {
        ...prev[fieldKey],
        ...updates,
        // If hiding a field, also remove required
        ...(updates.visible === false ? { required: false } : {}),
      },
    }));
    setHasChanges(true);
  };

  const handleSave = () => {
    updateSettings.mutate(settings, {
      onSuccess: () => setHasChanges(false),
    });
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
          {t('Campos Obrigatórios')}
        </CardTitle>
        <CardDescription>
          {t('Configure quais campos são visíveis e obrigatórios ao criar ou editar registos.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground pb-2 border-b">
          <div className="flex items-center gap-1.5">
            <Eye className="h-4 w-4" />
            <span>{t('Visível')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-destructive font-medium">*</span>
            <span>{t('Obrigatório')}</span>
          </div>
        </div>

        {/* Field List */}
        <div className="space-y-3">
          {FIELD_ORDER.map((fieldKey) => {
            const field = settings[fieldKey] ?? DEFAULT_CLIENT_FIELDS_SETTINGS[fieldKey];
            
            return (
              <div 
                key={fieldKey}
                className={`flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border ${
                  field.visible ? 'bg-card' : 'bg-muted/30'
                }`}
              >
                {/* Icon and Label Input */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className={`p-2 rounded-md ${field.visible ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {FIELD_ICONS[fieldKey]}
                  </div>
                  <Input
                    value={field.label}
                    onChange={(e) => updateField(fieldKey, { label: e.target.value })}
                    className="flex-1 h-9"
                    disabled={!field.visible}
                  />
                </div>

                {/* Toggles */}
                <div className="flex items-center gap-4 sm:gap-6 ml-10 sm:ml-0">
                  {/* Visible Toggle */}
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`visible-${fieldKey}`}
                      checked={field.visible}
                      onCheckedChange={(checked) => updateField(fieldKey, { visible: checked })}
                    />
                    <Label 
                      htmlFor={`visible-${fieldKey}`} 
                      className="text-xs text-muted-foreground cursor-pointer"
                    >
                      {field.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </Label>
                  </div>

                  {/* Required Toggle */}
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`required-${fieldKey}`}
                      checked={field.required}
                      onCheckedChange={(checked) => updateField(fieldKey, { required: checked })}
                      disabled={!field.visible}
                    />
                    <Label 
                      htmlFor={`required-${fieldKey}`} 
                      className={`text-xs cursor-pointer ${field.required ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
                    >
                      *
                    </Label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Validation Alert */}
        {!hasIdentificationField && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {t('Pelo menos Nome ou Empresa deve ser visível e obrigatório para identificar o cliente.')}
            </AlertDescription>
          </Alert>
        )}

        {/* Info */}
        <p className="text-xs text-muted-foreground">
          {t('Para criar clientes, é necessário ter pelo menos o campo Nome ou Empresa visível e obrigatório.')}
        </p>

        {/* Save Button */}
        <div className="flex justify-end pt-4">
          <Button 
            onClick={handleSave}
            disabled={!hasChanges || updateSettings.isPending || !hasIdentificationField}
          >
            {updateSettings.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {t('Guardar Alterações')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
