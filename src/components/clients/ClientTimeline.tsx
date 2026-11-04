import { 
  FileText, 
  ShoppingCart, 
  Calendar, 
  MessageSquare,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Mail,
  StickyNote,
} from 'lucide-react';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ClientHistoryEvent, HistoryEventType } from '@/hooks/useClientHistory';
import { useLanguage, tr } from "@/i18n";

interface ClientTimelineProps {
  events: ClientHistoryEvent[];
  isLoading?: boolean;
}

const EVENT_CONFIG: Record<HistoryEventType, { icon: typeof FileText; color: string; bgColor: string }> = {
  proposal: {
    icon: FileText,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
  },
  sale: {
    icon: ShoppingCart,
    color: 'text-success',
    bgColor: 'bg-success/10',
  },
  meeting: {
    icon: Calendar,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
  },
  note: {
    icon: StickyNote,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
  },
  call: {
    icon: Phone,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
  },
  whatsapp: {
    icon: MessageSquare,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
  },
  email: {
    icon: Mail,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
  },
};

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'bg-muted', text: 'text-muted-foreground' },
  sent: { bg: 'bg-blue-500/10', text: 'text-blue-500' },
  approved: { bg: 'bg-success/10', text: 'text-success' },
  accepted: { bg: 'bg-success/10', text: 'text-success' },
  rejected: { bg: 'bg-destructive/10', text: 'text-destructive' },
  pending: { bg: 'bg-warning/10', text: 'text-warning' },
  in_progress: { bg: 'bg-blue-500/10', text: 'text-blue-500' },
  negotiating: { bg: 'bg-warning/10', text: 'text-warning' },
  completed: { bg: 'bg-success/10', text: 'text-success' },
  delivered: { bg: 'bg-success/10', text: 'text-success' },
  scheduled: { bg: 'bg-blue-500/10', text: 'text-blue-500' },
  cancelled: { bg: 'bg-destructive/10', text: 'text-destructive' },
  expired: { bg: 'bg-muted', text: 'text-muted-foreground' },
};

const STATUS_LABELS: Record<string, string> = {
  // Proposals
  draft: 'Rascunho',
  sent: 'Enviada',
  negotiating: 'Em Negociação',
  accepted: 'Aceite',
  rejected: 'Recusada',
  expired: 'Expirada',
  // Sales
  pending: 'Pendente',
  in_progress: 'Em Progresso',
  delivered: 'Entregue',
  cancelled: 'Cancelada',
  completed: 'Concluída',
  // Meetings/Events
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
};

function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] ? tr(STATUS_LABELS[status]) : status;
}

function getCallIcon(direction?: 'inbound' | 'outbound' | null) {
  if (direction === 'inbound') return PhoneIncoming;
  if (direction === 'outbound') return PhoneOutgoing;
  return Phone;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  if (secs === 0) return `${mins}min`;
  return `${mins}min ${secs}s`;
}

function TimelineItem({ event }: { event: ClientHistoryEvent }) {
  const { t } = useLanguage();
  const config = EVENT_CONFIG[event.type];
  
  // For calls, use direction-specific icon
  const Icon = event.type === 'call' ? getCallIcon(event.direction) : config.icon;
  
  const statusStyle = event.status ? STATUS_STYLES[event.status] || STATUS_STYLES.pending : null;

  return (
    <div className="flex gap-3 pb-6 last:pb-0">
      {/* Icon */}
      <div className="flex flex-col items-center">
        <div className={cn('p-2 rounded-full', config.bgColor)}>
          <Icon className={cn('h-4 w-4', config.color)} />
        </div>
        <div className="flex-1 w-px bg-border mt-2" />
      </div>

      {/* Content */}
      <div className="flex-1 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{event.title}</p>
            {event.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {event.description}
              </p>
            )}
            {/* Duration for calls */}
            {event.duration_seconds && event.duration_seconds > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("Duração:")} {formatDuration(event.duration_seconds)}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {event.value !== undefined && event.value > 0 && (
              <span className="text-sm font-semibold text-success">
                {formatCurrency(event.value)}
              </span>
            )}
            {statusStyle && event.status && (
              <Badge variant="outline" className={cn('text-xs', statusStyle.bg, statusStyle.text)}>
                {getStatusLabel(event.status)}
              </Badge>
            )}
            {/* Direction badge for communications */}
            {event.direction && (
              <Badge variant="outline" className="text-xs">
                {event.direction === 'inbound' ? t("Recebida") : t("Enviada")}
              </Badge>
            )}
          </div>
        </div>
        <time className="text-xs text-muted-foreground mt-1 block">
          {formatDateTime(event.date)}
        </time>
      </div>
    </div>
  );
}

export function ClientTimeline({ events, isLoading }: ClientTimelineProps) {
  const { t } = useLanguage();
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="w-8 h-8 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/3 bg-muted rounded" />
              <div className="h-3 w-1/2 bg-muted rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p>{t("Sem histórico registado")}</p>
        <p className="text-sm mt-1">{t("Propostas, vendas, reuniões e comunicações aparecerão aqui")}</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {events.map((event) => (
        <TimelineItem key={`${event.type}-${event.id}`} event={event} />
      ))}
    </div>
  );
}
