import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { 
  Type, 
  Hash, 
  List, 
  CheckSquare, 
  AlignLeft,
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Asterisk,
  Mail,
  Phone,
  User,
  MessageSquare,
  FileText,
} from 'lucide-react';
import { FormSettings, CustomField, FieldType, FIELD_TYPE_LABELS } from '@/types';
import { AddFieldModal } from './AddFieldModal';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n';

interface CustomFieldsEditorProps {
  settings: FormSettings;
  onUpdateSettings: (settings: FormSettings) => void;
}

const FIELD_ICONS: Record<FieldType, React.ComponentType<{ className?: string }>> = {
  text: Type,
  number: Hash,
  select: List,
  checkbox: CheckSquare,
  textarea: AlignLeft,
};

type FixedFieldKey = 'name' | 'email' | 'phone' | 'message';

const FIXED_FIELD_ICONS: Record<FixedFieldKey, React.ComponentType<{ className?: string }>> = {
  name: User,
  email: Mail,
  phone: Phone,
  message: MessageSquare,
};

const FIXED_FIELD_TYPES: Record<FixedFieldKey, string> = {
  name: 'Texto',
  email: 'Email',
  phone: 'Telefone',
  message: 'Texto Longo',
};

export function CustomFieldsEditor({ settings, onUpdateSettings }: CustomFieldsEditorProps) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const { t } = useLanguage();

  // Update fixed field configuration
  const updateFixedField = (
    fieldKey: FixedFieldKey,
    updates: Partial<{ visible: boolean; required: boolean; label: string }>
  ) => {
    onUpdateSettings({
      ...settings,
      fields: {
        ...settings.fields,
        [fieldKey]: {
          ...settings.fields[fieldKey],
          ...updates,
        },
      },
    });
  };

  // Add (show) a fixed field
  const addFixedField = (fieldKey: FixedFieldKey) => {
    updateFixedField(fieldKey, { visible: true, required: true });
  };

  // Remove (hide) a fixed field
  const removeFixedField = (fieldKey: FixedFieldKey) => {
    updateFixedField(fieldKey, { visible: false, required: false });
  };

  const addField = (field: Omit<CustomField, 'id' | 'order'>) => {
    const newField: CustomField = {
      ...field,
      id: crypto.randomUUID(),
      order: settings.custom_fields.length,
    };
    onUpdateSettings({
      ...settings,
      custom_fields: [...settings.custom_fields, newField],
    });
  };

  const updateField = (id: string, updates: Partial<CustomField>) => {
    onUpdateSettings({
      ...settings,
      custom_fields: settings.custom_fields.map(f => 
        f.id === id ? { ...f, ...updates } : f
      ),
    });
  };

  const removeField = (id: string) => {
    onUpdateSettings({
      ...settings,
      custom_fields: settings.custom_fields
        .filter(f => f.id !== id)
        .map((f, idx) => ({ ...f, order: idx })),
    });
  };

  const moveField = (id: string, direction: 'up' | 'down') => {
    const fields = [...settings.custom_fields];
    const idx = fields.findIndex(f => f.id === id);
    if (idx === -1) return;
    
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= fields.length) return;
    
    [fields[idx], fields[targetIdx]] = [fields[targetIdx], fields[idx]];
    onUpdateSettings({
      ...settings,
      custom_fields: fields.map((f, i) => ({ ...f, order: i })),
    });
  };

  const sortedCustomFields = [...settings.custom_fields].sort((a, b) => a.order - b.order);

  // Get active fixed fields (visible = true)
  const fixedFieldKeys: FixedFieldKey[] = ['name', 'email', 'phone', 'message'];
  const activeFixedFields = fixedFieldKeys.filter(key => settings.fields[key]?.visible === true);

  // Total active fields count
  const totalActiveFields = activeFixedFields.length + sortedCustomFields.length;

  const renderActiveFixedField = (fieldKey: FixedFieldKey) => {
    const field = settings.fields[fieldKey];
    const Icon = FIXED_FIELD_ICONS[fieldKey];
    
    return (
      <div 
        key={fieldKey}
        className="group flex items-center gap-2 sm:gap-3 rounded-lg border p-2 sm:p-3 bg-card border-border"
      >
        {/* Required Toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => updateFixedField(fieldKey, { required: !field.required })}
              className={cn(
                "p-2 rounded-md transition-all shrink-0 hover:scale-110",
                field.required 
                  ? "text-amber-500 bg-amber-500/10 hover:bg-amber-500/20" 
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              <Asterisk className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {field.required ? t("Clique para tornar opcional") : t("Clique para tornar obrigatório")}
          </TooltipContent>
        </Tooltip>
        
        {/* Field Icon */}
        <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-md flex items-center justify-center shrink-0 bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        
        {/* Label Input */}
        <Input
          value={field.label || ''}
          onChange={(e) => updateFixedField(fieldKey, { label: e.target.value })}
          className="flex-1 min-w-0 h-9"
          placeholder={t("Label do campo")}
          maxLength={50}
        />

        {/* Type Badge */}
        <Badge variant="secondary" className="shrink-0 hidden sm:inline-flex">
          {t(FIXED_FIELD_TYPES[fieldKey])}
        </Badge>
        
        {/* Remove Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => removeFixedField(fieldKey)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {t('Remover campo')}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  };

  const renderCustomField = (field: CustomField, idx: number) => {
    const Icon = FIELD_ICONS[field.type];
    
    return (
      <div 
        key={field.id} 
        className="group flex items-center gap-2 sm:gap-3 rounded-lg border bg-card p-2 sm:p-3 border-border"
      >
        {/* Required Toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => updateField(field.id, { required: !field.required })}
              className={cn(
                "p-2 rounded-md transition-all shrink-0 hover:scale-110",
                field.required 
                  ? "text-amber-500 bg-amber-500/10 hover:bg-amber-500/20" 
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              <Asterisk className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {field.required ? t("Clique para tornar opcional") : t("Clique para tornar obrigatório")}
          </TooltipContent>
        </Tooltip>

        {/* Field Icon */}
        <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-md flex items-center justify-center shrink-0 bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        
        {/* Label Input */}
        <Input
          value={field.label || ''}
          onChange={(e) => updateField(field.id, { label: e.target.value })}
          className="flex-1 min-w-[140px] h-9"
          placeholder={t("Label do campo")}
          maxLength={50}
        />
        
        {/* Type Badge */}
        <Badge variant="secondary" className="shrink-0 hidden sm:inline-flex">
          {t(FIELD_TYPE_LABELS[field.type])}
          {field.type === 'select' && field.options && ` (${field.options.length})`}
        </Badge>
        
        {/* Actions - Mobile: always visible */}
        <div className="flex items-center gap-0.5 sm:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => moveField(field.id, 'up')}
            disabled={idx === 0}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => moveField(field.id, 'down')}
            disabled={idx === sortedCustomFields.length - 1}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setEditingField(field)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => removeField(field.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Actions - Desktop: hidden until hover (display:none to not occupy space) */}
        <div className="hidden items-center gap-0.5 sm:group-hover:flex">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => moveField(field.id, 'up')}
                disabled={idx === 0}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('Mover para cima')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => moveField(field.id, 'down')}
                disabled={idx === sortedCustomFields.length - 1}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('Mover para baixo')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setEditingField(field)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('Editar campo')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => removeField(field.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('Remover campo')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Empty State */}
      {totalActiveFields === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <FileText className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium mb-1">{t('Nenhum campo adicionado')}</h3>
          <p className="text-xs text-muted-foreground mb-4 max-w-[200px]">
            {t('Clique no botão abaixo para adicionar campos ao formulário')}
          </p>
          <Button onClick={() => setIsAddModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('Adicionar Campo')}
          </Button>
        </div>
      ) : (
        <>
          {/* Legend */}
          <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground bg-muted/50 rounded-lg p-2">
            <span className="flex items-center gap-1.5">
              <Asterisk className="h-3.5 w-3.5 text-amber-500" />
              {t('Obrigatório')}
            </span>
            <span className="flex items-center gap-1.5">
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
              {t('Remover')}
            </span>
          </div>
          
          {/* Fields List */}
          <div className="space-y-2">
            {/* Active Fixed Fields */}
            {activeFixedFields.map(fieldKey => renderActiveFixedField(fieldKey))}
            
            {/* Custom Fields */}
            {sortedCustomFields.map((field, idx) => renderCustomField(field, idx))}
          </div>

          {/* Add Field Button */}
          <Button 
            variant="outline" 
            className="w-full" 
            onClick={() => setIsAddModalOpen(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('Adicionar Campo')}
          </Button>
        </>
      )}

      {/* Add Field Modal */}
      <AddFieldModal
        open={isAddModalOpen}
        onOpenChange={setIsAddModalOpen}
        onAdd={addField}
        onAddFixedField={addFixedField}
        currentSettings={settings}
      />

      {/* Edit Field Modal */}
      {editingField && (
        <AddFieldModal
          open={!!editingField}
          onOpenChange={(open) => !open && setEditingField(null)}
          onAdd={(updates) => {
            updateField(editingField.id, updates);
            setEditingField(null);
          }}
          initialField={editingField}
          isEditing
        />
      )}
    </div>
  );
}
