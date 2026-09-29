import { useState } from "react";
import { Lead, LeadTemperature, LeadTipologia, TEMPERATURE_LABELS, TEMPERATURE_STYLES, TIPOLOGIA_LABELS, TIPOLOGIA_STYLES } from "@/types";
import { formatRelativeTime, getInboxUrl, formatCurrency } from "@/lib/format";
import { useNavigate } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/hooks/useModules";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Phone, Mail, MoreVertical, GripVertical, Thermometer, CalendarClock, Zap, Archive } from "lucide-react";
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
  onStatusChange?: (leadId: string, newStatus: string) => void;
  onTemperatureChange?: (leadId: string, temperature: LeadTemperature) => void;
  onViewDetails?: (lead: Lead) => void;
  onDelete?: (leadId: string) => void;
  onArchive?: (leadId: string) => void;
  isDragging?: boolean;
  pipelineStages?: PipelineStage[];
  isLocked?: boolean;
}

export function LeadCard({ 
  lead, 
  proposalValue,
  upcomingEvent,
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
  const { canDeleteLeads } = usePermissions();
  const { organization } = useAuth();
  const [showEmailModal, setShowEmailModal] = useState(false);
  const isTelecom = organization?.niche === 'telecom';
  const { modules } = useModules();
  const showEnergy = isTelecom && modules.energy;
  
  const temperature = lead.temperature || 'cold';
  const tempStyle = TEMPERATURE_STYLES[temperature];
  
  const formatEventTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const isToday = date.toDateString() === today.toDateString();
    const isYesterday = date.toDateString() === yesterday.toDateString();
    const isTomorrow = date.toDateString() === tomorrow.toDateString();

    const time = date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    
    if (isToday) return `Hoje às ${time}`;
    if (isYesterday) return `Ontem às ${time}`;
    if (isTomorrow) return `Amanhã às ${time}`;
    return date.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' }) + ` às ${time}`;
  };

  const isEventPast = (dateStr: string) => {
    return new Date(dateStr) < new Date();
  };
  
  return (
    <div 
      className={cn(
        "group rounded-lg border bg-card p-4 shadow-card transition-all duration-200",
        "hover:shadow-card-hover cursor-pointer",
        isDragging && "rotate-2 scale-105 shadow-lg"
      )}
      onClick={() => onViewDetails?.(lead)}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
          {/* Temperature Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button 
                variant="ghost" 
                size="sm" 
                className={cn("h-7 px-2 gap-1.5", tempStyle.color)}
              >
                <Thermometer className="h-4 w-4" />
                <span className="text-xs font-medium">{TEMPERATURE_LABELS[temperature]}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-32">
              {(Object.keys(TEMPERATURE_LABELS) as LeadTemperature[]).map((temp) => (
                <DropdownMenuItem 
                  key={temp}
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    onTemperatureChange?.(lead.id, temp); 
                  }}
                  disabled={temperature === temp}
                >
                  <span className="mr-2">{TEMPERATURE_STYLES[temp].emoji}</span>
                  {TEMPERATURE_LABELS[temp]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon-sm" className="opacity-0 transition-opacity group-hover:opacity-100">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onViewDetails?.(lead); }}>
              Ver detalhes
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {!isLocked && pipelineStages.map((stage) => (
              <DropdownMenuItem 
                key={stage.key}
                onClick={(e) => { 
                  e.stopPropagation(); 
                  onStatusChange?.(lead.id, stage.key); 
                }}
                disabled={lead.status === stage.key}
              >
                <span 
                  className="w-2 h-2 rounded-full mr-2"
                  style={{ backgroundColor: stage.color }}
                />
                Mover para {stage.name}
              </DropdownMenuItem>
            ))}
            {isLocked && (
              <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                🔒 Estado bloqueado (apenas admin)
              </DropdownMenuItem>
            )}
            {onArchive && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onArchive(lead.id); }}>
                  <Archive className="h-4 w-4 mr-2" />
                  Arquivar
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
                  Eliminar lead
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Upcoming Event Badge */}
      {upcomingEvent && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge 
                variant="secondary" 
                className={cn(
                  "mt-3 w-full justify-start gap-1.5",
                  isEventPast(upcomingEvent.start_time)
                    ? "bg-muted text-muted-foreground"
                    : "bg-primary/10 text-primary hover:bg-primary/20"
                )}
              >
                <CalendarClock className="h-3.5 w-3.5" />
                <span className="truncate text-xs">
                  {formatEventTime(upcomingEvent.start_time)}
                  {isEventPast(upcomingEvent.start_time) && " (passou)"}
                </span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">{upcomingEvent.title}</p>
              <p className="text-xs text-muted-foreground">
                {formatEventTime(upcomingEvent.start_time)}
                {isEventPast(upcomingEvent.start_time) && " - Evento passado"}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Content */}
      <div className="mt-3">
        <h4 className="font-semibold text-card-foreground">
          {isTelecom ? (lead.company_name || lead.name) : lead.name}
        </h4>
        {isTelecom ? (
          lead.name && lead.name !== lead.company_name && (
            <p className="text-xs text-muted-foreground">{lead.name}</p>
          )
        ) : (
          lead.company_name && (
            <p className="text-xs text-muted-foreground">{lead.company_name}</p>
          )
        )}
        
        {/* Tipologia badge for Telecom */}
        {showEnergy && lead.tipologia && TIPOLOGIA_STYLES[lead.tipologia] && (
          <Badge
            variant="outline"
            className={cn("mt-2 gap-1", TIPOLOGIA_STYLES[lead.tipologia].color, TIPOLOGIA_STYLES[lead.tipologia].bgClass)}
          >
            <span>{TIPOLOGIA_STYLES[lead.tipologia].emoji}</span>
            {TIPOLOGIA_LABELS[lead.tipologia] || lead.tipologia}
          </Badge>
        )}
        
        {/* Conditional: Show consumo_anual for Telecom, value for others */}
        {showEnergy ? (
          lead.consumo_anual ? (
            <p className="mt-1 text-lg font-bold text-primary">
              {new Intl.NumberFormat('pt-PT').format(lead.consumo_anual)} kWh
            </p>
          ) : null
        ) : (
          (proposalValue || lead.value) ? (
            <p className="mt-1 text-lg font-bold text-primary">
              {formatCurrency(proposalValue || lead.value || 0)}
              {proposalValue ? (
                <span className="text-xs font-normal text-muted-foreground ml-1">(propostas)</span>
              ) : null}
            </p>
          ) : null
        )}
        
        <div className="mt-2 flex items-center gap-2">
          {lead.source && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 font-normal">
              {lead.source}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(lead.created_at)}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2">
        <Button
          variant="whatsapp"
          size="sm"
          className="flex-1"
          onClick={(e) => {
            e.stopPropagation();
            navigate(getInboxUrl(lead.phone));
          }}
        >
          <MessageCircle className="h-4 w-4" />
          WhatsApp
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={(e) => {
            e.stopPropagation();
            window.location.href = `tel:${lead.phone}`;
          }}
        >
          <Phone className="h-4 w-4" />
        </Button>
        <EmailTemplateGate triggerType={EMAIL_TEMPLATE_TRIGGERS.lead} noticePosition="inline">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={!lead.email || isPlaceholderEmail(lead.email)}
            onClick={(e) => {
              e.stopPropagation();
              setShowEmailModal(true);
            }}
          >
            <Mail className="h-4 w-4" />
          </Button>
        </EmailTemplateGate>
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
