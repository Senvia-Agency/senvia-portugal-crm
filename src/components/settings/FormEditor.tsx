import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  Accordion, 
  AccordionContent, 
  AccordionItem, 
  AccordionTrigger 
} from "@/components/ui/accordion";
import { 
  ResizableHandle, 
  ResizablePanel, 
  ResizablePanelGroup 
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  ArrowLeft,
  Loader2, 
  Palette, 
  MessageSquare, 
  CheckCircle, 
  ExternalLink, 
  Save,
  Sparkles,
  ImageIcon,
  FileText,
  MessagesSquare,
  Copy,
  Check,
  Settings,
  Bot,
  Zap,
  Thermometer,
  Target,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  UserPlus,
  Info,
  RefreshCw,
  Users,
  Mail
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { MessageTemplateField, WELCOME_VARIABLES } from './MessageTemplateField';
import { CollaboratorPicker } from './CollaboratorPicker';
import { AssignmentSelector, deriveAssignmentMode, assignmentToFields, type AssignmentMode } from './AssignmentSelector';
import { useUpdateForm } from '@/hooks/useForms';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useTeamMembers } from '@/hooks/useTeam';
import { useAuth } from '@/contexts/AuthContext';
import { Form, FormSettings, FormMode, MetaPixel, migrateFormSettings } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/i18n';
import { FormPreview } from './FormPreview';
import { ConversationalFormPreview } from './ConversationalFormPreview';
import { LogoUploader } from './LogoUploader';
import { CustomFieldsEditor } from './CustomFieldsEditor';
import { PRODUCTION_URL } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

const PRESET_COLORS = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#EF4444', '#F97316',
  '#EAB308', '#22C55E', '#06B6D4', '#6366F1', '#0EA5E9',
];

interface FormEditorProps {
  form: Form;
  onBack: () => void;
}

export function FormEditor({ form, onBack }: FormEditorProps) {
  const { organization } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();
  const updateForm = useUpdateForm();
  const isMobile = useIsMobile();

  const { data: teamMembers } = useTeamMembers();
  const { data: stages = [] } = usePipelineStages();
  
  const [name, setName] = useState(form.name);
  const [slug, setSlug] = useState(form.slug);
  const [settings, setSettings] = useState<FormSettings>(migrateFormSettings(form.form_settings));
  const [showSuccessPreview, setShowSuccessPreview] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  
  // Automation fields
  const [msgTemplateHot, setMsgTemplateHot] = useState(form.msg_template_hot || '');
  const [msgTemplateWarm, setMsgTemplateWarm] = useState(form.msg_template_warm || '');
  const [msgTemplateCold, setMsgTemplateCold] = useState(form.msg_template_cold || '');
  const [aiQualificationRules, setAiQualificationRules] = useState(form.ai_qualification_rules || '');
  
  // Meta Pixels
  const [metaPixels, setMetaPixels] = useState<MetaPixel[]>(form.meta_pixels || []);
  
  // Auto-assignment
  // Lead distribution (parity with inbound webhooks): toggleable round-robin,
  // recipient list, and "also notify admins". Seeds from the legacy single
  // assignee when the form predates the multi-recipient model.
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>(
    form.assigned_user_ids && form.assigned_user_ids.length > 0
      ? form.assigned_user_ids
      : (form.assigned_to ? [form.assigned_to] : [])
  );
  const [assignMode, setAssignMode] = useState<AssignmentMode>(
    deriveAssignmentMode(
      form.assigned_user_ids && form.assigned_user_ids.length > 0
        ? form.assigned_user_ids
        : (form.assigned_to ? [form.assigned_to] : []),
      form.rotate_enabled ?? false,
    )
  );
  const [notifyAllAdmins, setNotifyAllAdmins] = useState<boolean>(form.notify_all_admins ?? true);

  // Welcome-message variables + this form's own custom fields ({{campo:Etiqueta}}).
  const templateVariables = [
    ...WELCOME_VARIABLES,
    ...settings.custom_fields.map((f) => ({ token: `{{campo:${f.label}}}`, label: f.label })),
  ];

  // Target stage
  const [targetStage, setTargetStage] = useState<string | null>(form.target_stage || null);

  const getFormUrl = () => {
    if (!organization?.slug) return '';
    const prefix = settings.mode === 'conversational' ? '/c/' : '/f/';
    if (form.is_default) {
      return `${PRODUCTION_URL}${prefix}${organization.slug}`;
    }
    return `${PRODUCTION_URL}${prefix}${organization.slug}/${slug}`;
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast({ title: t("Nome em falta"), description: t("Dá um nome ao formulário."), variant: "destructive" });
      return;
    }
    if (!form.is_default && !slug.trim()) {
      toast({ title: t("Endereço em falta"), description: t("O formulário precisa de um endereço (slug) para o link público."), variant: "destructive" });
      return;
    }
    if (assignMode === 'rotate' && assignedUserIds.length < 2) {
      toast({ title: t("Rotação precisa de 2+ pessoas"), description: t("Seleciona pelo menos 2 colaboradores para a rotação, ou muda o modo de atribuição."), variant: "destructive" });
      return;
    }
    // Drop invalid/empty pixels so they are never persisted (matches the inline warning).
    const validPixels = metaPixels.filter((p) => p.pixel_id && isValidPixelId(p.pixel_id));
    updateForm.mutate(
      {
        id: form.id,
        name: name.trim(),
        slug: slug.trim(),
        form_settings: settings,
        msg_template_hot: msgTemplateHot || null,
        msg_template_warm: msgTemplateWarm || null,
        msg_template_cold: msgTemplateCold || null,
        ai_qualification_rules: aiQualificationRules || null,
        meta_pixels: validPixels,
        // Single mental model: mode (none/fixed/rotate) maps to the persisted
        // fields; assigned_to is kept in sync so any older reader still works.
        ...assignmentToFields(assignMode, assignedUserIds),
        notify_all_admins: notifyAllAdmins,
        target_stage: targetStage,
      },
      {
        onSuccess: () => {
          toast({
            title: t("Alterações guardadas"),
            description: t("O formulário foi atualizado com sucesso."),
          });
        }
      }
    );
  };

  // Meta Pixels handlers
  const handleAddPixel = () => {
    const newPixel: MetaPixel = {
      id: crypto.randomUUID(),
      name: '',
      pixel_id: '',
      enabled: true,
    };
    setMetaPixels(prev => [...prev, newPixel]);
  };

  const handleRemovePixel = (id: string) => {
    setMetaPixels(prev => prev.filter(p => p.id !== id));
  };

  const handleUpdatePixel = (id: string, field: keyof MetaPixel, value: string | boolean) => {
    setMetaPixels(prev => prev.map(p => 
      p.id === id ? { ...p, [field]: value } : p
    ));
  };

  const isValidPixelId = (pixelId: string) => /^\d{15,16}$/.test(pixelId);

  const handlePreview = () => {
    window.open(getFormUrl(), '_blank', 'noopener,noreferrer');
  };

  const handleCopyLink = async () => {
    const url = getFormUrl();
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
    toast({
      title: t("Link copiado!"),
      description: t("O link do formulário foi copiado para a área de transferência."),
    });
  };

  const updateSetting = <K extends keyof FormSettings>(key: K, value: FormSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const updateSuccessMessage = (key: keyof FormSettings['success_message'], value: string) => {
    setSettings(prev => ({
      ...prev,
      success_message: { ...prev.success_message, [key]: value }
    }));
  };

  const isValidHexColor = (color: string) => /^#[0-9A-Fa-f]{6}$/.test(color);

  const generateSlug = (text: string) => {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
  };

  // When the org runs first-contact AI in Global mode, the per-form rules and
  // templates are ignored, so the form editor hides that section and points to
  // the global config instead. Defaults to global when unset.
  const isGlobalAi = organization?.ai_response_mode !== 'per_form';

  // Editor content (shared between mobile and desktop)
  const editorContent = (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <Accordion type="multiple" defaultValue={["details", "mode", "appearance", "fields", "messages", "automation"]} className="space-y-3">
        
        {/* Form Details */}
        <AccordionItem value="details" className="border rounded-xl px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <Settings className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="text-left">
                <span className="font-medium">{t('Detalhes')}</span>
                <p className="text-xs text-muted-foreground font-normal">
                  {t('Nome e URL do formulário')}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="form-name">{t('Nome')}</Label>
              <Input
                id="form-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("Nome do formulário")}
                maxLength={100}
              />
            </div>
            {!form.is_default && (
              <div className="space-y-2">
                <Label htmlFor="form-slug">{t('Slug (URL)')}</Label>
                <Input
                  id="form-slug"
                  value={slug}
                  onChange={(e) => setSlug(generateSlug(e.target.value))}
                  placeholder={t("slug-do-formulario")}
                  maxLength={50}
                />
              </div>
            )}
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border">
              <code className="flex-1 text-xs text-muted-foreground truncate">
                {getFormUrl()}
              </code>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleCopyLink}
                className="flex-shrink-0"
              >
                {copiedLink ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Auto-Assignment Section */}
        <AccordionItem value="assignment" className="border rounded-xl px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                <UserPlus className="h-5 w-5 text-blue-600" />
              </div>
              <div className="text-left">
                <span className="font-medium">{t('Atribuição Automática')}</span>
                <p className="text-xs text-muted-foreground font-normal">
                  {t('Quem recebe os leads deste formulário')}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2 space-y-4">
            <AssignmentSelector
              members={teamMembers || []}
              mode={assignMode}
              userIds={assignedUserIds}
              noun="leads"
              onChange={({ mode, userIds }) => { setAssignMode(mode); setAssignedUserIds(userIds); }}
            />

            {/* Avisar admins */}
            <div className="space-y-1 pt-1 border-t">
              <div className="flex items-center justify-between gap-3 pt-3">
                <Label className="text-sm font-normal flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  {t('Avisar também os administradores')}
                </Label>
                <Switch checked={notifyAllAdmins} onCheckedChange={setNotifyAllAdmins} />
              </div>
              <p className="text-xs text-muted-foreground">{t('Recebem o aviso mesmo que não estejam na lista acima.')}</p>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Target Stage Section */}
        <AccordionItem value="target-stage" className="border rounded-xl px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                <Target className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="text-left">
                <span className="font-medium">{t('Etapa Inicial do Lead')}</span>
                <p className="text-xs text-muted-foreground font-normal">
                  {t('Em qual etapa do pipeline o lead entra automaticamente')}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2 space-y-4">
            <div className="space-y-2">
              <Label>{t('Etapa do Pipeline')}</Label>
              <Select
                value={targetStage || 'default'}
                onValueChange={(v) => setTargetStage(v === 'default' ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('Primeira etapa (predefinida)')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{t('Primeira etapa (predefinida)')}</SelectItem>
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.key}>
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('Os leads deste formulário entrarão diretamente nesta etapa do pipeline. O nome do formulário será adicionado nas notas do lead.')}
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Form Mode Section */}
        <AccordionItem value="mode" className="border rounded-xl px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
                <MessagesSquare className="h-5 w-5 text-violet-600" />
              </div>
              <div className="text-left">
                <span className="font-medium">{t('Tipo de Formulário')}</span>
                <p className="text-xs text-muted-foreground font-normal">
                  {t('Escolha entre tradicional ou conversacional')}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => updateSetting('mode', 'traditional')}
                className={cn(
                  "relative flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all",
                  settings.mode === 'traditional'
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                )}
              >
                <div className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-xl",
                  settings.mode === 'traditional' ? "bg-primary/10" : "bg-muted"
                )}>
                  <FileText className={cn(
                    "h-6 w-6",
                    settings.mode === 'traditional' ? "text-primary" : "text-muted-foreground"
                  )} />
                </div>
                <div className="text-center">
                  <p className={cn(
                    "font-medium text-sm",
                    settings.mode === 'traditional' ? "text-primary" : "text-foreground"
                  )}>{t('Tradicional')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('Todos os campos visíveis')}
                  </p>
                </div>
                {settings.mode === 'traditional' && (
                  <div className="absolute top-2 right-2">
                    <Check className="h-4 w-4 text-primary" />
                  </div>
                )}
              </button>

              <button
                type="button"
                onClick={() => updateSetting('mode', 'conversational')}
                className={cn(
                  "relative flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all",
                  settings.mode === 'conversational'
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                )}
              >
                <div className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-xl",
                  settings.mode === 'conversational' ? "bg-primary/10" : "bg-muted"
                )}>
                  <MessagesSquare className={cn(
                    "h-6 w-6",
                    settings.mode === 'conversational' ? "text-primary" : "text-muted-foreground"
                  )} />
                </div>
                <div className="text-center">
                  <p className={cn(
                    "font-medium text-sm",
                    settings.mode === 'conversational' ? "text-primary" : "text-foreground"
                  )}>{t('Conversacional')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('Uma pergunta de cada vez')}
                  </p>
                </div>
                {settings.mode === 'conversational' && (
                  <div className="absolute top-2 right-2">
                    <Check className="h-4 w-4 text-primary" />
                  </div>
                )}
              </button>
            </div>

            {settings.mode === 'conversational' && (
              <p className="text-xs text-muted-foreground bg-amber-500/10 text-amber-700 dark:text-amber-400 p-3 rounded-lg">
                💡 O modo conversacional usa um fluxo passo-a-passo otimizado para conversão.
              </p>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Appearance Section */}
        <AccordionItem value="appearance" className="border rounded-xl px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Palette className="h-5 w-5 text-primary" />
              </div>
              <div className="text-left">
                <span className="font-medium">{t('Aparência')}</span>
                <p className="text-xs text-muted-foreground font-normal">
                  {t('Título, subtítulo, logo e cores')}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2 space-y-5">
            <div className="space-y-2">
              <Label>{t('Título')}</Label>
              <Input
                value={settings.title}
                onChange={(e) => updateSetting('title', e.target.value)}
                maxLength={100}
                placeholder={t("Contacte-nos")}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('Subtítulo')}</Label>
              <Textarea
                value={settings.subtitle}
                onChange={(e) => updateSetting('subtitle', e.target.value)}
                maxLength={200}
                placeholder={t("Preencha o formulário...")}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                {t('Logo')}
              </Label>
              <LogoUploader
                value={settings.logo_url}
                onChange={(url) => updateSetting('logo_url', url)}
              />
            </div>

            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                {t('Cor Principal')}
              </Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={cn(
                      "h-8 w-8 rounded-full transition-all duration-200 hover:scale-110",
                      settings.primary_color.toLowerCase() === color.toLowerCase() && "ring-2 ring-offset-2 ring-primary scale-110"
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => updateSetting('primary_color', color)}
                  />
                ))}
              </div>
              <div className="flex gap-3 items-center">
                <div 
                  className="h-11 w-11 rounded-lg border-2 flex-shrink-0"
                  style={{ 
                    backgroundColor: settings.primary_color,
                    borderColor: isValidHexColor(settings.primary_color) ? settings.primary_color : 'hsl(var(--destructive))'
                  }}
                />
                <Input
                  value={settings.primary_color}
                  onChange={(e) => updateSetting('primary_color', e.target.value)}
                  placeholder="#3B82F6"
                  maxLength={7}
                  className="font-mono uppercase"
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Fields Section */}
        <AccordionItem value="fields" className="border rounded-xl px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                <MessageSquare className="h-5 w-5 text-green-600" />
              </div>
              <div className="text-left">
                <span className="font-medium">{t('Campos')}</span>
                <p className="text-xs text-muted-foreground font-normal">
                  {t('Configure os campos do formulário')}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2">
            <CustomFieldsEditor
              settings={settings}
              onUpdateSettings={setSettings}
            />
          </AccordionContent>
        </AccordionItem>

        {/* Messages Section */}
        <AccordionItem value="messages" className="border rounded-xl px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                <CheckCircle className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="text-left">
                <span className="font-medium">{t('Mensagens')}</span>
                <p className="text-xs text-muted-foreground font-normal">
                  {t('Sucesso, erro e botão de envio')}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2 space-y-5">
            <div className="space-y-2">
              <Label>{t('Texto do Botão')}</Label>
              <Input
                value={settings.submit_button_text}
                onChange={(e) => updateSetting('submit_button_text', e.target.value)}
                maxLength={30}
                placeholder={t("Enviar")}
              />
            </div>

            <div className="p-4 border rounded-xl space-y-4 bg-emerald-500/5">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle className="h-4 w-4" />
                  {t('Mensagem de Sucesso')}
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSuccessPreview(!showSuccessPreview)}
                >
                  {showSuccessPreview ? t('Esconder') : t('Pré-visualizar')}
                </Button>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('Título')}</Label>
                  <Input
                    value={settings.success_message.title}
                    onChange={(e) => updateSuccessMessage('title', e.target.value)}
                    maxLength={50}
                    placeholder={t("Obrigado!")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('Descrição')}</Label>
                  <Textarea
                    value={settings.success_message.description}
                    onChange={(e) => updateSuccessMessage('description', e.target.value)}
                    maxLength={200}
                    placeholder={t("Recebemos o seu contacto...")}
                    rows={2}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('Mensagem de Erro')}</Label>
              <Textarea
                value={settings.error_message}
                onChange={(e) => updateSetting('error_message', e.target.value)}
                maxLength={200}
                placeholder={t("Não foi possível enviar...")}
                rows={2}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Automation Section */}
        <AccordionItem value="automation" className="border rounded-xl px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
                <Zap className="h-5 w-5 text-orange-600" />
              </div>
              <div className="text-left">
                <span className="font-medium">{t('Automação')}</span>
                <p className="text-xs text-muted-foreground font-normal">
                  {t('Mensagens automáticas e regras de IA')}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2 space-y-6">
            {isGlobalAi ? (
              <div className="flex gap-3 rounded-lg border bg-muted/40 p-4">
                <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  {t('A resposta automática está em modo Global: a mensagem e as regras de IA são iguais para todos os formulários e configuram-se em Definições, Formulários de Captação, separador Configuração de IA. Para dar a este formulário mensagens próprias, muda o modo para Resposta por Formulário.')}
                </p>
              </div>
            ) : (
            <>
            {/* Message Templates */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Thermometer className="h-4 w-4 text-muted-foreground" />
                <Label className="font-medium">{t('Modelos de Mensagem por Temperatura')}</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('Mensagem de boas-vindas enviada automaticamente por WhatsApp ao novo lead. Clica numa variável para a inserir; é substituída pelos dados do lead no envio.')}
              </p>

              <div className="space-y-4">
                <div className="p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20">
                  <MessageTemplateField
                    label={<span className="flex items-center gap-2 text-red-600 dark:text-red-400 font-medium">{t('🔥 Lead Quente')}</span>}
                    value={msgTemplateHot}
                    onChange={setMsgTemplateHot}
                    placeholder={t("Olá {{primeiro_nome}}! Vimos que tem interesse urgente. Podemos ajudar agora mesmo?", { primeiro_nome: "{{primeiro_nome}}" })}
                    rows={3}
                    className="text-sm"
                    variables={templateVariables}
                  />
                </div>

                <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20">
                  <MessageTemplateField
                    label={<span className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-medium">{t('😐 Lead Morno')}</span>}
                    value={msgTemplateWarm}
                    onChange={setMsgTemplateWarm}
                    placeholder={t("Olá {{primeiro_nome}}! Obrigado pelo seu contacto. Gostaria de saber mais sobre os nossos serviços?", { primeiro_nome: "{{primeiro_nome}}" })}
                    rows={3}
                    className="text-sm"
                    variables={templateVariables}
                  />
                </div>

                <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
                  <MessageTemplateField
                    label={<span className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-medium">{t('🥶 Lead Frio')}</span>}
                    value={msgTemplateCold}
                    onChange={setMsgTemplateCold}
                    placeholder={t("Olá {{primeiro_nome}}! Recebemos o seu contacto. Estamos disponíveis para esclarecer qualquer dúvida.", { primeiro_nome: "{{primeiro_nome}}" })}
                    rows={3}
                    className="text-sm"
                    variables={templateVariables}
                  />
                </div>
              </div>
            </div>

            {/* AI Qualification Rules */}
            <div className="space-y-3 pt-4 border-t">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-muted-foreground" />
                <Label className="font-medium">{t('Regras de Qualificação por IA')}</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('Defina critérios para a IA classificar automaticamente a temperatura dos leads.')}
              </p>
              <Textarea
                value={aiQualificationRules}
                onChange={(e) => setAiQualificationRules(e.target.value)}
                placeholder={t("Exemplo de regras:\n\nQuente: Lead que menciona urgência, preço ou quer agendar\nMorno: Lead com interesse demonstrado mas sem urgência\nFrio: Lead que apenas pede informações gerais\n\nConsiderar também:\nPalavras como \"orçamento\", \"já\" significam Quente\nPerguntas sobre funcionamento significam Morno\nCampos opcionais vazios significam Frio")}
                rows={8}
                className="text-sm font-mono"
              />
            </div>
            </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Meta Pixels Section */}
        <AccordionItem value="meta-pixels" className="border rounded-xl px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                <Target className="h-5 w-5 text-blue-600" />
              </div>
              <div className="text-left">
                <span className="font-medium">{t('Meta Pixels')}</span>
                <p className="text-xs text-muted-foreground font-normal">
                  {t('Rastreamento de conversões Facebook/Meta')}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2 space-y-4">
            <p className="text-xs text-muted-foreground bg-blue-500/10 text-blue-700 dark:text-blue-400 p-3 rounded-lg">
              {t('Os pixels disparam eventos PageView e Lead automaticamente quando o formulário é visualizado e submetido.')}
            </p>

            {metaPixels.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {t('Nenhum pixel configurado para este formulário.')}
              </p>
            ) : (
              <div className="space-y-3">
                {metaPixels.map((pixel, index) => (
                  <div key={pixel.id} className="flex flex-col gap-3 p-3 rounded-lg border bg-card">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-medium">#{index + 1}</span>
                      <Input
                        placeholder={t("Nome do pixel (ex: Pixel Principal)")}
                        value={pixel.name}
                        onChange={(e) => handleUpdatePixel(pixel.id, 'name', e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleUpdatePixel(pixel.id, 'enabled', !pixel.enabled)}
                        className={pixel.enabled ? 'text-green-500' : 'text-muted-foreground'}
                        title={pixel.enabled ? t('Ativo') : t('Inativo')}
                      >
                        {pixel.enabled ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemovePixel(pixel.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Input
                      placeholder={t("Pixel ID (15-16 dígitos)")}
                      value={pixel.pixel_id}
                      onChange={(e) => handleUpdatePixel(pixel.id, 'pixel_id', e.target.value.replace(/\D/g, '').slice(0, 16))}
                      className={pixel.pixel_id && !isValidPixelId(pixel.pixel_id) ? 'border-destructive' : ''}
                    />
                    {pixel.pixel_id && !isValidPixelId(pixel.pixel_id) && (
                      <p className="text-xs text-destructive">{t('Pixel ID deve ter 15-16 dígitos')}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={handleAddPixel}
              className="w-full"
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('Adicionar Pixel')}
            </Button>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );

  // Preview content
  const previewContent = (
    <div className="flex h-full flex-col bg-muted/30">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h3 className="font-medium">{t('Pré-visualização')}</h3>
          <p className="text-xs text-muted-foreground">
            {settings.mode === 'conversational' ? t('Modo Conversacional') : t('Modo Tradicional')}
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-md">
          {settings.mode === 'conversational' ? (
            <ConversationalFormPreview settings={settings} />
          ) : (
            <FormPreview settings={settings} showSuccess={showSuccessPreview} />
          )}
        </div>
      </div>
    </div>
  );

  // Mobile layout
  if (isMobile) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Button variant="back" size="icon-sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="font-medium truncate">{form.name}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handlePreview}>
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={handleSave} disabled={updateForm.isPending}>
              {updateForm.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        {editorContent}
      </div>
    );
  }

  // Desktop layout with resizable panels
  return (
    <div className="h-[calc(100dvh-12rem)] min-h-[50dvh] sm:min-h-[600px]">
      <ResizablePanelGroup direction="horizontal" className="h-full rounded-xl border bg-background">
        <ResizablePanel defaultSize={50} minSize={30} maxSize={70}>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div className="flex items-center gap-3">
                <Button variant="back" size="icon-sm" onClick={onBack}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                  <h2 className="text-lg font-semibold">{form.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t('Personalize o formulário')}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handlePreview}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t('Abrir')}
                </Button>
                <Button size="sm" onClick={handleSave} disabled={updateForm.isPending}>
                  {updateForm.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  {t('Guardar')}
                </Button>
              </div>
            </div>
            {editorContent}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={50} minSize={30}>
          {previewContent}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
