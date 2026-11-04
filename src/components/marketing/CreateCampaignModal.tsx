import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Search, Users, User, Send, Loader2, Mail, List, ArrowLeft, Check, Circle, Pencil,
  MessageSquare, Phone, Clock, ChevronDown, ChevronUp, Settings2, Save, AlertCircle,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useClients } from "@/hooks/useClients";
import { useEmailTemplates } from "@/hooks/useEmailTemplates";
import { useCreateCampaign, useUpdateCampaignStatus, useUpdateCampaign } from "@/hooks/useCampaigns";
import { useSendTemplateEmail } from "@/hooks/useSendTemplateEmail";
import { useClientLabels } from "@/hooks/useClientLabels";
import { CLIENT_STATUS_STYLES } from "@/types/clients";
import { useContactLists } from "@/hooks/useContactLists";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeString } from "@/lib/utils";
import { TemplateEditor } from "@/components/marketing/TemplateEditor";
import type { CrmClient } from "@/types/clients";
import type { EmailCampaign } from "@/types/marketing";
import { format } from "date-fns";
import { toast } from "sonner";
import { dateLocale, useLanguage } from "@/i18n";

interface CreateCampaignModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign?: EmailCampaign;
}

type Step = 1 | 2 | 3 | 4;
type ContentMode = "template" | "custom";
type CampaignSelectionMode = "individual" | "filter" | "list";

type AudienceSnapshotClient = Pick<CrmClient, "id" | "name" | "email" | "phone" | "company" | "status" | "organization_id">;

interface SettingItem {
  key: string;
  label: string;
  inputType?: 'text' | 'email' | 'textarea';
  placeholder?: string;
  soon?: boolean;
}

const AUDIENCE_SETTINGS_KEYS = {
  mode: "audience_mode",
  statusFilter: "audience_status_filter",
  listIds: "audience_list_ids",
  selectedClients: "audience_selected_clients",
} as const;

const mergeUniqueClients = (clients: CrmClient[]) => {
  const emailMap = new Map<string, CrmClient>();

  clients.forEach((client) => {
    const key = client.email?.trim().toLowerCase() || client.id;
    if (!emailMap.has(key)) {
      emailMap.set(key, client);
    }
  });

  return Array.from(emailMap.values());
};

const parseAudienceSettings = (data: Record<string, string>) => {
  const parseArray = (value?: string) => {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const selectionMode = (data[AUDIENCE_SETTINGS_KEYS.mode] as CampaignSelectionMode) || "individual";
  const statusFilter = data[AUDIENCE_SETTINGS_KEYS.statusFilter] || "all";
  const selectedListIds = parseArray(data[AUDIENCE_SETTINGS_KEYS.listIds]).filter((id): id is string => typeof id === "string");
  const selectedClients = parseArray(data[AUDIENCE_SETTINGS_KEYS.selectedClients])
    .filter((client): client is AudienceSnapshotClient => !!client && typeof client === "object" && typeof client.id === "string")
    .map((client) => ({
      id: client.id,
      name: client.name || "",
      email: client.email || "",
      phone: client.phone || "",
      company: client.company || "",
      status: client.status || "active",
      organization_id: client.organization_id || "",
    })) as CrmClient[];

  return {
    selectionMode,
    statusFilter,
    selectedListIds,
    selectedClients,
  };
};

const buildAudienceSettingsData = ({
  base,
  selectionMode,
  statusFilter,
  selectedListIds,
  selectedClients,
}: {
  base: Record<string, string>;
  selectionMode: CampaignSelectionMode;
  statusFilter: string;
  selectedListIds: string[];
  selectedClients: CrmClient[];
}) => ({
  ...base,
  [AUDIENCE_SETTINGS_KEYS.mode]: selectionMode,
  [AUDIENCE_SETTINGS_KEYS.statusFilter]: statusFilter,
  [AUDIENCE_SETTINGS_KEYS.listIds]: JSON.stringify(selectedListIds),
  [AUDIENCE_SETTINGS_KEYS.selectedClients]: JSON.stringify(
    selectedClients.map((client) => ({
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      company: client.company,
      status: client.status,
      organization_id: client.organization_id,
    }))
  ),
});

const CAMPAIGN_SETTINGS_GROUPS: { title: string; items: SettingItem[] }[] = [
  {
    title: "Personalização",
    items: [
      { key: "customize_to", label: "Personalizar o campo \"Enviar para\"" },
    ],
  },
  {
    title: "Envio e rastreio",
    items: [
      { key: "different_reply_to", label: "Usar um endereço de resposta diferente", inputType: "email", placeholder: "reply@empresa.com" },
      { key: "ga_tracking", label: "Ativar rastreio do Google Analytics", inputType: "text", placeholder: "Nome da campanha UTM" },
      { key: "tag", label: "Atribuir tag", inputType: "text", placeholder: "Nome da tag" },
      { key: "expiration_date", label: "Configurar data de expiração", soon: true },
    ],
  },
  {
    title: "Subscrição",
    items: [
      { key: "custom_unsubscribe", label: "Utilizar página de cancelamento personalizada", inputType: "text", placeholder: "https://exemplo.com/cancelar" },
      { key: "profile_update_form", label: "Usar formulário de atualização de perfil", soon: true },
    ],
  },
  {
    title: "Criação",
    items: [
      { key: "custom_header", label: "Editar cabeçalho predefinido", inputType: "textarea", placeholder: "<div>Cabeçalho HTML...</div>" },
      { key: "custom_footer", label: "Editar rodapé predefinido", inputType: "textarea", placeholder: "<div>Rodapé HTML...</div>" },
      { key: "view_in_browser", label: "Ativar link \"Ver no navegador\"", soon: true },
    ],
  },
];

export function CreateCampaignModal({ open, onOpenChange, campaign }: CreateCampaignModalProps) {
  const isEditMode = !!campaign;
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [contentMode, setContentMode] = useState<ContentMode>("template");
  const [customHtml, setCustomHtml] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClients, setSelectedClients] = useState<CrmClient[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectionMode, setSelectionMode] = useState<CampaignSelectionMode>("individual");
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [settingsData, setSettingsData] = useState<Record<string, string>>({});
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>();
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [sendMode, setSendMode] = useState<"immediate" | "scheduled">("immediate");
  const [loadingListMembers, setLoadingListMembers] = useState(false);
  const [pendingAutoLoadListIds, setPendingAutoLoadListIds] = useState<string[]>([]);

  const { data: templates = [] } = useEmailTemplates();
  const { data: clients = [], isLoading: loadingClients } = useClients();
  const clientLabels = useClientLabels();
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const updateStatus = useUpdateCampaignStatus();
  const sendTemplate = useSendTemplateEmail();
  const { data: contactLists = [] } = useContactLists();
  const { organization } = useAuth();
  const organizationId = organization?.id;
  const { t } = useLanguage();

  const activeTemplates = useMemo(() => templates.filter(t => t.is_active), [templates]);
  const selectedTemplate = useMemo(() => templates.find(t => t.id === templateId), [templates, templateId]);

  const loadContactsFromLists = useCallback(async (listIds: string[]) => {
    if (listIds.length === 0) return;

    setLoadingListMembers(true);
    try {
      const { data: members } = await supabase
        .from('marketing_list_members' as any)
        .select('*, contact:marketing_contacts(id, name, email, phone, company)')
        .in('list_id', listIds);

      const newClients = ((members as any[]) || [])
        .filter((m: any) => m.contact?.email)
        .map((m: any) => ({
          id: `marketing_${m.contact.id}`,
          name: m.contact.name,
          email: m.contact.email,
          phone: m.contact.phone,
          company: m.contact.company,
          status: 'active',
          organization_id: '',
        } as CrmClient));

      setSelectedClients((prev) => mergeUniqueClients([...prev, ...newClients]));
    } finally {
      setLoadingListMembers(false);
    }
  }, []);

  // Sync state when editing a campaign
  useEffect(() => {
    if (campaign && open) {
      const restoredSettingsData = (campaign.settings_data as Record<string, string>) || {};
      const restoredAudience = parseAudienceSettings(restoredSettingsData);

      setName(campaign.name || "");
      setSubject(campaign.subject || "");
      setTemplateId(campaign.template_id || "");
      setContentMode(campaign.template_id ? "template" : campaign.html_content ? "custom" : "template");
      setCustomHtml(campaign.html_content || "");
      setSettings((campaign.settings as Record<string, boolean>) || {});
      setSettingsData(restoredSettingsData);
      setSelectionMode(restoredAudience.selectionMode);
      setStatusFilter(restoredAudience.statusFilter);
      setSelectedListIds(restoredAudience.selectedListIds);
      setSelectedClients(restoredAudience.selectedClients);
      setPendingAutoLoadListIds(restoredAudience.selectionMode === "list" ? restoredAudience.selectedListIds : []);
      setStep(3);
    }
  }, [campaign, open]);

  useEffect(() => {
    if (!open || pendingAutoLoadListIds.length === 0) return;

    void loadContactsFromLists(pendingAutoLoadListIds);
    setPendingAutoLoadListIds([]);
  }, [open, pendingAutoLoadListIds, loadContactsFromLists]);

  const filteredClients = useMemo(() => {
    return clients.filter((client) => {
      if (!client.email) return false;
      const q = normalizeString(searchQuery);
      const matchesSearch = !searchQuery ||
        normalizeString(client.name).includes(q) ||
        normalizeString(client.email).includes(q) ||
        normalizeString(client.company || '').includes(q);
      const matchesStatus = statusFilter === "all" || client.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [clients, searchQuery, statusFilter]);

  const handleToggleClient = (client: CrmClient) => {
    setSelectedClients(prev => {
      const isSelected = prev.some(c => c.id === client.id);
      return isSelected ? prev.filter(c => c.id !== client.id) : [...prev, client];
    });
  };

  const handleSelectAll = () => {
    if (selectedClients.length === filteredClients.length) {
      setSelectedClients([]);
    } else {
      setSelectedClients(filteredClients);
    }
  };

  const handleTemplateChange = (id: string) => {
    setTemplateId(id);
    const tpl = templates.find(t => t.id === id);
    if (tpl) {
      setSubject(tpl.subject);
    }
  };

  const persistedSettingsData = useMemo(() => buildAudienceSettingsData({
    base: settingsData,
    selectionMode,
    statusFilter,
    selectedListIds,
    selectedClients,
  }), [settingsData, selectionMode, statusFilter, selectedListIds, selectedClients]);

  const contentComplete = contentMode === "template" ? !!templateId : customHtml.trim().length > 0;
  const allSectionsComplete = !!name.trim() && selectedClients.length > 0 && !!subject.trim() && contentComplete;

  const handleSend = async () => {
    if (!allSectionsComplete) return;
    setIsSending(true);

    try {
      let campaignId: string;

      if (isEditMode) {
        await updateCampaign.mutateAsync({
          id: campaign!.id,
          name,
          template_id: contentMode === "template" ? templateId : null,
          subject,
          html_content: contentMode === "custom" ? customHtml : null,
          settings,
          settings_data: persistedSettingsData,
        });
        campaignId = campaign!.id;
      } else {
        const newCampaign = await createCampaign.mutateAsync({
          name,
          template_id: contentMode === "template" ? templateId : undefined,
          subject,
          html_content: contentMode === "custom" ? customHtml : undefined,
          settings,
          settings_data: persistedSettingsData,
        });
        campaignId = newCampaign.id;
      }

      if (sendMode === "scheduled" && scheduleDate) {
        if (!organizationId) {
          throw new Error(t("Sem organização ativa para agendar a campanha."));
        }

        const queuedRecipients = selectedClients.filter((client) => client.email);
        if (queuedRecipients.length === 0) {
          throw new Error(t("Selecione pelo menos um destinatário com email válido."));
        }

        const [h, m] = scheduleTime.split(":").map(Number);
        const scheduledAt = new Date(scheduleDate);
        scheduledAt.setHours(h, m, 0, 0);

        const queuedRecords = queuedRecipients.map((client) => ({
          organization_id: organizationId,
          campaign_id: campaignId,
          template_id: contentMode === "template" ? templateId : null,
          client_id: client.id.startsWith("marketing_") ? null : client.id,
          recipient_email: client.email!,
          recipient_name: client.name,
          subject,
          status: "queued",
        }));

        let queueWasCreated = false;

        try {
          for (let i = 0; i < queuedRecords.length; i += 100) {
            const batch = queuedRecords.slice(i, i + 100);
            const { error: insertError } = await supabase.from("email_sends").insert(batch as any);

            if (insertError) {
              console.error("Erro ao inserir fila de envio:", insertError);
              throw new Error(t("Falha ao agendar destinatários: {{message}}", { message: insertError.message }));
            }

            queueWasCreated = true;
          }

          const { error: scheduleError } = await supabase
            .from("email_campaigns")
            .update({
              status: "scheduled",
              scheduled_at: scheduledAt.toISOString(),
              total_recipients: queuedRecords.length,
            } as any)
            .eq("id", campaignId);

          if (scheduleError) {
            throw new Error(t("Falha ao guardar o agendamento: {{message}}", { message: scheduleError.message }));
          }
        } catch (scheduleError) {
          if (queueWasCreated) {
            await supabase
              .from("email_sends")
              .delete()
              .eq("campaign_id", campaignId)
              .eq("status", "queued");
          }

          throw scheduleError;
        }

        toast.success(t("Campanha agendada para {{day}} de {{month}} às {{time}}", { day: format(scheduledAt, "dd"), month: format(scheduledAt, "MMMM", { locale: dateLocale() }), time: format(scheduledAt, "HH:mm") }));
        handleClose();
        return;
      }

      await updateStatus.mutateAsync({
        id: campaignId,
        status: 'sending',
        total_recipients: selectedClients.length,
      });

      const recipients = selectedClients.map(client => ({
        email: client.email!,
        name: client.name,
        clientId: client.id.startsWith('marketing_') ? undefined : client.id,
        variables: {
          nome: client.name,
          email: client.email || '',
          empresa: client.company || '',
          telefone: client.phone || '',
        },
      }));

      const result = await sendTemplate.mutateAsync({
        templateId: contentMode === "template" ? templateId : undefined,
        recipients,
        campaignId,
        settings,
        settingsData,
        subject: contentMode === "custom" ? subject : undefined,
        htmlContent: contentMode === "custom" ? customHtml : undefined,
      });

      await updateStatus.mutateAsync({
        id: campaignId,
        status: result.summary.failed === result.summary.total ? 'failed' : 'sent',
        sent_count: result.summary.sent,
        failed_count: result.summary.failed,
      });

      handleClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("Não foi possível processar a campanha.");
      toast.error(message);
      setIsSending(false);
    }
  };

  const handleClose = () => {
    setStep(1);
    setName("");
    setSubject("");
    setTemplateId("");
    setContentMode("template");
    setCustomHtml("");
    setSearchQuery("");
    setSelectedClients([]);
    setStatusFilter("all");
    setSelectionMode("individual");
    setSelectedListIds([]);
    setIsSending(false);
    setExpandedSection(null);
    setShowSettings(false);
    setSettings({});
    setSettingsData({});
    setScheduleDate(undefined);
    setScheduleTime("09:00");
    setShowSchedulePicker(false);
    setSendMode("immediate");
    setPendingAutoLoadListIds([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent variant="fullScreen" className="flex flex-col p-0 gap-0">
        {/* ====== Step 1: Campaign Type ====== */}
        {step === 1 && (
          <>
            <div className="border-b bg-card">
              <div className="max-w-xl mx-auto w-full px-4 md:px-6 py-4 flex items-center gap-3">
                <Button variant="back" size="icon" className="h-8 w-8" onClick={handleClose}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <DialogTitle className="text-lg font-semibold">{t("Criar uma campanha")}</DialogTitle>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="max-w-xl mx-auto w-full px-4 md:px-6 py-8 space-y-6">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-4">{t("Padrão")}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Email - active */}
                    <button
                      className="flex flex-col items-center gap-3 p-6 border-2 border-primary rounded-xl bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer"
                      onClick={() => setStep(2)}
                    >
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <Mail className="h-6 w-6 text-primary" />
                      </div>
                      <span className="text-sm font-semibold">{t("E-mail")}</span>
                    </button>

                    {/* SMS - disabled */}
                    <div className="flex flex-col items-center gap-3 p-6 border rounded-xl opacity-50 cursor-not-allowed relative">
                      <Badge className="absolute top-2 right-2 text-[10px]" variant="secondary">{t("Em breve")}</Badge>
                      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                        <MessageSquare className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <span className="text-sm font-semibold text-muted-foreground">SMS</span>
                    </div>

                    {/* WhatsApp - disabled */}
                    <div className="flex flex-col items-center gap-3 p-6 border rounded-xl opacity-50 cursor-not-allowed relative">
                      <Badge className="absolute top-2 right-2 text-[10px]" variant="secondary">{t("Em breve")}</Badge>
                      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                        <Phone className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <span className="text-sm font-semibold text-muted-foreground">WhatsApp</span>
                    </div>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </>
        )}

        {/* ====== Step 2: Campaign Name ====== */}
        {step === 2 && (
          <>
            <div className="border-b bg-card">
              <div className="max-w-xl mx-auto w-full px-4 md:px-6 py-4 flex items-center gap-3">
                <Button variant="back" size="icon" className="h-8 w-8" onClick={() => setStep(1)}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <DialogTitle className="text-lg font-semibold">{t("Criar uma campanha de e-mail")}</DialogTitle>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="max-w-xl mx-auto w-full px-4 md:px-6 py-8 space-y-6">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                  <Mail className="h-3.5 w-3.5" />
                  {t("Regular")}
                </div>

                <div className="space-y-2">
                  <Label>{t("Nome da campanha")} <span className="text-destructive">*</span></Label>
                  <Input
                    placeholder={t("Ex: Promoção de Janeiro")}
                    value={name}
                    onChange={(e) => setName(e.target.value.slice(0, 128))}
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground text-right">{name.length}/128</p>
                </div>
              </div>
            </ScrollArea>

            <div className="border-t bg-card px-4 md:px-6 py-4">
              <div className="max-w-xl mx-auto w-full flex justify-end gap-3">
                <Button variant="outline" onClick={handleClose}>{t("Cancelar")}</Button>
                <Button onClick={() => setStep(3)} disabled={!name.trim()}>
                  {t("Criar campanha")}
                </Button>
              </div>
            </div>
          </>
        )}

        {/* ====== Step 3: Stepper ====== */}
        {step === 3 && (
          <>
            <div className="border-b bg-card">
              <div className="max-w-3xl mx-auto w-full px-4 md:px-6 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Button variant="back" size="icon" className="h-8 w-8 shrink-0" onClick={() => isEditMode ? handleClose() : setStep(2)}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0">
                    <DialogTitle className="text-lg font-semibold truncate">{name}</DialogTitle>
                    <Badge variant="secondary" className="text-xs mt-0.5">{t("Rascunho")}</Badge>
                  </div>
                </div>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="max-w-3xl mx-auto w-full px-4 md:px-6 py-6 space-y-1">
                {/* Remetente */}
                <StepperSection
                  title={t("Remetente")}
                  complete={true}
                  summary={organization?.name || t('A sua organização')}
                  expanded={expandedSection === 'sender'}
                  onToggle={() => setExpandedSection(expandedSection === 'sender' ? null : 'sender')}
                >
                  <div className="text-sm text-muted-foreground">
                    <p><span className="font-medium text-foreground">{organization?.name || '—'}</span></p>
                    <p className="text-xs mt-1">{t("O remetente é configurado nas definições da organização.")}</p>
                  </div>
                </StepperSection>

                {/* Destinatários */}
                <StepperSection
                  title={t("Destinatários")}
                  complete={selectedClients.length > 0}
                  summary={selectedClients.length > 0 ? t("{{n}} contacto(s) selecionado(s)", { n: selectedClients.length }) : t('Nenhum selecionado')}
                  expanded={expandedSection === 'recipients'}
                  onToggle={() => setExpandedSection(expandedSection === 'recipients' ? null : 'recipients')}
                >
                  <Tabs value={selectionMode} onValueChange={(v) => setSelectionMode(v as any)} className="space-y-4">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="individual" className="text-xs gap-1.5">
                        <User className="h-3.5 w-3.5" /> {t("Individual")}
                      </TabsTrigger>
                      <TabsTrigger value="filter" className="text-xs gap-1.5">
                        <Users className="h-3.5 w-3.5" /> {t("Filtro")}
                      </TabsTrigger>
                      <TabsTrigger value="list" className="text-xs gap-1.5">
                        <List className="h-3.5 w-3.5" /> {t("Lista")}
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="individual" className="space-y-3">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input placeholder={t("Pesquisar...")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
                      </div>
                      <div className="border rounded-md max-h-[300px] overflow-y-auto">
                        <div className="p-2 space-y-1">
                          {loadingClients ? (
                            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                          ) : filteredClients.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground text-sm">{t("Nenhum cliente encontrado")}</div>
                          ) : (
                            filteredClients.map((client) => {
                              const isSelected = selectedClients.some(c => c.id === client.id);
                              return (
                                <div key={client.id} className={`flex items-center gap-3 p-2 rounded-md cursor-pointer hover:bg-muted/50 ${isSelected ? 'bg-primary/10' : ''}`} onClick={() => handleToggleClient(client)}>
                                  <Checkbox checked={isSelected} />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{client.name}</p>
                                    <p className="text-xs text-muted-foreground truncate">{client.email}</p>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="filter" className="space-y-4">
                      <div className="space-y-2">
                        <Label>{t("Filtrar por {{field}}", { field: clientLabels.statusFieldLabel.toLowerCase() })}</Label>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{t("Todos")}</SelectItem>
                            <SelectItem value="active">{clientLabels.statusActive}</SelectItem>
                            <SelectItem value="inactive">{clientLabels.statusInactive}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <p className="text-sm font-medium">{t("{{n}} clientes", { n: filteredClients.length })}</p>
                        <Button variant="outline" size="sm" onClick={handleSelectAll}>
                          {selectedClients.length === filteredClients.length ? t("Desmarcar todos") : t("Selecionar todos")}
                        </Button>
                      </div>
                      <div className="border rounded-md max-h-[250px] overflow-y-auto">
                        <div className="p-2 space-y-1">
                          {filteredClients.map((client) => {
                            const isSelected = selectedClients.some(c => c.id === client.id);
                            const statusStyle = CLIENT_STATUS_STYLES[client.status as keyof typeof CLIENT_STATUS_STYLES];
                            return (
                              <div key={client.id} className={`flex items-center gap-3 p-2 rounded-md cursor-pointer hover:bg-muted/50 ${isSelected ? 'bg-primary/10' : ''}`} onClick={() => handleToggleClient(client)}>
                                <Checkbox checked={isSelected} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{client.name}</p>
                                  <p className="text-xs text-muted-foreground truncate">{client.email}</p>
                                </div>
                                <Badge variant="secondary" className="text-xs" style={{ backgroundColor: statusStyle?.bg, color: statusStyle?.text }}>
                                  {{ active: clientLabels.statusActive, inactive: clientLabels.statusInactive, vip: clientLabels.statusActive }[client.status] || client.status}
                                </Badge>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="list" className="space-y-4">
                      <div className="space-y-2">
                        <Label>{t("Selecionar listas")}</Label>
                        <div className="border rounded-md max-h-[200px] overflow-y-auto">
                          <div className="p-2 space-y-1">
                            {contactLists.length === 0 ? (
                              <p className="text-sm text-muted-foreground text-center py-4">{t("Nenhuma lista disponível")}</p>
                            ) : (
                              contactLists.map(l => {
                                const isChecked = selectedListIds.includes(l.id);
                                return (
                                  <div
                                    key={l.id}
                                    className={`flex items-center gap-3 p-2 rounded-md cursor-pointer hover:bg-muted/50 ${isChecked ? 'bg-primary/10' : ''}`}
                                    onClick={() => {
                                      setSelectedListIds(prev =>
                                        isChecked ? prev.filter(id => id !== l.id) : [...prev, l.id]
                                      );
                                    }}
                                  >
                                    <Checkbox checked={isChecked} />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium truncate">{l.name}</p>
                                    </div>
                                    <Badge variant="secondary" className="text-xs shrink-0">{l.member_count}</Badge>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>

                      {selectedListIds.length > 0 && (
                        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                          <div className="text-sm">
                            <p className="font-medium">{t("{{n}} lista(s) selecionada(s)", { n: selectedListIds.length })}</p>
                            {selectedClients.length > 0 && (
                              <p className="text-xs text-muted-foreground">{t("{{n}} contacto(s) carregado(s)", { n: selectedClients.length })}</p>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={loadingListMembers}
                            onClick={() => void loadContactsFromLists(selectedListIds)}
                          >
                            {loadingListMembers ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Carregar contactos")}
                          </Button>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </StepperSection>

                {/* Assunto */}
                <StepperSection
                  title={t("Assunto")}
                  complete={!!subject.trim()}
                  summary={subject || t('Sem assunto definido')}
                  expanded={expandedSection === 'subject'}
                  onToggle={() => setExpandedSection(expandedSection === 'subject' ? null : 'subject')}
                >
                  <div className="space-y-2">
                    <Label>{t("Assunto do email")}</Label>
                    <Input
                      placeholder={t("Ex: Novidades de Janeiro")}
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {contentMode === "template" && selectedTemplate
                        ? t("Pré-preenchido pelo template. Pode editar manualmente.")
                        : t("Escreva o assunto que aparecerá na caixa de entrada.")}
                    </p>
                  </div>
                </StepperSection>

                {/* Conteúdo */}
                <StepperSection
                  title={t("Conteúdo")}
                  complete={contentComplete}
                  summary={
                    contentMode === "template"
                      ? (selectedTemplate?.name || t('Nenhum template selecionado'))
                      : (customHtml.trim() ? t('Email personalizado') : t('Sem conteúdo'))
                  }
                  expanded={expandedSection === 'content'}
                  onToggle={() => setExpandedSection(expandedSection === 'content' ? null : 'content')}
                >
                  <Tabs value={contentMode} onValueChange={(v) => setContentMode(v as ContentMode)} className="space-y-4">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="template" className="text-xs">{t("Usar Template")}</TabsTrigger>
                      <TabsTrigger value="custom" className="text-xs">{t("Criar email")}</TabsTrigger>
                    </TabsList>

                    <TabsContent value="template" className="space-y-3">
                      <Label>{t("Selecionar template")}</Label>
                      <Select value={templateId} onValueChange={handleTemplateChange}>
                        <SelectTrigger>
                          <SelectValue placeholder={t("Selecionar template...")} />
                        </SelectTrigger>
                        <SelectContent>
                          {activeTemplates.map(tpl => (
                            <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedTemplate && (
                        <div className="text-xs text-muted-foreground p-3 bg-muted/50 rounded-md">
                          <p><strong>{t("Assunto:")}</strong> {selectedTemplate.subject}</p>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="custom" className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        {t("Crie o email diretamente aqui. Este conteúdo não será guardado como template.")}
                      </p>
                      <TemplateEditor value={customHtml} onChange={setCustomHtml} />
                    </TabsContent>
                  </Tabs>
                </StepperSection>

                {/* Configurações adicionais */}
                <div className="border rounded-lg bg-card">
                  <button
                    className="flex items-center gap-3 p-4 w-full text-left hover:bg-muted/30 transition-colors"
                    onClick={() => setShowSettings(!showSettings)}
                  >
                    <Settings2 className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{t("Definições adicionais")}</p>
                      <p className="text-xs text-muted-foreground">{t("Personalização, rastreio, subscrição")}</p>
                    </div>
                    {showSettings ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </button>
                  {showSettings && (
                    <div className="px-4 pb-4 border-t">
                      <div className="pt-4 space-y-5">
                        {CAMPAIGN_SETTINGS_GROUPS.map((group) => (
                          <div key={group.title} className="space-y-2">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t(group.title)}</p>
                            <div className="space-y-2">
                              {group.items.map((item) => (
                                <div key={item.key} className="space-y-2">
                                  <label className={`flex items-center gap-3 ${item.soon ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                                    <Checkbox
                                      checked={!!settings[item.key]}
                                      disabled={item.soon}
                                      onCheckedChange={(checked) => {
                                        setSettings(prev => ({ ...prev, [item.key]: !!checked }));
                                        if (!checked) setSettingsData(prev => { const n = { ...prev }; delete n[item.key]; return n; });
                                      }}
                                    />
                                    <span className="text-sm">{t(item.label)}</span>
                                    {item.soon && <Badge variant="secondary" className="text-[10px] ml-1">{t("Em breve")}</Badge>}
                                  </label>
                                  {settings[item.key] && item.inputType && !item.soon && (
                                    <div className="ml-9">
                                      {item.inputType === 'textarea' ? (
                                        <Textarea
                                          placeholder={item.placeholder ? t(item.placeholder) : undefined}
                                          value={settingsData[item.key] || ''}
                                          onChange={(e) => setSettingsData(prev => ({ ...prev, [item.key]: e.target.value }))}
                                          className="text-xs min-h-[60px]"
                                        />
                                      ) : (
                                        <Input
                                          type={item.inputType}
                                          placeholder={item.placeholder ? t(item.placeholder) : undefined}
                                          value={settingsData[item.key] || ''}
                                          onChange={(e) => setSettingsData(prev => ({ ...prev, [item.key]: e.target.value }))}
                                          className="text-xs h-9"
                                        />
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                        <Button variant="outline" size="sm" onClick={() => setShowSettings(false)}>
                          {t("Guardar")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>

            {/* Footer with Schedule + Send / Save Draft */}
            <div className="border-t bg-card px-4 md:px-6 py-4">
              <div className="max-w-3xl mx-auto w-full flex flex-col gap-3">
                {!allSectionsComplete && (
                  <p className="text-xs text-warning">
                    {t("Preencha destinatários, assunto e conteúdo para poder enviar ou agendar a campanha.")}
                  </p>
                )}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">{t("{{n}} destinatário(s)", { n: selectedClients.length })}</p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={!name.trim() || createCampaign.isPending || updateCampaign.isPending}
                      onClick={async () => {
                        try {
                          if (isEditMode) {
                            await updateCampaign.mutateAsync({
                              id: campaign!.id,
                              name,
                              template_id: contentMode === "template" && templateId ? templateId : null,
                              subject: subject || null,
                              html_content: contentMode === "custom" && customHtml ? customHtml : null,
                              settings,
                              settings_data: persistedSettingsData,
                            });
                          } else {
                            await createCampaign.mutateAsync({
                              name,
                              template_id: contentMode === "template" && templateId ? templateId : undefined,
                              subject: subject || undefined,
                              html_content: contentMode === "custom" && customHtml ? customHtml : undefined,
                              settings,
                              settings_data: persistedSettingsData,
                            });
                          }
                          handleClose();
                        } catch {}
                      }}
                    >
                      {(createCampaign.isPending || updateCampaign.isPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      {t("Guardar Campanha")}
                    </Button>
                    {allSectionsComplete && (
                      <>
                        <Popover open={showSchedulePicker} onOpenChange={setShowSchedulePicker}>
                          <PopoverTrigger asChild>
                            <Button variant="outline">
                              <Clock className="mr-2 h-4 w-4" /> {t("Agendar envio")}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-4 space-y-3" align="end">
                            <p className="text-sm font-semibold">{t("Agendar para:")}</p>
                            <Calendar
                              mode="single"
                              selected={scheduleDate}
                              onSelect={setScheduleDate}
                              locale={dateLocale()}
                              disabled={(date) => date < new Date()}
                            />
                            <div className="space-y-1">
                              <Label className="text-xs">{t("Hora")}</Label>
                              <Input
                                type="time"
                                value={scheduleTime}
                                onChange={(e) => setScheduleTime(e.target.value)}
                              />
                            </div>
                            <Button
                              className="w-full"
                              disabled={!scheduleDate}
                              onClick={() => {
                                setSendMode("scheduled");
                                setShowSchedulePicker(false);
                                setStep(4);
                              }}
                            >
                              {t("Confirmar agendamento")}
                            </Button>
                          </PopoverContent>
                        </Popover>
                        <Button onClick={() => { setSendMode("immediate"); setStep(4); }}>
                          <Send className="mr-2 h-4 w-4" /> {t("Enviar campanha")}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ====== Step 4: Confirmation ====== */}
        {step === 4 && (
          <>
            <div className="border-b bg-card">
              <div className="max-w-xl mx-auto w-full px-4 md:px-6 py-4 flex items-center gap-3">
                <Button variant="back" size="icon" className="h-8 w-8" onClick={() => setStep(3)}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <DialogTitle className="text-lg font-semibold">
                  {sendMode === "scheduled" ? t("Confirmar Agendamento") : t("Confirmar Envio")}
                </DialogTitle>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="max-w-xl mx-auto w-full px-4 md:px-6 py-8 space-y-6">
                <div className="p-4 bg-muted/50 rounded-lg border space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">{t("Campanha:")}</span>
                    <span className="text-sm font-medium">{name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">{t("Assunto:")}</span>
                    <span className="text-sm font-medium truncate max-w-[200px]">{subject}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">{t("Conteúdo:")}</span>
                    <span className="text-sm font-medium">
                      {contentMode === "template" ? selectedTemplate?.name : t("Email personalizado")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">{t("Destinatários:")}</span>
                    <span className="text-sm font-medium">{selectedClients.length}</span>
                  </div>
                  {sendMode === "scheduled" && scheduleDate && (
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">{t("Agendado para:")}</span>
                      <span className="text-sm font-medium">
                        {t("{{date}} às {{time}}", { date: format(scheduleDate, "dd/MM/yyyy", { locale: dateLocale() }), time: scheduleTime })}
                      </span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("Lista de envio")}</p>
                  <div className="border rounded-lg divide-y">
                    {selectedClients.slice(0, 20).map((client) => (
                      <div key={client.id} className="flex items-center gap-2 px-4 py-3 text-sm">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate">{client.name}</span>
                        <span className="text-muted-foreground text-xs truncate">({client.email})</span>
                      </div>
                    ))}
                    {selectedClients.length > 20 && (
                      <div className="px-4 py-3 text-sm text-muted-foreground">
                        {t("... e mais {{n}} destinatário(s)", { n: selectedClients.length - 20 })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>

            <div className="border-t bg-card px-4 md:px-6 py-4">
              <div className="max-w-xl mx-auto w-full flex justify-end gap-3">
                <Button variant="outline" onClick={() => setStep(3)}>{t("Voltar")}</Button>
                <Button onClick={handleSend} disabled={isSending}>
                  {isSending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("A processar...")}</>
                  ) : sendMode === "scheduled" ? (
                    <><Clock className="mr-2 h-4 w-4" />{t("Agendar Campanha")}</>
                  ) : (
                    <><Send className="mr-2 h-4 w-4" />{t("Enviar Campanha")}</>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* Stepper section component */
function StepperSection({
  title,
  complete,
  summary,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  complete: boolean;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <div className="border rounded-lg bg-card">
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={onToggle}
      >
        {complete ? (
          <div className="h-6 w-6 rounded-full bg-green-500 flex items-center justify-center shrink-0">
            <Check className="h-3.5 w-3.5 text-white" />
          </div>
        ) : (
          <div className="h-6 w-6 rounded-full border-2 border-muted-foreground/30 shrink-0">
            <Circle className="h-full w-full text-transparent" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground truncate">{summary}</p>
        </div>
        {children && (
          <Button variant="ghost" size="sm" className="shrink-0 text-xs">
            <Pencil className="h-3 w-3 mr-1" /> {expanded ? t('Fechar') : t('Alterar')}
          </Button>
        )}
      </div>
      {expanded && children && (
        <div className="px-4 pb-4 pt-0 border-t">
          <div className="pt-4">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
