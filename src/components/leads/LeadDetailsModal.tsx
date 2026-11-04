import { Lead, STATUS_LABELS, LeadStatus, LeadTemperature, LeadTipologia, TEMPERATURE_LABELS, TEMPERATURE_STYLES, TIPOLOGIA_LABELS, TIPOLOGIA_STYLES, FormSettings, CustomField, ROLE_LABELS } from "@/types";
import { isPerfect2GetherOrg } from "@/lib/perfect2gether";
import { LeadAttachments } from "@/components/leads/LeadAttachments";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { formatDate, formatDateTime, getInboxUrl } from "@/lib/format";
import { useNavigate } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { useTeamMembers } from "@/hooks/useTeam";
import { useModules } from "@/hooks/useModules";
import { EmailTemplateGate } from "@/components/marketing/EmailTemplateGate";
import { EMAIL_TEMPLATE_TRIGGERS } from "@/lib/email-template-triggers";

// Formata número com espaços nos milhares (estilo PT)
const formatNumberWithSpaces = (value: string | number): string => {
  const num = String(value).replace(/\s/g, '').replace(/[^\d]/g, '');
  if (!num) return '';
  return num.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};

// Remove espaços para obter o valor numérico
const parseFormattedNumber = (value: string): number | null => {
  const cleaned = value.replace(/\s/g, '');
  return cleaned ? parseFloat(cleaned) : null;
};
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { 
  MessageCircle, 
  Phone, 
  Mail, 
  Calendar, 
  Shield,
  Trash2,
  ExternalLink,
  Euro,
  FileText,
  Thermometer,
  ClipboardList,
  Target,
  UserCircle,
  Zap,
  ArrowLeft,
  Copy,
  Check,
  MapPin,
  Facebook,
  Instagram,
  Twitter,
  Youtube,
  Globe,
  CalendarPlus,
  Lock,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useState, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { SendLeadEmailModal } from "./SendLeadEmailModal";
import { isPlaceholderEmail, displayEmail } from "@/lib/leadUtils";
import { RecordTasks } from "@/components/inbox/RecordTasks";
import { LeadActivity } from "./LeadActivity";
import { initialsOf, TEMPERATURE_PILLS } from "./lead-display";
import { useLanguage } from "@/i18n";

const TECHNICAL_TRACKING_KEYS = ['fbclid', 'gclid', 'fbc', 'fbp'] as const;
const HIDDEN_CUSTOM_DATA_KEYS = ['metadata', 'prospect_id', 'source_file_name', 'prospect_source', 'cpe'] as const;

const socialMediaIcons = [
  { key: "facebook", icon: Facebook, label: "Facebook" },
  { key: "instagram", icon: Instagram, label: "Instagram" },
  { key: "twitter", icon: Twitter, label: "X/Twitter" },
  { key: "youtube", icon: Youtube, label: "YouTube" },
  { key: "tiktok", icon: Globe, label: "TikTok" },
] as const;

const shortenTrackingValue = (value: string, visibleChars = 10) => {
  if (value.length <= visibleChars * 2 + 3) return value;
  return `${value.slice(0, visibleChars)}...${value.slice(-visibleChars)}`;
};

interface LeadDetailsModalProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusChange: (leadId: string, newStatus: LeadStatus) => void;
  onDelete?: (leadId: string) => void;
  onUpdate?: (leadId: string, updates: Partial<Lead>) => void;
  inboxContact?: { name: string; phone: string | null };
  /** Opens the new-event form for this lead ("Agendar"). */
  onSchedule?: (lead: Lead) => void;
}

const statusStyles: Record<LeadStatus, string> = {
  new: "bg-primary/10 text-primary border-primary/20",
  contacted: "bg-[hsl(280,84%,60%)]/10 text-[hsl(280,84%,50%)] border-[hsl(280,84%,60%)]/20",
  scheduled: "bg-warning/10 text-warning border-warning/20",
  proposal: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  won: "bg-success/10 text-success border-success/20",
  lost: "bg-muted text-muted-foreground border-muted",
};

// Copies text to the clipboard. navigator.clipboard is undefined outside a
// secure context and throws on some in-app browsers (the Facebook/Instagram
// webviews leads often arrive from), so fall back to a hidden textarea.
async function writeToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Copy button for the contact fields. On mobile these are editable inputs, so
 * selecting the text by hand fights the caret and the keyboard — one tap here
 * takes the whole value instead.
 */
function CopyFieldButton({ value, label }: { value: string; label: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const handleCopy = async (e: React.MouseEvent) => {
    // The button sits next to an input; without this the input takes focus
    // and mobile pops the keyboard over the confirmation.
    e.preventDefault();
    e.stopPropagation();
    const ok = await writeToClipboard(value);
    if (!ok) {
      toast({ title: t("Erro ao copiar"), description: t("Não foi possível copiar o {{field}}.", { field: t(label).toLowerCase() }) });
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
    toast({ title: t("Copiado"), description: t("{{field}} copiado para a área de transferência.", { field: t(label) }) });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      // Tap targets under 36px are hard to hit with a thumb.
      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
      onMouseDown={(e) => e.preventDefault()}
      onClick={handleCopy}
      aria-label={t("Copiar {{field}}", { field: t(label).toLowerCase() })}
      title={t("Copiar {{field}}", { field: t(label).toLowerCase() })}
    >
      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

export function LeadDetailsModal({
  lead,
  open,
  onOpenChange,
  onStatusChange,
  onDelete,
  onUpdate,
  inboxContact,
  onSchedule,
}: LeadDetailsModalProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const { canDeleteLeads, canManageTeam, isAdmin } = usePermissions();
  const { organization } = useAuth();
  const { data: teamMembers } = useTeamMembers();
  const { data: stages } = usePipelineStages();

  // Check if lead is in a final stage
  const isLeadLocked = (() => {
    if (!lead || isAdmin) return false;
    const currentStage = stages?.find(s => s.key === lead.status);
    return currentStage?.is_final_positive || currentStage?.is_final_negative || false;
  })();
  // Editable fields state
  const [editValue, setEditValue] = useState<string>("");
  const [editConsumo, setEditConsumo] = useState<string>("");
  const [editNotes, setEditNotes] = useState<string>("");
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [editName, setEditName] = useState<string>("");
  const [editEmail, setEditEmail] = useState<string>("");
  const [editPhone, setEditPhone] = useState<string>("");
  const [isEditingValue, setIsEditingValue] = useState(false);
  const [isEditingConsumo, setIsEditingConsumo] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [editCpe, setEditCpe] = useState<string>("");
  const [isEditingCpe, setIsEditingCpe] = useState(false);
  const isP2G = isPerfect2GetherOrg(organization?.id);
  
  // Check if telecom template
  const isTelecom = organization?.niche === 'telecom';
  const { modules } = useModules();
  const showEnergy = isTelecom && modules.energy;

  // Get form settings for custom field labels
  const formSettings = organization?.form_settings as FormSettings | undefined;
  const customFields = formSettings?.custom_fields || [];

  // Parse custom_data and map to labels
  const customDataEntries = useMemo(() => {
    if (!lead?.custom_data || typeof lead.custom_data !== 'object') return [];
    
    const entries: { label: string; value: string; isUtm: boolean; key: string }[] = [];
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'fbc', 'fbp', 'ref'];
    const campaignLabels: Record<string, string> = {
      fbclid: 'Facebook Click ID',
      gclid: 'Google Click ID',
      fbc: 'Facebook Cookie',
      fbp: 'Facebook Browser ID',
      ref: t('Referência'),
    };
    
    Object.entries(lead.custom_data).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') return;
      if (HIDDEN_CUSTOM_DATA_KEYS.includes(key as any)) return;
      if (typeof value === 'object' && !Array.isArray(value)) return;
      const isUtm = utmKeys.includes(key);
      
      let label = key;
      if (!isUtm) {
        const fieldById = customFields.find((f: CustomField) => f.id === key);
        if (fieldById) {
          label = fieldById.label;
        } else {
          const fieldByLabel = customFields.find((f: CustomField) => f.label === key);
          if (fieldByLabel) {
            label = fieldByLabel.label;
          } else {
            label = key.replace(/_/g, ' ').replace(/^(.)/, (m) => m.toUpperCase());
          }
        }
      } else {
        label = campaignLabels[key] || key.replace('utm_', 'UTM ').replace(/^(.)/, (m) => m.toUpperCase());
      }
      
      let displayValue = String(value);
      if (typeof value === 'boolean') {
        displayValue = value ? t('Sim') : t('Não');
      } else if (Array.isArray(value)) {
        displayValue = value.join(', ');
      }
      
      entries.push({ label, value: displayValue, isUtm, key });
    });
    
    return entries;
  }, [lead?.custom_data, customFields, t]);

  const copyTrackingValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: t('Copiado'), description: t('Código copiado para a área de transferência.') });
    } catch {
      toast({ title: t('Erro ao copiar'), description: t('Não foi possível copiar o código.') });
    }
  };

  const formResponses = customDataEntries.filter(e => !e.isUtm);
  const utmData = customDataEntries.filter(e => e.isUtm);

  // Extract prospect metadata (Google Maps URL, social media, etc.)
  const prospectMetadata = useMemo(() => {
    const cd = lead?.custom_data as Record<string, unknown> | null;
    const meta = cd?.metadata as Record<string, unknown> | null;
    if (!meta) return null;
    return {
      googleMapsUrl: (meta.google_maps_url as string) || null,
      address: (meta.address as string) || null,
      rating: (meta.rating as number) || null,
      website: (meta.website as string) || null,
      facebook: (meta.facebook as string) || null,
      instagram: (meta.instagram as string) || null,
      twitter: (meta.twitter as string) || null,
      youtube: (meta.youtube as string) || null,
      tiktok: (meta.tiktok as string) || null,
    };
  }, [lead?.custom_data]);

  // Sync state when lead changes
  useEffect(() => {
    if (lead) {
      if (!isEditingValue) {
        const currentNumValue = parseFormattedNumber(editValue);
        const leadNumValue = lead.value ? Number(lead.value) : null;
        if (currentNumValue !== leadNumValue) {
          setEditValue(lead.value ? formatNumberWithSpaces(lead.value) : "");
        }
      }
      if (!isEditingConsumo) {
        const currentConsumo = parseFormattedNumber(editConsumo);
        const leadConsumo = lead.consumo_anual ? Number(lead.consumo_anual) : null;
        if (currentConsumo !== leadConsumo) {
          setEditConsumo(lead.consumo_anual ? formatNumberWithSpaces(lead.consumo_anual) : "");
        }
      }
      if (!isEditingNotes) setEditNotes(lead.notes || "");
      if (!isEditingName) setEditName(lead.name || "");
      if (!isEditingEmail) setEditEmail(displayEmail(lead.email));
      if (!isEditingPhone) setEditPhone(lead.phone || "");
      if (!isEditingCpe) setEditCpe((lead.custom_data as Record<string, unknown>)?.cpe as string || "");
    }
  }, [lead, isEditingValue, isEditingConsumo, isEditingNotes, isEditingName, isEditingEmail, isEditingPhone, isEditingCpe, editValue, editConsumo]);

  // Auto-grow the notes textarea so long notes are fully visible instead of
  // trapped in a tiny 80px scroll box. Caps at ~60dvh, then it scrolls.
  useEffect(() => {
    const el = notesRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editNotes]);

  if (!lead) return null;

  const handleFieldSave = (field: keyof Lead, value: string | number | null) => {
    if (!onUpdate) return;
    onUpdate(lead.id, { [field]: value });
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatNumberWithSpaces(e.target.value);
    setEditValue(formatted);
  };

  const handleValueBlur = () => {
    const numValue = parseFormattedNumber(editValue);
    const currentValue = lead.value ? Number(lead.value) : null;
    if (numValue !== currentValue) {
      handleFieldSave("value", numValue);
    }
    setTimeout(() => setIsEditingValue(false), 600);
  };

  const handleConsumoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatNumberWithSpaces(e.target.value);
    setEditConsumo(formatted);
  };

  const handleConsumoBlur = () => {
    const numValue = parseFormattedNumber(editConsumo);
    const currentConsumo = lead.consumo_anual ? Number(lead.consumo_anual) : null;
    if (numValue !== currentConsumo) {
      handleFieldSave("consumo_anual" as keyof Lead, numValue);
    }
    setTimeout(() => setIsEditingConsumo(false), 600);
  };

  const handleNotesBlur = () => {
    if (editNotes !== (lead.notes || "")) {
      handleFieldSave("notes", editNotes || null);
    }
  };

  const handleDelete = () => {
    onDelete(lead.id);
    setShowDeleteConfirm(false);
    onOpenChange(false);
  };

  const stageList = stages && stages.length > 0
    ? stages
    : Object.entries(STATUS_LABELS).map(([key, name]) => ({ key, name: t(name), color: "#64748b" }));
  const currentStageIndex = stageList.findIndex((stage) => stage.key === lead.status);
  const subtitle = [
    lead.company_name && lead.company_name !== lead.name ? lead.company_name : null,
    lead.company_nif ? t("NIF {{nif}}", { nif: lead.company_nif }) : null,
    lead.source || null,
    t("criada {{date}}", { date: formatDate(lead.created_at) }),
  ].filter(Boolean).join(" · ");
  const emailBlocked = !lead.email || isPlaceholderEmail(lead.email);
  const editableInput = "h-8 min-w-0 flex-1 border-transparent bg-transparent px-2 text-sm shadow-none transition-colors hover:border-border focus-visible:ring-1 focus-visible:ring-primary";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("Ficha da lead {{name}}", { name: lead.name })}</DialogTitle>
          <DialogDescription>{t("Contactos, fase, atividade e detalhes da lead")}</DialogDescription>
        </DialogHeader>

        {/* Header: who it is, how to reach them, and where they are in the pipeline. */}
        <header className="shrink-0 border-b bg-background px-4 pb-3 pt-3 sm:px-6">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-3">
            <Button variant="back" size="icon" onClick={() => onOpenChange(false)} className="h-9 w-9 shrink-0 rounded-full" aria-label={t("Voltar")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">
              {initialsOf(editName || lead.name)}
            </span>
            <div className="min-w-0 flex-1 basis-48">
              <div className="flex items-center gap-1">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onFocus={() => setIsEditingName(true)}
                  onBlur={() => {
                    if (editName.trim() && editName !== lead.name) {
                      handleFieldSave("name", editName.trim());
                    } else if (!editName.trim()) {
                      setEditName(lead.name);
                    }
                    setTimeout(() => setIsEditingName(false), 600);
                  }}
                  aria-label={t("Nome da lead")}
                  className="h-9 min-w-0 flex-1 border-transparent bg-transparent px-1.5 py-0 text-xl font-semibold tracking-tight shadow-none hover:border-border focus-visible:ring-1 focus-visible:ring-primary md:text-xl"
                  placeholder={t("Nome do lead")}
                />
                {editName.trim() && <CopyFieldButton value={editName.trim()} label="Nome" />}
              </div>
              <p className="truncate px-1.5 text-xs text-muted-foreground">{subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-9 rounded-full border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-800 dark:text-emerald-400"
                onClick={() => navigate(getInboxUrl(lead.phone))}>
                <MessageCircle className="h-4 w-4" />WhatsApp
              </Button>
              <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={() => window.location.href = `tel:${lead.phone}`}>
                <Phone className="h-4 w-4" />{t("Ligar")}
              </Button>
              <EmailTemplateGate triggerType={EMAIL_TEMPLATE_TRIGGERS.lead}>
                <Button variant="outline" size="sm" className="h-9 rounded-full" disabled={emailBlocked} onClick={() => setShowEmailModal(true)}>
                  <Mail className="h-4 w-4" />{t("Email")}
                </Button>
              </EmailTemplateGate>
              {onSchedule && (
                <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={() => onSchedule(lead)}>
                  <CalendarPlus className="h-4 w-4" />{t("Agendar")}
                </Button>
              )}
              {canDeleteLeads && onDelete && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label={t("Mais ações da lead")}><MoreHorizontal className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setShowDeleteConfirm(true)}>
                      <Trash2 className="mr-2 h-4 w-4" />{t("Eliminar lead (RGPD)")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          <div className="mx-auto mt-3 w-full max-w-6xl">
            <div className="flex gap-1 overflow-x-auto" role="group" aria-label={t("Fase da lead")}>
              {stageList.map((stage, index) => {
                const isCurrent = index === currentStageIndex;
                const done = currentStageIndex >= 0 && index < currentStageIndex;
                return (
                  <button key={stage.key} type="button" disabled={isLeadLocked || isCurrent}
                    aria-current={isCurrent ? "step" : undefined}
                    title={isCurrent ? t("Fase atual") : t("Mover para {{stage}}", { stage: stage.name })}
                    onClick={() => onStatusChange(lead.id, stage.key as LeadStatus)}
                    className={cn("min-w-[5.5rem] flex-1 truncate rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-default",
                      !isCurrent && !done && "bg-muted text-muted-foreground enabled:hover:bg-muted/70 enabled:hover:text-foreground",
                      isCurrent && "text-white")}
                    style={isCurrent ? { backgroundColor: stage.color } : done ? { backgroundColor: `${stage.color}22`, color: stage.color } : undefined}>
                    {stage.name}
                  </button>
                );
              })}
            </div>
            {isLeadLocked && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" />{t("Apenas administradores podem mudar a fase de leads finalizadas.")}</p>
            )}
          </div>
        </header>

        {inboxContact && (
          <div className="shrink-0 flex items-center gap-3 border-b bg-green-500/5 px-4 sm:px-6 py-2.5">
            <span className="text-[11px] font-medium text-green-700 uppercase tracking-wide shrink-0">WhatsApp</span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
              <button type="button" title={t("Clica para copiar o nome")}
                onClick={() => navigator.clipboard.writeText(inboxContact.name)}
                className="flex items-center gap-1 text-sm text-foreground hover:text-primary transition-colors">
                <span className="truncate max-w-[200px]">{inboxContact.name}</span>
                <Copy className="h-3 w-3 shrink-0 text-muted-foreground" />
              </button>
              {inboxContact.phone && (
                <button type="button" title={t("Clica para copiar o telefone")}
                  onClick={() => navigator.clipboard.writeText(`+${inboxContact.phone}`)}
                  className="flex items-center gap-1 text-sm text-foreground hover:text-primary transition-colors">
                  <span>+{inboxContact.phone}</span>
                  <Copy className="h-3 w-3 shrink-0 text-muted-foreground" />
                </button>
              )}
            </div>
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{t("clica para copiar")}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">

            {/* Activity: notes, meetings and what came with the lead. */}
            <div className="min-w-0 space-y-8">
              <div className="space-y-3">
                <h2 className={sectionTitle}>{t("Atividade")}</h2>
                <LeadActivity lead={lead} />
              </div>

              <RecordTasks phone={lead.phone} />

              {/* Lead's own notes — e.g. the address + operator captured by the
                  inbound webhook/form. Shown whenever present (or being edited). */}
              {(lead.notes || isEditingNotes) && (
                <div className="space-y-2">
                  <h2 className={sectionTitle}><FileText className="h-3.5 w-3.5" />{t("Notas da lead")}</h2>
                  <Textarea
                    ref={notesRef}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    onFocus={() => setIsEditingNotes(true)}
                    onBlur={() => { setIsEditingNotes(false); handleNotesBlur(); }}
                    placeholder={t("Notas do lead...")}
                    rows={3}
                    className="min-h-[96px] max-h-[60dvh] resize-none overflow-y-auto rounded-xl text-sm leading-relaxed"
                  />
                </div>
              )}

              {formResponses.length > 0 && (
                <div className="space-y-2">
                  <h2 className={sectionTitle}><ClipboardList className="h-3.5 w-3.5" />{t("Respostas do formulário")}</h2>
                  <dl className="divide-y rounded-xl border">
                    {formResponses.map((entry, index) => (
                      <div key={index} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-3">
                        <dt className="text-xs text-muted-foreground">{entry.label}</dt>
                        <dd className="break-words text-sm">{entry.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {utmData.length > 0 && (
                <div className="space-y-2">
                  <h2 className={sectionTitle}><Target className="h-3.5 w-3.5" />{t("Dados de campanha")}</h2>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                    {utmData.map((entry, index) => {
                      const isTechnicalTracking = TECHNICAL_TRACKING_KEYS.includes(entry.key as typeof TECHNICAL_TRACKING_KEYS[number]);
                      const displayValue = isTechnicalTracking ? shortenTrackingValue(entry.value) : entry.value;
                      return (
                        <div key={index} className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{entry.label}</dt>
                          <dd className="mt-0.5 flex min-w-0 items-start gap-1">
                            <span className="min-w-0 flex-1 break-words text-sm" title={entry.value}>{displayValue}</span>
                            {isTechnicalTracking && (
                              <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" onClick={() => copyTrackingValue(entry.value)}
                                aria-label={t("Copiar {{field}}", { field: entry.label })} title={t("Copiar {{field}}", { field: entry.label })}>
                                <Copy className="h-4 w-4" />
                              </Button>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              )}

              {isTelecom && lead.id && (
                <div className="rounded-xl border p-4">
                  <LeadAttachments leadId={lead.id} />
                </div>
              )}
            </div>

            {/* Details: everything about the lead you can read or change at a glance. */}
            <aside className="min-w-0">
              <div className="space-y-6 lg:sticky lg:top-0">
                <div>
                  <h2 className={cn(sectionTitle, "mb-1")}>{t("Detalhes")}</h2>
                  <div className="divide-y divide-border/60">
                    <DetailRow icon={Phone} label="Telefone">
                      <div className="flex items-center">
                        <Input
                          type="tel"
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          onFocus={() => setIsEditingPhone(true)}
                          onBlur={() => {
                            if (editPhone !== lead.phone) handleFieldSave("phone", editPhone);
                            setTimeout(() => setIsEditingPhone(false), 600);
                          }}
                          className={editableInput}
                          placeholder={t("Telefone")}
                        />
                        {editPhone.trim() && <CopyFieldButton value={editPhone.trim()} label="Telefone" />}
                      </div>
                    </DetailRow>
                    <DetailRow icon={Mail} label="Email">
                      <div className="flex items-center">
                        <Input
                          type="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          onFocus={() => setIsEditingEmail(true)}
                          onBlur={() => {
                            if (editEmail !== lead.email) handleFieldSave("email", editEmail);
                            setTimeout(() => setIsEditingEmail(false), 600);
                          }}
                          className={editableInput}
                          placeholder={t("Email")}
                        />
                        {editEmail.trim() && !isPlaceholderEmail(editEmail) && <CopyFieldButton value={editEmail.trim()} label="Email" />}
                      </div>
                    </DetailRow>
                    <DetailRow icon={Thermometer} label="Temperatura">
                      <Select value={lead.temperature || 'cold'} onValueChange={(value) => onUpdate?.(lead.id, { temperature: value as LeadTemperature })}>
                        <SelectTrigger className="h-8 border-transparent px-2 shadow-none hover:border-border"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(TEMPERATURE_LABELS) as LeadTemperature[]).map((temp) => (
                            <SelectItem key={temp} value={temp}>
                              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", TEMPERATURE_PILLS[temp])}>{t(TEMPERATURE_LABELS[temp])}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </DetailRow>
                    {showEnergy && (
                      <DetailRow icon={Zap} label="Tipologia">
                        <Select value={lead.tipologia || ''} onValueChange={(value) => onUpdate?.(lead.id, { tipologia: value as LeadTipologia })}>
                          <SelectTrigger className="h-8 border-transparent px-2 shadow-none hover:border-border"><SelectValue placeholder={t("Escolher")} /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(TIPOLOGIA_LABELS) as LeadTipologia[]).map((tipo) => (
                              <SelectItem key={tipo} value={tipo}>
                                <span className={TIPOLOGIA_STYLES[tipo].color}>{TIPOLOGIA_STYLES[tipo].emoji}</span> {t(TIPOLOGIA_LABELS[tipo])}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </DetailRow>
                    )}
                    {canManageTeam && teamMembers && teamMembers.length > 0 && (
                      <DetailRow icon={UserCircle} label="Responsável">
                        <Select value={lead.assigned_to || 'unassigned'} onValueChange={(value) => onUpdate?.(lead.id, { assigned_to: value === 'unassigned' ? null : value })}>
                          <SelectTrigger className="h-8 border-transparent px-2 shadow-none hover:border-border"><SelectValue placeholder={t("Não atribuído")} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned"><span className="text-muted-foreground">{t("Não atribuído")}</span></SelectItem>
                            {teamMembers
                              .filter(m => !m.is_banned && (m.role === 'salesperson' || m.role === 'admin' || m.role === 'viewer'))
                              .map((member) => (
                                <SelectItem key={member.user_id} value={member.user_id}>
                                  {member.full_name} ({ROLE_LABELS[member.role] ? t(ROLE_LABELS[member.role]) : member.role}){member.is_paused ? ` · ${t('Pausado')}` : ''}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </DetailRow>
                    )}
                    {showEnergy ? (
                      <DetailRow icon={Zap} label="Consumo anual">
                        <div className="relative">
                          <Input type="text" inputMode="numeric" placeholder="0" value={editConsumo} onChange={handleConsumoChange}
                            onFocus={() => setIsEditingConsumo(true)} onBlur={handleConsumoBlur} className={cn(editableInput, "pr-12")} />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">kWh</span>
                        </div>
                      </DetailRow>
                    ) : (
                      <DetailRow icon={Euro} label="Valor">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">€</span>
                          <Input type="text" inputMode="numeric" placeholder="0" value={editValue} onChange={handleValueChange}
                            onFocus={() => setIsEditingValue(true)} onBlur={handleValueBlur} className={cn(editableInput, "pl-6")} />
                        </div>
                      </DetailRow>
                    )}
                    {isP2G && (
                      <DetailRow icon={Zap} label="CPE / CUI">
                        <Input
                          type="text"
                          placeholder="PT00..."
                          value={editCpe}
                          onChange={(e) => setEditCpe(e.target.value)}
                          onFocus={() => setIsEditingCpe(true)}
                          onBlur={() => {
                            const currentCpe = (lead.custom_data as Record<string, unknown>)?.cpe as string || "";
                            if (editCpe !== currentCpe) {
                              onUpdate?.(lead.id, {
                                custom_data: { ...(lead.custom_data as Record<string, unknown> || {}), cpe: editCpe || null },
                              } as Partial<Lead>);
                            }
                            setTimeout(() => setIsEditingCpe(false), 600);
                          }}
                          className={editableInput}
                        />
                      </DetailRow>
                    )}
                    <DetailRow icon={ExternalLink} label="Origem"><span className="px-2">{lead.source || t('Não identificada')}</span></DetailRow>
                    <DetailRow icon={Calendar} label="Criada"><span className="px-2">{formatDateTime(lead.created_at)}</span></DetailRow>
                    <DetailRow icon={Shield} label="RGPD">
                      <span className={cn("px-2", lead.gdpr_consent ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                        {lead.gdpr_consent ? t("Consentimento obtido") : t("Sem consentimento")}
                      </span>
                    </DetailRow>
                  </div>
                </div>

                {/* Google Maps & social media - prospect data */}
                {prospectMetadata && (prospectMetadata.googleMapsUrl || prospectMetadata.website || socialMediaIcons.some(s => prospectMetadata[s.key as keyof typeof prospectMetadata])) && (
                  <div className="space-y-2">
                    <h2 className={sectionTitle}><MapPin className="h-3.5 w-3.5" />{t("Dados do prospect")}</h2>
                    {prospectMetadata.address && <p className="text-sm text-muted-foreground">{prospectMetadata.address}</p>}
                    {prospectMetadata.rating && <p className="text-sm text-muted-foreground">⭐ {t("{{n}} estrelas", { n: prospectMetadata.rating })}</p>}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      {prospectMetadata.googleMapsUrl && (
                        <a href={prospectMetadata.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                          <MapPin className="h-4 w-4" />Google Maps
                        </a>
                      )}
                      {prospectMetadata.website && (
                        <a href={prospectMetadata.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                          <Globe className="h-4 w-4" />{t("Website")}
                        </a>
                      )}
                      {socialMediaIcons.map(({ key, icon: Icon, label }) => {
                        const url = prospectMetadata[key as keyof typeof prospectMetadata] as string | null;
                        if (!url) return null;
                        return (
                          <a key={key} href={url} target="_blank" rel="noopener noreferrer" title={label} className="text-muted-foreground transition-colors hover:text-primary">
                            <Icon className="h-5 w-5" />
                          </a>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>

        <SendLeadEmailModal lead={lead} open={showEmailModal} onOpenChange={setShowEmailModal} />

        {canDeleteLeads && onDelete && (
          <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("Confirmar eliminação")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("Está prestes a eliminar permanentemente esta lead e todos os dados associados, em conformidade com o Direito ao Esquecimento do RGPD. Esta ação não pode ser revertida.")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  {t("Eliminar permanentemente")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </DialogContent>
    </Dialog>
  );
}

const sectionTitle = "flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

/** One label/value line of the details column. */
function DetailRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-2 py-1.5 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground"><Icon className="h-4 w-4 shrink-0" />{t(label)}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
