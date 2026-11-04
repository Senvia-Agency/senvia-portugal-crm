import { useState } from "react";
import { Lead, LeadTemperature, TEMPERATURE_LABELS, TEMPERATURE_STYLES, TIPOLOGIA_LABELS, TIPOLOGIA_STYLES } from "@/types";
import { formatRelativeTime, getInboxUrl, formatCurrency } from "@/lib/format";
import { useNavigate } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/hooks/useModules";
import { Button } from "@/components/ui/button";
import { MessageCircle, Phone, Mail, MoreHorizontal, CalendarClock, Archive, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PipelineStage } from "@/hooks/usePipelineStages";
import { SendLeadEmailModal } from "./SendLeadEmailModal";
import { isPlaceholderEmail } from "@/lib/leadUtils";
import { EmailTemplateGate } from "@/components/marketing/EmailTemplateGate";
import { EMAIL_TEMPLATE_TRIGGERS } from "@/lib/email-template-triggers";
import { initialsOf, TEMPERATURE_PILLS } from "./lead-display";
import { intlLocale, tr, useLanguage } from "@/i18n";

interface UpcomingEvent {
  id: string;
  title: string;
  start_time: string;
  event_type: string;
}

interface LeadCardProps {
  lead: Lead;
  proposalValue?: number;
  upcomingEvent?: UpcomingEvent | null;
  /** Who the lead is assigned to, shown as initials. */
  assigneeName?: string | null;
  onStatusChange?: (leadId: string, newStatus: string) => void;
  onTemperatureChange?: (leadId: string, temperature: LeadTemperature) => void;
  onViewDetails?: (lead: Lead) => void;
  onDelete?: (leadId: string) => void;
  onArchive?: (leadId: string) => void;
  isDragging?: boolean;
  pipelineStages?: PipelineStage[];
  isLocked?: boolean;
}

function formatEventTime(dateStr: string) {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const time = date.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return tr("Hoje às {{time}}", { time });
  if (date.toDateString() === yesterday.toDateString()) return tr("Ontem às {{time}}", { time });
  if (date.toDateString() === tomorrow.toDateString()) return tr("Amanhã às {{time}}", { time });
  return tr("{{date}} às {{time}}", { date: date.toLocaleDateString(intlLocale(), { day: '2-digit', month: 'short' }), time });
}

const actionClass = "h-7 w-7 rounded-full text-muted-foreground hover:text-foreground";

export function LeadCard({
  lead,
  proposalValue,
  upcomingEvent,
  assigneeName,
  onStatusChange,
  onTemperatureChange,
  onViewDetails,
  onDelete,
  onArchive,
  isDragging,
  pipelineStages = [],
  isLocked = false,
}: LeadCardProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { canDeleteLeads } = usePermissions();
  const { organization } = useAuth();
  const [showEmailModal, setShowEmailModal] = useState(false);
  const isTelecom = organization?.niche === 'telecom';
  const { modules } = useModules();
  const showEnergy = isTelecom && modules.energy;

  const temperature = lead.temperature || 'cold';
  const title = isTelecom ? (lead.company_name || lead.name) : lead.name;
  const secondName = isTelecom
    ? (lead.name && lead.name !== lead.company_name ? lead.name : null)
    : lead.company_name || null;
  const meta = [secondName, lead.source, formatRelativeTime(lead.created_at)].filter(Boolean).join(' · ');
  const eventPast = upcomingEvent ? new Date(upcomingEvent.start_time) < new Date() : false;
  const amount = showEnergy
    ? (lead.consumo_anual ? `${new Intl.NumberFormat(intlLocale()).format(lead.consumo_anual)} kWh` : null)
    : (proposalValue || lead.value ? formatCurrency(proposalValue || lead.value || 0) : null);
  const emailBlocked = !lead.email || isPlaceholderEmail(lead.email);

  return (
    <div
      className={cn(
        "group cursor-pointer rounded-xl border border-border/70 bg-card px-3 py-2.5 shadow-sm transition-all duration-150",
        "hover:border-border hover:shadow-md",
        isDragging && "rotate-1 scale-[1.02] shadow-lg"
      )}
      onClick={() => onViewDetails?.(lead)}
    >
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold leading-snug text-card-foreground">{title}</h4>
          <p className="truncate text-xs text-muted-foreground">{meta}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <button type="button" title={t("Mudar temperatura")}
              className={cn("mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 transition-opacity hover:opacity-80", TEMPERATURE_PILLS[temperature])}>
              {t(TEMPERATURE_LABELS[temperature])}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            {(Object.keys(TEMPERATURE_LABELS) as LeadTemperature[]).map((temp) => (
              <DropdownMenuItem
                key={temp}
                onClick={(e) => { e.stopPropagation(); onTemperatureChange?.(lead.id, temp); }}
                disabled={temperature === temp}
              >
                <span className="mr-2">{TEMPERATURE_STYLES[temp].emoji}</span>
                {t(TEMPERATURE_LABELS[temp])}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {(amount || (showEnergy && lead.tipologia && TIPOLOGIA_STYLES[lead.tipologia])) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {amount && (
            <span className="text-sm font-semibold tabular-nums text-primary">
              {amount}
              {!showEnergy && proposalValue ? <span className="ml-1 text-[11px] font-normal text-muted-foreground">{t("propostas")}</span> : null}
            </span>
          )}
          {showEnergy && lead.tipologia && TIPOLOGIA_STYLES[lead.tipologia] && (
            <span className={cn("rounded-full border px-1.5 text-[11px] leading-4", TIPOLOGIA_STYLES[lead.tipologia].color, TIPOLOGIA_STYLES[lead.tipologia].bgClass)}>
              {TIPOLOGIA_STYLES[lead.tipologia].emoji} {TIPOLOGIA_LABELS[lead.tipologia] ? t(TIPOLOGIA_LABELS[lead.tipologia]) : lead.tipologia}
            </span>
          )}
        </div>
      )}

      {upcomingEvent && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className={cn("mt-1.5 flex items-center gap-1 text-xs", eventPast ? "font-medium text-red-600 dark:text-red-400" : "text-primary")}>
                <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{formatEventTime(upcomingEvent.start_time)}{eventPast && ` · ${t("passou")}`}</span>
              </p>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">{upcomingEvent.title}</p>
              <p className="text-xs text-muted-foreground">{formatEventTime(upcomingEvent.start_time)}{eventPast && ` - ${t("Evento passado")}`}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      <div className="mt-1.5 flex items-center gap-0.5">
        <Button variant="ghost" size="icon" className={cn(actionClass, "text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400")}
          aria-label="WhatsApp" title="WhatsApp" onClick={(e) => { e.stopPropagation(); navigate(getInboxUrl(lead.phone)); }}>
          <MessageCircle className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className={actionClass} aria-label={t("Ligar")} title={t("Ligar")}
          onClick={(e) => { e.stopPropagation(); window.location.href = `tel:${lead.phone}`; }}>
          <Phone className="h-4 w-4" />
        </Button>
        <EmailTemplateGate triggerType={EMAIL_TEMPLATE_TRIGGERS.lead} noticePosition="inline">
          <Button variant="ghost" size="icon" className={actionClass} aria-label={t("Enviar email")} title={emailBlocked ? t("Sem email") : t("Enviar email")}
            disabled={emailBlocked} onClick={(e) => { e.stopPropagation(); setShowEmailModal(true); }}>
            <Mail className="h-4 w-4" />
          </Button>
        </EmailTemplateGate>
        <div className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className={cn(actionClass, "opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100")} aria-label={t("Mais ações")}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onViewDetails?.(lead); }}>{t("Ver ficha")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            {!isLocked && pipelineStages.map((stage) => (
              <DropdownMenuItem
                key={stage.key}
                onClick={(e) => { e.stopPropagation(); onStatusChange?.(lead.id, stage.key); }}
                disabled={lead.status === stage.key}
              >
                <span className="mr-2 h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} />
                {t("Mover para {{stage}}", { stage: stage.name })}
              </DropdownMenuItem>
            ))}
            {isLocked && (
              <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                <Lock className="mr-2 h-3.5 w-3.5" />{t("Estado bloqueado (apenas admin)")}
              </DropdownMenuItem>
            )}
            {onArchive && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onArchive(lead.id); }}>
                  <Archive className="mr-2 h-4 w-4" />
                  {t("Arquivar")}
                </DropdownMenuItem>
              </>
            )}
            {canDeleteLeads && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={(e) => { e.stopPropagation(); onDelete?.(lead.id); }}
                >
                  {t("Eliminar lead")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {assigneeName && (
          <span title={t("Responsável: {{name}}", { name: assigneeName })}
            className="ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
            {initialsOf(assigneeName)}
          </span>
        )}
      </div>

      {showEmailModal && (
        <SendLeadEmailModal
          lead={lead}
          open={showEmailModal}
          onOpenChange={setShowEmailModal}
        />
      )}
    </div>
  );
}
