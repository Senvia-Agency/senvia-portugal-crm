import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, FileText, MessagesSquare, Star, Copy, Trash2, ExternalLink,
  MoreHorizontal, Edit, Loader2, Power, PowerOff, Code, Sparkles, Info,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useForms, useDeleteForm, useDuplicateForm, useUpdateForm } from '@/hooks/useForms';
import { useUpdateOrganization } from '@/hooks/useOrganization';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { Form } from '@/types';
import { PRODUCTION_URL } from '@/lib/constants';
import { CreateFormModal } from './CreateFormModal';
import { FormEditor } from './FormEditor';
import { MessageTemplateField } from './MessageTemplateField';
import { UpgradeModal } from '@/components/shared/UpgradeModal';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useLanguage } from '@/i18n';

type Tab = 'forms' | 'ai';

export function FormsManager() {
  const { organization } = useAuth();
  const { data: forms, isLoading } = useForms();
  const deleteForm = useDeleteForm();
  const duplicateForm = useDuplicateForm();
  const updateForm = useUpdateForm();
  const updateOrganization = useUpdateOrganization();
  const { t } = useLanguage();
  const { limits, planName } = useSubscription();

  const [activeTab, setActiveTab] = useState<Tab>('forms');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingForm, setEditingForm] = useState<Form | null>(null);
  const [formToDelete, setFormToDelete] = useState<Form | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const [aiMode, setAiMode] = useState<'global' | 'per_form'>('global');
  const [globalAiRules, setGlobalAiRules] = useState('');
  const [globalTplHot, setGlobalTplHot] = useState('');
  const [globalTplWarm, setGlobalTplWarm] = useState('');
  const [globalTplCold, setGlobalTplCold] = useState('');

  useEffect(() => {
    if (!organization) return;
    setAiMode(organization.ai_response_mode === 'per_form' ? 'per_form' : 'global');
    setGlobalAiRules(organization.ai_qualification_rules || '');
    setGlobalTplHot(organization.msg_template_hot || '');
    setGlobalTplWarm(organization.msg_template_warm || '');
    setGlobalTplCold(organization.msg_template_cold || '');
  }, [organization?.id]);

  const getFormUrl = (form: Form) => {
    if (!organization?.slug) return '';
    const prefix = form.form_settings.mode === 'conversational' ? '/c/' : '/f/';
    if (form.is_default) return `${PRODUCTION_URL}${prefix}${organization.slug}`;
    return `${PRODUCTION_URL}${prefix}${organization.slug}/${form.slug}`;
  };

  const handleOpenForm = (form: Form) => window.open(getFormUrl(form), '_blank', 'noopener,noreferrer');

  const handleCopyUrl = async (form: Form) => {
    await navigator.clipboard.writeText(getFormUrl(form));
    toast.success(t('URL copiado!'));
  };

  const handleCopyEmbed = async (form: Form, embedMode: 'iframe' | 'redirect') => {
    const formPath = form.form_settings.mode === 'conversational' ? 'c' : 'f';
    const slug = form.is_default ? organization?.slug : `${organization?.slug}/${form.slug}`;
    const code = embedMode === 'iframe'
      ? `<div id="senvia-form"></div>\n<script src="${PRODUCTION_URL}/embed.js" data-form="${slug}" data-path="${formPath}" data-mode="iframe"></script>`
      : `<script src="${PRODUCTION_URL}/embed.js" data-form="${slug}" data-path="${formPath}" data-mode="redirect"></script>`;
    await navigator.clipboard.writeText(code);
    toast.success(t('Código embed copiado!'));
  };

  const handleDeleteConfirm = () => {
    if (formToDelete) {
      deleteForm.mutate(formToDelete.id);
      setFormToDelete(null);
    }
  };

  // Persist the mode immediately on toggle (cheap, no form to submit).
  const handleSelectMode = (mode: 'global' | 'per_form') => {
    setAiMode(mode);
    updateOrganization.mutate({ ai_response_mode: mode });
  };

  const handleSaveGlobalAI = () => {
    updateOrganization.mutate({
      ai_response_mode: 'global',
      ai_qualification_rules: globalAiRules.trim() || null,
      msg_template_hot: globalTplHot.trim() || null,
      msg_template_warm: globalTplWarm.trim() || null,
      msg_template_cold: globalTplCold.trim() || null,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (editingForm) {
    return <FormEditor form={editingForm} onBack={() => setEditingForm(null)} />;
  }

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'forms', label: 'Formulários', icon: FileText },
    { id: 'ai', label: 'Configuração de IA', icon: Sparkles },
  ];

  return (
    <div className="space-y-6">
      {/* Sub-tab bar */}
      <div className="flex gap-1.5 border-b pb-2">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              activeTab === id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {t(label)}
          </button>
        ))}
      </div>

      {/* ── Tab: Formulários ─────────────────────────────── */}
      {activeTab === 'forms' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {t('Crie e gira múltiplos formulários para diferentes campanhas')}
            </p>
            <Button
              onClick={() => {
                if (limits.maxForms !== null && forms && forms.length >= limits.maxForms) {
                  toast.error(t('Limite de {{n}} formulários atingido no plano {{plan}}', { n: limits.maxForms, plan: planName }));
                  setShowUpgradeModal(true);
                  return;
                }
                setShowCreateModal(true);
              }}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t('Novo Formulário')}</span>
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {forms?.map((form) => (
              <Card
                key={form.id}
                className={cn("relative transition-all hover:shadow-md", !form.is_active && "opacity-60")}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                        form.form_settings.mode === 'conversational' ? "bg-violet-500/10" : "bg-primary/10"
                      )}>
                        {form.form_settings.mode === 'conversational'
                          ? <MessagesSquare className="h-4 w-4 text-violet-600" />
                          : <FileText className="h-4 w-4 text-primary" />}
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-sm font-medium truncate">{form.name}</CardTitle>
                        <CardDescription className="text-xs truncate">/{form.slug}</CardDescription>
                      </div>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" className="shrink-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditingForm(form)}>
                          <Edit className="h-4 w-4 mr-2" />{t('Editar')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleOpenForm(form)}>
                          <ExternalLink className="h-4 w-4 mr-2" />{t('Abrir')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleCopyUrl(form)}>
                          <Copy className="h-4 w-4 mr-2" />{t('Copiar URL')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleCopyEmbed(form, 'iframe')}>
                          <Code className="h-4 w-4 mr-2" />{t('Copiar Embed (Formulário)')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleCopyEmbed(form, 'redirect')}>
                          <Code className="h-4 w-4 mr-2" />{t('Copiar Embed (Botão)')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => {
                          if (limits.maxForms !== null && forms && forms.length >= limits.maxForms) {
                            toast.error(t('Limite de {{n}} formulários atingido no plano {{plan}}', { n: limits.maxForms, plan: planName }));
                            setShowUpgradeModal(true);
                            return;
                          }
                          duplicateForm.mutate(form.id);
                        }}>
                          <Copy className="h-4 w-4 mr-2" />{t('Duplicar')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {!form.is_default && (
                          <DropdownMenuItem onClick={() => updateForm.mutate({ id: form.id, is_default: true })}>
                            <Star className="h-4 w-4 mr-2" />{t('Definir como Principal')}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => updateForm.mutate({ id: form.id, is_active: !form.is_active })}>
                          {form.is_active
                            ? <><PowerOff className="h-4 w-4 mr-2" />{t('Desativar')}</>
                            : <><Power className="h-4 w-4 mr-2" />{t('Ativar')}</>}
                        </DropdownMenuItem>
                        {!form.is_default && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setFormToDelete(form)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />{t('Eliminar')}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>

                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-1.5">
                    {form.is_default && (
                      <Badge variant="default" className="gap-1 text-xs">
                        <Star className="h-3 w-3" />{t('Principal')}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-xs">
                      {form.form_settings.mode === 'conversational' ? t('Conversacional') : t('Tradicional')}
                    </Badge>
                    {!form.is_active && (
                      <Badge variant="outline" className="text-xs text-muted-foreground">{t('Inativo')}</Badge>
                    )}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground truncate">{getFormUrl(form)}</p>
                </CardContent>
              </Card>
            ))}

            {forms?.length === 0 && (
              <Card className="border-dashed sm:col-span-2 lg:col-span-3">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <p className="text-sm text-muted-foreground text-center mb-4">{t('Ainda não tem formulários criados')}</p>
                  <Button onClick={() => setShowCreateModal(true)} variant="outline">
                    <Plus className="h-4 w-4 mr-2" />{t('Criar Primeiro Formulário')}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Configuração de IA ───────────────────────── */}
      {activeTab === 'ai' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold">{t('Primeira Resposta Automática')}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t('Mensagem enviada por WhatsApp ao lead quando submete um formulário. A IA classifica o lead e envia a mensagem certa.')}
            </p>
          </div>

          {/* Mode selector */}
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => handleSelectMode('global')}
              className={cn(
                "text-left rounded-lg border p-4 transition-colors",
                aiMode === 'global' ? "border-primary ring-1 ring-primary bg-primary/5" : "hover:bg-accent",
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full border",
                  aiMode === 'global' ? "border-primary" : "border-muted-foreground/40",
                )}>
                  {aiMode === 'global' && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <span className="text-sm font-medium">{t('Resposta Global')}</span>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                {t('Uma só configuração aplicada a todos os formulários do SENVIA OS.')}
              </p>
            </button>

            <button
              type="button"
              onClick={() => handleSelectMode('per_form')}
              className={cn(
                "text-left rounded-lg border p-4 transition-colors",
                aiMode === 'per_form' ? "border-primary ring-1 ring-primary bg-primary/5" : "hover:bg-accent",
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full border",
                  aiMode === 'per_form' ? "border-primary" : "border-muted-foreground/40",
                )}>
                  {aiMode === 'per_form' && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <span className="text-sm font-medium">{t('Resposta por Formulário')}</span>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                {t('Cada formulário define a sua própria mensagem e regras de classificação.')}
              </p>
            </button>
          </div>

          {/* Per-form mode → just point to the form editor */}
          {aiMode === 'per_form' && (
            <div className="flex gap-3 rounded-lg border bg-muted/40 p-4">
              <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
                {t('A mensagem e as regras de classificação são definidas dentro de cada formulário, no separador Automação do editor. Abre um formulário no separador Formulários e configura aí.')}
              </p>
            </div>
          )}

          {/* Global mode → the org-level config form */}
          {aiMode === 'global' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="global-ai-rules">{t('Regras de Qualificação da IA')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('Descreve quando classificar o lead como Quente, Morno ou Frio.')}
                </p>
                <Textarea
                  id="global-ai-rules"
                  value={globalAiRules}
                  onChange={(e) => setGlobalAiRules(e.target.value)}
                  placeholder={t("Ex:\nQuente: mencionou urgência ou pediu orçamento imediato\nMorno: interesse claro mas sem urgência\nFrio: apenas curiosidade ou informação geral")}
                  rows={6}
                  className="font-mono text-sm"
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-3">
                <MessageTemplateField
                  id="tpl-hot"
                  label={<span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />{t('Mensagem Quente')}</span>}
                  value={globalTplHot}
                  onChange={setGlobalTplHot}
                  placeholder={t("Olá {{primeiro_nome}}! 🚀\n\nVi que tens interesse urgente...", { primeiro_nome: "{{primeiro_nome}}" })}
                  rows={10}
                  className="text-sm"
                />
                <MessageTemplateField
                  id="tpl-warm"
                  label={<span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-yellow-500" />{t('Mensagem Morno')}</span>}
                  value={globalTplWarm}
                  onChange={setGlobalTplWarm}
                  placeholder={t("Olá {{primeiro_nome}}! 👋\n\nObrigado pelo teu interesse...", { primeiro_nome: "{{primeiro_nome}}" })}
                  rows={10}
                  className="text-sm"
                />
                <MessageTemplateField
                  id="tpl-cold"
                  label={<span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-400" />{t('Mensagem Frio')}</span>}
                  value={globalTplCold}
                  onChange={setGlobalTplCold}
                  placeholder={t("Olá {{primeiro_nome}}! 😊\n\nRecebemos o teu contacto...", { primeiro_nome: "{{primeiro_nome}}" })}
                  rows={10}
                  className="text-sm"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                {t('Clica numa variável para a inserir no texto. As variáveis são substituídas pelos dados do lead no envio.')}
              </p>

              <div className="flex justify-end">
                <Button onClick={handleSaveGlobalAI} disabled={updateOrganization.isPending} className="gap-2">
                  {updateOrganization.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('Guardar')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <CreateFormModal open={showCreateModal} onOpenChange={setShowCreateModal} />

      <AlertDialog open={!!formToDelete} onOpenChange={() => setFormToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Eliminar formulário?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('Esta ação não pode ser desfeita. O formulário "{{name}}" será eliminado permanentemente. Os leads associados serão mantidos.', { name: formToDelete?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancelar')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('Eliminar')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        featureName={t('Formulários')}
        requiredPlan="Pro"
      />
    </div>
  );
}
