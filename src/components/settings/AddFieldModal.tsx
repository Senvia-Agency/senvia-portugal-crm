import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Type, 
  Hash, 
  List, 
  CheckSquare, 
  AlignLeft,
  Plus,
  X,
  Mail,
  Phone,
  User,
  MessageSquare,
  Check,
} from 'lucide-react';
import { CustomField, FieldType, FIELD_TYPE_LABELS, FormSettings } from '@/types';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n';

type FixedFieldKey = 'name' | 'email' | 'phone' | 'message';

interface AddFieldModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (field: Omit<CustomField, 'id' | 'order'>) => void;
  onAddFixedField?: (fieldKey: FixedFieldKey) => void;
  initialField?: CustomField;
  isEditing?: boolean;
  currentSettings?: FormSettings;
}

const FIELD_TYPES: { type: FieldType; icon: typeof Type; description: string }[] = [
  { type: 'text', icon: Type, description: 'Campo de texto simples' },
  { type: 'number', icon: Hash, description: 'Apenas números' },
  { type: 'select', icon: List, description: 'Lista de opções' },
  { type: 'checkbox', icon: CheckSquare, description: 'Sim ou Não' },
  { type: 'textarea', icon: AlignLeft, description: 'Texto longo' },
];

const FIXED_FIELDS: { key: FixedFieldKey; icon: typeof User; label: string; description: string }[] = [
  { key: 'name', icon: User, label: 'Nome Completo', description: 'Campo de nome' },
  { key: 'email', icon: Mail, label: 'Email', description: 'Campo de email' },
  { key: 'phone', icon: Phone, label: 'Telemóvel', description: 'Campo de telefone' },
  { key: 'message', icon: MessageSquare, label: 'Mensagem', description: 'Campo de texto longo' },
];

export function AddFieldModal({ 
  open, 
  onOpenChange, 
  onAdd,
  onAddFixedField,
  initialField,
  isEditing = false,
  currentSettings,
}: AddFieldModalProps) {
  const [activeTab, setActiveTab] = useState<'base' | 'custom'>('base');
  const [type, setType] = useState<FieldType>('text');
  const [label, setLabel] = useState('');
  const [placeholder, setPlaceholder] = useState('');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState<string[]>(['']);
  const { t } = useLanguage();

  // Reset form when opening/closing or when initialField changes
  useEffect(() => {
    if (open && initialField) {
      setActiveTab('custom');
      setType(initialField.type);
      setLabel(initialField.label);
      setPlaceholder(initialField.placeholder || '');
      setRequired(initialField.required);
      setOptions(initialField.options?.length ? initialField.options : ['']);
    } else if (open && !initialField) {
      setActiveTab('base');
      setType('text');
      setLabel('');
      setPlaceholder('');
      setRequired(false);
      setOptions(['']);
    }
  }, [open, initialField]);

  const handleSubmitCustom = () => {
    if (!label.trim()) return;

    const field: Omit<CustomField, 'id' | 'order'> = {
      type,
      label: label.trim(),
      placeholder: placeholder.trim() || undefined,
      required,
      options: type === 'select' ? [...new Set(options.map(o => o.trim()).filter(Boolean))] : undefined,
    };

    onAdd(field);
    onOpenChange(false);
  };

  const handleAddFixedField = (fieldKey: FixedFieldKey) => {
    if (onAddFixedField) {
      onAddFixedField(fieldKey);
      onOpenChange(false);
    }
  };

  const addOption = () => {
    setOptions([...options, '']);
  };

  const updateOption = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  };

  const removeOption = (index: number) => {
    if (options.length <= 1) return;
    setOptions(options.filter((_, i) => i !== index));
  };

  const showPlaceholder = type === 'text' || type === 'number' || type === 'textarea';
  const showOptions = type === 'select';

  // Check which fixed fields are already added
  const isFixedFieldAdded = (fieldKey: FixedFieldKey): boolean => {
    if (!currentSettings) return false;
    return currentSettings.fields[fieldKey]?.visible === true;
  };

  // If editing, only show custom tab content
  if (isEditing) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[480px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('Editar Campo')}</DialogTitle>
            <DialogDescription>
              {t('Altere as propriedades do campo personalizado.')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Field Type Selection */}
            <div className="space-y-3">
              <Label>{t('Tipo de Campo')}</Label>
              <div className="grid grid-cols-5 gap-2">
                {FIELD_TYPES.map(({ type: fieldType, icon: Icon, description }) => (
                  <button
                    key={fieldType}
                    type="button"
                    onClick={() => setType(fieldType)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border p-3 transition-all hover:bg-muted/50",
                      type === fieldType && "border-primary bg-primary/5 ring-1 ring-primary"
                    )}
                    title={t(description)}
                  >
                    <Icon className={cn(
                      "h-5 w-5",
                      type === fieldType ? "text-primary" : "text-muted-foreground"
                    )} />
                    <span className={cn(
                      "text-[10px] font-medium",
                      type === fieldType ? "text-primary" : "text-muted-foreground"
                    )}>
                      {t(FIELD_TYPE_LABELS[fieldType])}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Label */}
            <div className="space-y-2">
              <Label htmlFor="field-label">{t('Label *')}</Label>
              <Input
                id="field-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t('Ex: Empresa, Orçamento...')}
                maxLength={50}
              />
            </div>

            {/* Placeholder */}
            {showPlaceholder && (
              <div className="space-y-2">
                <Label htmlFor="field-placeholder">{t('Placeholder')}</Label>
                <Input
                  id="field-placeholder"
                  value={placeholder}
                  onChange={(e) => setPlaceholder(e.target.value)}
                  placeholder={t('Texto de exemplo')}
                  maxLength={100}
                />
              </div>
            )}

            {/* Options for Select */}
            {showOptions && (
              <div className="space-y-3">
                <Label>{t('Opções *')}</Label>
                <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2">
                  {options.map((option, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-5">{idx + 1}.</span>
                      <Input
                        value={option}
                        onChange={(e) => updateOption(idx, e.target.value)}
                        placeholder={t('Opção {{n}}', { n: idx + 1 })}
                        maxLength={100}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 flex-shrink-0"
                        onClick={() => removeOption(idx)}
                        disabled={options.length <= 1}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addOption}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('Adicionar Opção')}
                </Button>
              </div>
            )}

            {/* Required Toggle */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="field-required" className="font-medium cursor-pointer">
                  {t('Campo Obrigatório')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('O visitante terá de preencher este campo')}
                </p>
              </div>
              <Switch
                id="field-required"
                checked={required}
                onCheckedChange={setRequired}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('Cancelar')}
            </Button>
            <Button 
              onClick={handleSubmitCustom}
              disabled={!label.trim() || (showOptions && options.filter(o => o.trim()).length === 0)}
            >
              {t('Guardar Alterações')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Adicionar Campo')}</DialogTitle>
          <DialogDescription>
            {t('Escolha um campo base ou crie um personalizado.')}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'base' | 'custom')} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="base">{t('Campos Base')}</TabsTrigger>
            <TabsTrigger value="custom">{t('Personalizado')}</TabsTrigger>
          </TabsList>

          {/* Base Fields Tab */}
          <TabsContent value="base" className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              {t('Campos pré-definidos com validação automática.')}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {FIXED_FIELDS.map(({ key, icon: Icon, label: fieldLabel, description }) => {
                const isAdded = isFixedFieldAdded(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => !isAdded && handleAddFixedField(key)}
                    disabled={isAdded}
                    className={cn(
                      "relative flex flex-col items-center gap-2 rounded-lg border p-4 transition-all",
                      isAdded 
                        ? "bg-muted/50 border-muted cursor-not-allowed opacity-60"
                        : "hover:bg-primary/5 hover:border-primary cursor-pointer"
                    )}
                  >
                    {isAdded && (
                      <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </div>
                    )}
                    <div className={cn(
                      "h-10 w-10 rounded-lg flex items-center justify-center",
                      isAdded ? "bg-muted" : "bg-primary/10"
                    )}>
                      <Icon className={cn(
                        "h-5 w-5",
                        isAdded ? "text-muted-foreground" : "text-primary"
                      )} />
                    </div>
                    <div className="text-center">
                      <p className={cn(
                        "text-sm font-medium",
                        isAdded && "text-muted-foreground"
                      )}>
                        {t(fieldLabel)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {isAdded ? t('Já adicionado') : t(description)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </TabsContent>

          {/* Custom Fields Tab */}
          <TabsContent value="custom" className="space-y-6 py-4">
            {/* Field Type Selection */}
            <div className="space-y-3">
              <Label>{t('Tipo de Campo')}</Label>
              <div className="grid grid-cols-5 gap-2">
                {FIELD_TYPES.map(({ type: fieldType, icon: Icon, description }) => (
                  <button
                    key={fieldType}
                    type="button"
                    onClick={() => setType(fieldType)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border p-3 transition-all hover:bg-muted/50",
                      type === fieldType && "border-primary bg-primary/5 ring-1 ring-primary"
                    )}
                    title={t(description)}
                  >
                    <Icon className={cn(
                      "h-5 w-5",
                      type === fieldType ? "text-primary" : "text-muted-foreground"
                    )} />
                    <span className={cn(
                      "text-[10px] font-medium",
                      type === fieldType ? "text-primary" : "text-muted-foreground"
                    )}>
                      {t(FIELD_TYPE_LABELS[fieldType])}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Label */}
            <div className="space-y-2">
              <Label htmlFor="field-label-custom">{t('Label *')}</Label>
              <Input
                id="field-label-custom"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t('Ex: Empresa, Orçamento...')}
                maxLength={50}
              />
            </div>

            {/* Placeholder */}
            {showPlaceholder && (
              <div className="space-y-2">
                <Label htmlFor="field-placeholder-custom">{t('Placeholder')}</Label>
                <Input
                  id="field-placeholder-custom"
                  value={placeholder}
                  onChange={(e) => setPlaceholder(e.target.value)}
                  placeholder={t('Texto de exemplo')}
                  maxLength={100}
                />
              </div>
            )}

            {/* Options for Select */}
            {showOptions && (
              <div className="space-y-3">
                <Label>{t('Opções *')}</Label>
                <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2">
                  {options.map((option, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-5">{idx + 1}.</span>
                      <Input
                        value={option}
                        onChange={(e) => updateOption(idx, e.target.value)}
                        placeholder={t('Opção {{n}}', { n: idx + 1 })}
                        maxLength={100}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 flex-shrink-0"
                        onClick={() => removeOption(idx)}
                        disabled={options.length <= 1}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addOption}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('Adicionar Opção')}
                </Button>
              </div>
            )}

            {/* Required Toggle */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="field-required-custom" className="font-medium cursor-pointer">
                  {t('Campo Obrigatório')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('O visitante terá de preencher este campo')}
                </p>
              </div>
              <Switch
                id="field-required-custom"
                checked={required}
                onCheckedChange={setRequired}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('Cancelar')}
              </Button>
              <Button 
                onClick={handleSubmitCustom}
                disabled={!label.trim() || (showOptions && options.filter(o => o.trim()).length === 0)}
              >
                {t('Adicionar Campo')}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
