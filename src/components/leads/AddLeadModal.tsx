import { useEffect, useState, useRef, useMemo } from "react";
import { isPerfect2GetherOrg } from "@/lib/perfect2gether";
import { toast } from "@/hooks/use-toast";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PhoneInput } from "@/components/ui/phone-input";
import { Loader2, Zap, UserCircle, X, User, Upload, FileText, Trash2, Paperclip, Building2, Contact, Settings2, StickyNote, Eye, AlertTriangle } from "lucide-react";
import { useCreateLead } from "@/hooks/useLeads";
import { useAddContactNote } from "@/hooks/useContactNotes";
import { useNifValidation } from "@/hooks/useNifValidation";
import { useTeamMembers } from "@/hooks/useTeam";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useUploadLeadAttachment } from "@/hooks/useLeadAttachments";
import { useLeadFieldsSettings } from "@/hooks/useLeadFieldsSettings";
import { LeadFieldsSettings, DEFAULT_LEAD_FIELDS_SETTINGS } from "@/types/field-settings";
import { useModules } from "@/hooks/useModules";
import type { LeadTemperature, LeadTipologia } from "@/types";
import { ROLE_LABELS as RoleLabels, TIPOLOGIA_LABELS, TIPOLOGIA_STYLES } from "@/types";
import { tr, useLanguage } from "@/i18n";

const SOURCES = [
  "Entrada Manual",
  "Chamada Telefónica",
  "Evento/Networking",
  "Referência",
  "Website (orgânico)",
  "Redes Sociais",
  "Tráfego Pago",
  "Outro",
] as const;

const TEMPERATURE_LABELS: Record<string, { label: string; emoji: string }> = {
  cold: { label: "Frio", emoji: "🧊" },
  warm: { label: "Morno", emoji: "🌤️" },
  hot: { label: "Quente", emoji: "🔥" },
};

function buildLeadSchema(settings: LeadFieldsSettings | undefined, niche?: string | null) {
  const s = settings ?? DEFAULT_LEAD_FIELDS_SETTINGS;
  const isTelecom = niche === 'telecom';

  const strField = (key: keyof LeadFieldsSettings, minLen = 1) => {
    const cfg = s[key];
    if (!cfg?.visible || !cfg?.required) return z.string().optional().or(z.literal(""));
    return z.string().min(minLen, tr("{{field}} é obrigatório", { field: tr(cfg.label) }));
  };

  return z.object({
    company_nif: strField('company_nif'),
    company_name: strField('company_name', 2),
    name: strField('name', 2),
    email: s.email?.visible && s.email?.required
      ? z.string().email(tr("Email inválido")).max(255, tr("Email muito longo"))
      : z.string().optional().or(z.literal("")),
    phone: s.phone?.visible && s.phone?.required
      ? z.string().min(9, tr("Telemóvel inválido")).max(20, tr("Telemóvel muito longo"))
      : z.string().optional().or(z.literal("")),
    source: z.string().optional(),
    temperature: z.enum(["cold", "warm", "hot"]).optional(),
    value: z.coerce.number().min(0, tr("Valor inválido")).optional().or(z.literal("")),
    notes: z.string().max(500, tr("Notas muito longas")).optional(),
    gdpr_consent: z.literal(true, {
      errorMap: () => ({ message: tr("Consentimento RGPD é obrigatório") }),
    }),
    automation_enabled: z.boolean().default(true),
    assigned_to: z.string().optional(),
    tipologia: z.enum(["ee", "gas", "servicos", "ee_servicos"]).optional(),
    consumo_anual: z.coerce.number().min(0, tr("Consumo inválido")).optional().or(z.literal("")),
  });
}

type AddLeadFormData = z.infer<ReturnType<typeof buildLeadSchema>>;

interface AddLeadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill name/phone/email/source (e.g. opened from an inbox conversation). */
  initialData?: { name?: string; phone?: string; email?: string; source?: string };
  /** Called with the new lead id after it is created (e.g. to link a conversation). */
  onCreated?: (leadId: string) => void;
}

export function AddLeadModal({ open, onOpenChange, initialData, onCreated }: AddLeadModalProps) {
  const { t, language } = useLanguage();
  const createLead = useCreateLead();
  const addContactNote = useAddContactNote();
  const uploadAttachment = useUploadLeadAttachment();
  const { data: teamMembers } = useTeamMembers();
  const { canManageTeam } = usePermissions();
  const { organization } = useAuth();
  const { data: fieldSettings } = useLeadFieldsSettings();

  const fs = fieldSettings ?? DEFAULT_LEAD_FIELDS_SETTINGS;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const schema = useMemo(() => buildLeadSchema(fieldSettings, organization?.niche), [fieldSettings, organization?.niche, language]);

  const [matchedClient, setMatchedClient] = useState<{ id: string; name: string; email: string | null; phone: string | null; notes: string | null; company: string | null } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [cpeValue, setCpeValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isTelecom = organization?.niche === 'telecom';
  const isP2G = isPerfect2GetherOrg(organization?.id);
  const { modules } = useModules();
  const showEnergy = isTelecom && modules.energy;
  // Isto lia a configuração de WhatsApp da organização para decidir se mostrava
  // o interruptor de automação da lead. Deixou de haver envio por WhatsApp, por
  // isso é sempre falso: o interruptor não aparece e a lead entra sem automação
  // de WhatsApp associada. (Também eliminava seis erros de tipo que estavam
  // escondidos — as colunas whatsapp_* nem sequer constam do tipo Organization.)
  const hasActiveWhatsappAutomation = false;

  const form = useForm<AddLeadFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      company_nif: "",
      company_name: "",
      name: "",
      email: "",
      phone: "",
      source: "Entrada Manual",
      temperature: "cold",
      value: "",
      notes: "",
      gdpr_consent: false as unknown as true as unknown as true,
      automation_enabled: true,
      assigned_to: "",
      tipologia: undefined,
      consumo_anual: "",
    },
  });

  useEffect(() => {
    if (!hasActiveWhatsappAutomation) {
      form.setValue('automation_enabled', false);
    }
  }, [form, hasActiveWhatsappAutomation]);

  // Pre-fill from initialData when the modal opens (e.g. from an inbox contact).
  useEffect(() => {
    if (!open || !initialData) return;
    if (initialData.name) form.setValue('name', initialData.name);
    if (initialData.phone) form.setValue('phone', initialData.phone);
    if (initialData.email) form.setValue('email', initialData.email);
    if (initialData.source) form.setValue('source', initialData.source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const companyNifValue = useWatch({ control: form.control, name: 'company_nif' }) || '';
  const nifValidation = useNifValidation({
    nif: companyNifValue,
    organizationId: organization?.id,
  });

  const watchedValues = useWatch({ control: form.control });

  // Helper: is field visible?
  const isVisible = (key: keyof LeadFieldsSettings) => fs[key]?.visible !== false;
  // Helper: is field required?
  const isRequired = (key: keyof LeadFieldsSettings) => fs[key]?.visible !== false && fs[key]?.required === true;
  // Helper: get label
  const getLabel = (key: keyof LeadFieldsSettings, fallback: string) => t(fs[key]?.label || fallback);
  // Helper: label with optional asterisk
  const labelText = (key: keyof LeadFieldsSettings, fallback: string) => {
    return `${getLabel(key, fallback)}${isRequired(key) ? ' *' : ''}`;
  };

  const searchExistingClient = async (nifValue: string) => {
    if (!nifValue || nifValue.length < 3 || !organization?.id) return;
    setIsSearching(true);
    try {
      const { data } = await supabase
        .from('crm_clients')
        .select('id, name, email, phone, notes, company')
        .eq('organization_id', organization.id)
        .eq('company_nif', nifValue)
        .limit(1)
        .maybeSingle();

      if (data) {
        setMatchedClient(data);
        // Don't auto-fill if NIF belongs to existing client (blocked)
        if (!nifValidation.isDuplicate) {
          if (!form.getValues('name')) form.setValue('name', data.name);
          if (!form.getValues('company_name') && data.company) form.setValue('company_name', data.company);
          if (!form.getValues('email') && data.email) form.setValue('email', data.email);
          if (!form.getValues('phone') && data.phone) form.setValue('phone', data.phone);
          // Notes are keyed by phone — the matched contact's notes already show in
          // the unified timeline, so no pre-fill needed.
        }
      } else {
        setMatchedClient(null);
      }
    } finally {
      setIsSearching(false);
    }
  };

  const clearMatchedClient = () => {
    setMatchedClient(null);
  };

  const onSubmit = async (data: AddLeadFormData) => {
    const lead = await createLead.mutateAsync({
      company_nif: data.company_nif || undefined,
      company_name: data.company_name || undefined,
      name: data.name || data.company_name || '',
      email: data.email || '',
      phone: data.phone || '',
      source: data.source,
      temperature: data.temperature as LeadTemperature,
      value: showEnergy ? undefined : (data.value ? Number(data.value) : undefined),
      gdpr_consent: data.gdpr_consent,
      automation_enabled: hasActiveWhatsappAutomation && data.automation_enabled,
      assigned_to: data.assigned_to && data.assigned_to !== 'unassigned' ? data.assigned_to : undefined,
      tipologia: showEnergy ? data.tipologia as LeadTipologia : undefined,
      consumo_anual: showEnergy && data.consumo_anual ? Number(data.consumo_anual) : undefined,
      custom_data: cpeValue.trim() ? { cpe: cpeValue.trim() } : undefined,
    });

    if (pendingFiles.length > 0 && lead?.id) {
      for (const file of pendingFiles) {
        await uploadAttachment.mutateAsync({ leadId: lead.id, file });
      }
    }

    // Notes go to the unified contact_notes timeline (by phone), not the legacy column.
    if (data.notes?.trim() && data.phone?.trim()) {
      addContactNote.mutate({ phone: data.phone.trim(), content: data.notes.trim(), source: "crm" });
    }

    if (lead?.id) onCreated?.(lead.id);

    setMatchedClient(null);
    setPendingFiles([]);
    setCpeValue("");
    form.reset({
      company_nif: "",
      company_name: "",
      name: "",
      email: "",
      phone: "",
      source: "Entrada Manual",
      temperature: "cold",
      value: "",
      notes: "",
      gdpr_consent: false as unknown as true as unknown as true,
      automation_enabled: hasActiveWhatsappAutomation,
      assigned_to: "",
      tipologia: undefined,
      consumo_anual: "",
    });
    onOpenChange(false);
  };

  const handleAddFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const maxSize = 10 * 1024 * 1024;
    const validFiles = Array.from(files).filter(f => f.size <= maxSize);
    setPendingFiles(prev => [...prev, ...validFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Check if empresa card has any visible fields
  const showEmpresaCard = isVisible('company_nif') || isVisible('company_name') || isTelecom;
  // Check if contacto card has any visible fields
  const showContactoCard = isVisible('name') || isVisible('email') || isVisible('phone');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex flex-col p-0 gap-0">
        {/* Header */}
        <div className="px-4 sm:px-6 pr-14 py-4 border-b border-border/50 shrink-0">
          <DialogHeader className="space-y-0">
            <DialogTitle className="text-lg font-semibold">{t("Adicionar Lead")}</DialogTitle>
          </DialogHeader>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-6xl mx-auto p-4 sm:p-6">
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Left Column - Form */}
                <div className="lg:col-span-3 space-y-6">
                  {/* Blocked: NIF belongs to existing client */}
                  {nifValidation.isDuplicate && (
                    <div className="flex items-center gap-2 rounded-md border border-destructive bg-destructive/10 p-3">
                      <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                      <span className="text-sm text-destructive flex-1">
                        {t("Este NIF já pertence ao cliente {{client}}. Não é possível criar um novo lead.", { client: `${nifValidation.existingClientCode ? `${nifValidation.existingClientCode} - ` : ''}${nifValidation.existingClientName ?? ''}` })}
                      </span>
                    </div>
                  )}

                  {/* Matched client banner (info only, when not blocked) */}
                  {matchedClient && !nifValidation.isDuplicate && (
                    <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3">
                      <User className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span className="text-sm text-amber-800 dark:text-amber-300 flex-1">
                        {t("Cliente existente:")} <strong>{matchedClient.name}</strong>
                      </span>
                      <button type="button" onClick={clearMatchedClient} className="text-amber-600 dark:text-amber-400 hover:text-amber-800">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {isSearching && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t("A verificar cliente...")}
                    </div>
                  )}

                  {/* Card: Empresa */}
                  {showEmpresaCard && (
                    <Card>
                      <CardHeader className="pb-4">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {t("Empresa")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {isVisible('company_nif') && (
                            <FormField
                              control={form.control}
                              name="company_nif"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{labelText('company_nif', 'NIF Empresa')}</FormLabel>
                                  <FormControl>
                                    <Input
                                      placeholder="123456789"
                                      {...field}
                                      onBlur={(e) => {
                                        field.onBlur();
                                        searchExistingClient(e.target.value);
                                      }}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                   {nifValidation.isDuplicate && (
                                     <p className="text-xs text-destructive mt-1 font-medium">
                                       {t("Este NIF pertence ao cliente {{client}}. Não é possível criar leads duplicados.", { client: `${nifValidation.existingClientCode ? `${nifValidation.existingClientCode} - ` : ''}${nifValidation.existingClientName ?? ''}` })}
                                     </p>
                                   )}
                                </FormItem>
                              )}
                            />
                          )}
                          {isVisible('company_name') && (
                            <FormField
                              control={form.control}
                              name="company_name"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{labelText('company_name', 'Nome da Empresa')}</FormLabel>
                                  <FormControl>
                                    <Input placeholder={t("Empresa Exemplo, Lda")} disabled={nifValidation.isDuplicate} {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                        </div>
                        {isP2G && (
                          <div className="mt-4">
                            <label className="text-sm font-medium leading-none">CPE/CUI</label>
                            <Input
                              className="mt-2"
                              placeholder="PT00..."
                              value={cpeValue}
                              onChange={(e) => setCpeValue(e.target.value)}
                              disabled={nifValidation.isDuplicate}
                            />
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Card: Contacto */}
                  {showContactoCard && (
                    <Card>
                      <CardHeader className="pb-4">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Contact className="h-4 w-4 text-muted-foreground" />
                          {t("Contacto")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {isVisible('name') && (
                          <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{labelText('name', 'Nome Completo')}</FormLabel>
                                <FormControl>
                                  <Input placeholder="João Silva" disabled={nifValidation.isDuplicate} {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {isVisible('email') && (
                            <FormField
                              control={form.control}
                              name="email"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{labelText('email', 'Email')}</FormLabel>
                                  <FormControl>
                                    <Input type="email" placeholder="joao@exemplo.pt" disabled={nifValidation.isDuplicate} {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                          {isVisible('phone') && (
                            <FormField
                              control={form.control}
                              name="phone"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{labelText('phone', 'Telemóvel')}</FormLabel>
                                  <FormControl>
                                    <PhoneInput value={field.value} onChange={field.onChange} disabled={nifValidation.isDuplicate} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Card: Detalhes */}
                  <Card>
                    <CardHeader className="pb-4">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Settings2 className="h-4 w-4 text-muted-foreground" />
                        {t("Detalhes")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {isVisible('source') && (
                          <FormField
                            control={form.control}
                            name="source"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{labelText('source', 'Origem')}</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder={t("Selecionar")} />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {SOURCES.map((source) => (
                                      <SelectItem key={source} value={source}>{t(source)}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                        {isVisible('temperature') && (
                          <FormField
                            control={form.control}
                            name="temperature"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{labelText('temperature', 'Temperatura')}</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder={t("Selecionar")} />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="cold">🧊 {t("Frio")}</SelectItem>
                                    <SelectItem value="warm">🌤️ {t("Morno")}</SelectItem>
                                    <SelectItem value="hot">🔥 {t("Quente")}</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                      </div>

                      {isVisible('tipologia') && showEnergy && (
                        <FormField
                          control={form.control}
                          name="tipologia"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{labelText('tipologia', 'Tipologia')}</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder={t("Selecionar tipologia")} />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {(Object.keys(TIPOLOGIA_LABELS) as LeadTipologia[]).map((tipo) => (
                                    <SelectItem key={tipo} value={tipo}>
                                      <span className="flex items-center gap-2">
                                        <span>{TIPOLOGIA_STYLES[tipo].emoji}</span>
                                        {t(TIPOLOGIA_LABELS[tipo])}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

                      {isVisible('consumo_anual') && showEnergy ? (
                        <FormField
                          control={form.control}
                          name="consumo_anual"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{labelText('consumo_anual', 'Consumo Anual/kWp (kWh)')}</FormLabel>
                              <FormControl>
                                <Input type="number" min="0" step="1" placeholder="0" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      ) : isVisible('value') && !showEnergy ? (
                        <FormField
                          control={form.control}
                          name="value"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{labelText('value', 'Valor do Negócio (€)')}</FormLabel>
                              <FormControl>
                                <Input type="number" min="0" step="0.01" placeholder="0.00" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      ) : null}

                      {teamMembers && teamMembers.length > 0 && (
                        <FormField
                          control={form.control}
                          name="assigned_to"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="flex items-center gap-2">
                                <UserCircle className="h-4 w-4" />
                                {t("Atribuir a")}
                              </FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder={t("Não atribuído")} />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="unassigned">{t("Não atribuído")}</SelectItem>
                                  {teamMembers
                                    .filter(m => !m.is_banned && (m.role === 'salesperson' || m.role === 'admin' || m.role === 'viewer'))
                                    .map((member) => (
                                      <SelectItem key={member.user_id} value={member.user_id}>
                                        {member.full_name} ({RoleLabels[member.role] ? t(RoleLabels[member.role]) : member.role})
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
                    </CardContent>
                  </Card>

                  {/* Card: Observações & Anexos */}
                  {isVisible('notes') && (
                    <Card>
                      <CardHeader className="pb-4">
                        <CardTitle className="text-base flex items-center gap-2">
                          <StickyNote className="h-4 w-4 text-muted-foreground" />
                          {getLabel('notes', 'Observações')}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <FormField
                          control={form.control}
                          name="notes"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Textarea
                                  placeholder={t("Notas adicionais sobre o lead...")}
                                  className="resize-none"
                                  rows={3}
                                  disabled={nifValidation.isDuplicate}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {isTelecom && (
                          <div className="space-y-3 rounded-md border p-4">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium flex items-center gap-2">
                                <Paperclip className="h-4 w-4 text-muted-foreground" />
                                {t("Anexar Faturas")}
                              </span>
                              <div>
                                <input
                                  ref={fileInputRef}
                                  type="file"
                                  accept=".pdf,.png,.jpg,.jpeg"
                                  multiple
                                  className="hidden"
                                  onChange={handleAddFiles}
                                />
                                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                                  <Upload className="h-4 w-4" />
                                  {t("Adicionar")}
                                </Button>
                              </div>
                            </div>
                            {pendingFiles.length > 0 && (
                              <div className="space-y-2">
                                {pendingFiles.map((file, i) => (
                                  <div key={i} className="flex items-center gap-2 rounded bg-muted/50 p-2 text-sm">
                                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                    <span className="flex-1 truncate">{file.name}</span>
                                    <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>
                                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => removePendingFile(i)}>
                                      <Trash2 className="h-3 w-3 text-destructive" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                            {pendingFiles.length === 0 && (
                              <p className="text-xs text-muted-foreground">{t("PDF, PNG ou JPG (máx. 10MB)")}</p>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Right Column - Summary & Actions */}
                <div className="lg:col-span-2">
                  <div className="lg:sticky lg:top-0 space-y-6">
                    {/* Summary Card */}
                    <Card>
                      <CardHeader className="pb-4">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Eye className="h-4 w-4 text-muted-foreground" />
                          {t("Resumo")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3 text-sm">
                          {isVisible('company_name') && <SummaryRow label={getLabel('company_name', 'Empresa')} value={watchedValues.company_name} />}
                          {isVisible('company_nif') && <SummaryRow label={getLabel('company_nif', 'NIF')} value={watchedValues.company_nif} />}
                          {isVisible('name') && <SummaryRow label={getLabel('name', 'Nome')} value={watchedValues.name} />}
                          {isVisible('email') && <SummaryRow label={getLabel('email', 'Email')} value={watchedValues.email} />}
                          {isVisible('phone') && <SummaryRow label={getLabel('phone', 'Telefone')} value={watchedValues.phone} />}
                          {isVisible('source') && <SummaryRow label={getLabel('source', 'Origem')} value={watchedValues.source ? t(watchedValues.source) : watchedValues.source} />}
                          {isVisible('temperature') && watchedValues.temperature && (
                            <SummaryRow
                              label={getLabel('temperature', 'Temperatura')}
                              value={`${TEMPERATURE_LABELS[watchedValues.temperature]?.emoji} ${t(TEMPERATURE_LABELS[watchedValues.temperature]?.label ?? '')}`}
                            />
                          )}
                          {isVisible('value') && !showEnergy && watchedValues.value && (
                            <SummaryRow label={getLabel('value', 'Valor')} value={`€${watchedValues.value}`} />
                          )}
                          {isVisible('tipologia') && showEnergy && watchedValues.tipologia && (
                            <SummaryRow
                              label={getLabel('tipologia', 'Tipologia')}
                              value={`${TIPOLOGIA_STYLES[watchedValues.tipologia as LeadTipologia]?.emoji} ${t(TIPOLOGIA_LABELS[watchedValues.tipologia as LeadTipologia] ?? '')}`}
                            />
                          )}
                          {isVisible('consumo_anual') && showEnergy && watchedValues.consumo_anual && (
                            <SummaryRow label={getLabel('consumo_anual', 'Consumo')} value={`${watchedValues.consumo_anual} kWh`} />
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    {/* RGPD & Automation */}
                    <Card>
                      <CardContent className="pt-6 space-y-4">
                        <FormField
                          control={form.control}
                          name="gdpr_consent"
                          render={({ field }) => (
                             <FormItem>
                              <div className="flex flex-row items-start space-x-3 space-y-0">
                                <FormControl>
                                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                                </FormControl>
                                <div className="space-y-1 leading-none">
                                  <FormLabel>{t("Consentimento RGPD obtido *")}</FormLabel>
                                  <p className="text-xs text-muted-foreground">
                                    {t("Confirmo que obtive consentimento para guardar estes dados.")}
                                  </p>
                                </div>
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {hasActiveWhatsappAutomation && (
                          <FormField
                            control={form.control}
                            name="automation_enabled"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-primary/20 bg-primary/5 p-3">
                                <FormControl>
                                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                                </FormControl>
                                <div className="space-y-1 leading-none">
                                  <FormLabel className="flex items-center gap-2">
                                    <Zap className="h-4 w-4 text-primary" />
                                    {t("Ativar automação")}
                                  </FormLabel>
                                  <p className="text-xs text-muted-foreground">
                                    {t("Enviar mensagem automática de WhatsApp e notificar a equipa.")}
                                  </p>
                                </div>
                              </FormItem>
                            )}
                          />
                        )}
                      </CardContent>
                    </Card>

                    {/* Action Buttons */}
                    <div className="flex gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1"
                        onClick={() => onOpenChange(false)}
                      >
                        {t("Cancelar")}
                      </Button>
                      <Button
                        type="button"
                        className="flex-1"
                        disabled={createLead.isPending || nifValidation.isDuplicate}
                        onClick={() => {
                          form.handleSubmit(onSubmit, (errors) => {
                            const firstErrorKey = Object.keys(errors)[0];
                            if (firstErrorKey) {
                              const el = document.querySelector(`[name="${firstErrorKey}"]`)
                                || document.querySelector(`[data-field="${firstErrorKey}"]`)
                                || document.querySelector('.text-destructive');
                              if (el) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }
                            }
                            const firstError = Object.values(errors)[0];
                            toast({
                              title: t('Campos obrigatórios'),
                              description: (firstError?.message as string) || t('Preencha todos os campos obrigatórios.'),
                              variant: 'destructive',
                            });
                          })();
                        }}
                      >
                        {createLead.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t("A criar...")}
                          </>
                        ) : (
                          t("Criar Lead")
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium truncate max-w-[60%] text-right">
        {value || <span className="text-muted-foreground/50">—</span>}
      </span>
    </div>
  );
}
