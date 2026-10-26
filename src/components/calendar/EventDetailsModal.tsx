import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useInterfaceStore } from '@/stores/useInterfaceStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useDeleteEvent, useUpdateEvent } from '@/hooks/useCalendarEvents';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { LeadStatus } from '@/types';
import {
  EVENT_TYPE_LABELS,
  EVENT_TYPE_COLORS,
  EVENT_STATUS_LABELS,
  REMINDER_OPTIONS,
  type CalendarEvent,
  type EventType,
} from '@/types/calendar';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import {
  Video,
  Phone,
  CheckSquare,
  RefreshCw,
  Calendar,
  Clock,
  Bell,
  User,
  Trash2,
  Edit,
  Check,
  X,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LeadStatusDialog } from './LeadStatusDialog';
import { useQueryClient } from '@tanstack/react-query';

// Tile gradient per event type (HSL channels), matching the Agenda chips.
const EVENT_TYPE_TILES: Record<EventType, readonly [string, string]> = {
  meeting: ['217 91% 64%', '221 83% 51%'],
  call: ['142 71% 48%', '150 75% 34%'],
  task: ['45 93% 52%', '36 92% 44%'],
  follow_up: ['271 81% 68%', '262 70% 52%'],
};

const EVENT_TYPE_ICONS: Record<EventType, React.ElementType> = {
  meeting: Video,
  call: Phone,
  task: CheckSquare,
  follow_up: RefreshCw,
};

interface EventDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalendarEvent | null;
  onEdit?: () => void;
}

export function EventDetailsModal({ open, onOpenChange, event, onEdit }: EventDetailsModalProps) {
  // Workplace opens the event in a side sheet, as Realize does; Versão antiga keeps the modal.
  const legacy = useInterfaceStore((state) => state.legacy);
  const deleteEvent = useDeleteEvent();
  const updateEvent = useUpdateEvent();
  const queryClient = useQueryClient();

  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [actionType, setActionType] = useState<'delete' | 'cancel'>('delete');
  const [isUpdatingLead, setIsUpdatingLead] = useState(false);

  if (!event) return null;

  const Icon = EVENT_TYPE_ICONS[event.event_type];
  const colorClass = EVENT_TYPE_COLORS[event.event_type];

  const handleDeleteClick = () => {
    if (event.lead_id) {
      setActionType('delete');
      setShowStatusDialog(true);
    } else {
      handleDelete();
    }
  };

  const handleCancelClick = () => {
    if (event.lead_id) {
      setActionType('cancel');
      setShowStatusDialog(true);
    } else {
      handleCancel();
    }
  };

  const handleDelete = async () => {
    await deleteEvent.mutateAsync(event.id);
    onOpenChange(false);
  };

  const handleCancel = async () => {
    await updateEvent.mutateAsync({
      id: event.id,
      status: 'cancelled',
    });
  };

  const handleStatusConfirm = async (newStatus: LeadStatus) => {
    setIsUpdatingLead(true);
    try {
      // Update lead status
      if (event.lead_id) {
        const { error: leadError } = await supabase
          .from('leads')
          .update({ status: newStatus })
          .eq('id', event.lead_id);

        if (leadError) {
          console.error('Error updating lead status:', leadError);
          toast.error('Erro ao atualizar status do lead');
          setIsUpdatingLead(false);
          return;
        }
      }

      // Perform the action
      if (actionType === 'delete') {
        await deleteEvent.mutateAsync(event.id);
      } else {
        await updateEvent.mutateAsync({
          id: event.id,
          status: 'cancelled',
        });
      }

      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setShowStatusDialog(false);
      onOpenChange(false);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setIsUpdatingLead(false);
    }
  };

  const handleMarkComplete = async () => {
    await updateEvent.mutateAsync({
      id: event.id,
      status: event.status === 'completed' ? 'pending' : 'completed',
    });
  };

  const reminderLabel = REMINDER_OPTIONS.find((opt) => opt.value === event.reminder_minutes)?.label || 'Sem lembrete';

  const statusClass = cn(
    event.status === 'completed' && 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    event.status === 'pending' && 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    event.status === 'cancelled' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
  );
  const statusDialog = (
    <LeadStatusDialog
      open={showStatusDialog}
      onOpenChange={setShowStatusDialog}
      onConfirm={handleStatusConfirm}
      isLoading={isUpdatingLead || deleteEvent.isPending || updateEvent.isPending}
      leadName={event.lead?.name}
      actionType={actionType}
    />
  );

  if (!legacy) {
    const tile = EVENT_TYPE_TILES[event.event_type];
    const row = (RowIcon: React.ElementType, content: React.ReactNode) => (
      <p className="flex items-start gap-3 text-[14px]"><RowIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0">{content}</span></p>
    );
    const pill = 'inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
    return (
      <>
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="right" className="top-[calc(3.5rem+env(safe-area-inset-top,0px))] h-[calc(100dvh-3.5rem-env(safe-area-inset-top,0px))] w-full overflow-y-auto border-0 p-0 sm:max-w-md lg:top-0 lg:h-full">
            <div className="space-y-5 p-6">
              <div className="flex items-start gap-3 pr-6">
                <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white"
                  style={{ background: `linear-gradient(145deg, hsl(${tile[0]}), hsl(${tile[1]}))`, boxShadow: `inset 0 1px 0 hsl(0 0% 100% / .22), 0 6px 14px -6px hsl(${tile[1]} / .6)` }}>
                  <Icon className="h-6 w-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="break-words text-[22px] font-extrabold leading-tight">{event.title}</SheetTitle>
                  <SheetDescription className="sr-only">Detalhes do evento</SheetDescription>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="rounded-full">{EVENT_TYPE_LABELS[event.event_type]}</Badge>
                    <Badge className={cn('rounded-full', statusClass)}>{EVENT_STATUS_LABELS[event.status]}</Badge>
                  </div>
                </div>
              </div>
              <div className="space-y-2.5">
                {row(Calendar, <span className="first-letter:uppercase">{format(new Date(event.start_time), "EEEE, d 'de' MMMM 'de' yyyy", { locale: pt })}</span>)}
                {row(Clock, event.all_day ? 'Dia todo' : `${format(new Date(event.start_time), 'HH:mm', { locale: pt })}${event.end_time ? ` – ${format(new Date(event.end_time), 'HH:mm', { locale: pt })}` : ''}`)}
                {row(Bell, reminderLabel)}
                {row(User, <>Comercial: <span className="font-semibold">{event.user?.full_name || 'Comercial não identificado'}</span></>)}
                {event.lead && row(User, <>Lead: <span className="font-semibold">{event.lead.name}</span></>)}
              </div>
              {event.description && <p className="whitespace-pre-wrap rounded-2xl bg-muted/60 p-4 text-[14px]">{event.description}</p>}
              <div className="flex flex-wrap gap-2 border-t pt-4">
                <button type="button" className={cn(pill, 'bg-muted hover:bg-muted/70')} onClick={handleMarkComplete} disabled={updateEvent.isPending}>
                  {updateEvent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : event.status === 'completed' ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  {event.status === 'completed' ? 'Reabrir' : 'Concluir'}
                </button>
                {event.status !== 'cancelled' && (
                  <button type="button" className={cn(pill, 'bg-muted hover:bg-muted/70')} onClick={handleCancelClick} disabled={updateEvent.isPending}>
                    <X className="h-4 w-4" /> Cancelar
                  </button>
                )}
                <button type="button" className={cn(pill, 'bg-muted hover:bg-muted/70')} onClick={onEdit}>
                  <Edit className="h-4 w-4" /> Editar
                </button>
                <button type="button" className={cn(pill, 'ml-auto text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10')} onClick={handleDeleteClick} disabled={deleteEvent.isPending}>
                  {deleteEvent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Eliminar
                </button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
        {statusDialog}
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className={cn('p-2 rounded-lg text-white', colorClass)}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <DialogTitle className="text-lg">{event.title}</DialogTitle>
                <Badge variant="secondary" className="mt-1">
                  {EVENT_TYPE_LABELS[event.event_type]}
                </Badge>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Status */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Estado</span>
              <Badge className={statusClass}>
                {EVENT_STATUS_LABELS[event.status]}
              </Badge>
            </div>

            {/* Date & Time */}
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                {format(new Date(event.start_time), "EEEE, d 'de' MMMM 'de' yyyy", { locale: pt })}
              </span>
            </div>

            {!event.all_day && (
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {format(new Date(event.start_time), 'HH:mm', { locale: pt })}
                  {event.end_time && ` - ${format(new Date(event.end_time), 'HH:mm', { locale: pt })}`}
                </span>
              </div>
            )}

            {/* Reminder */}
            <div className="flex items-center gap-3">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{reminderLabel}</span>
            </div>

            <div className="flex items-center gap-3">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Comercial: {event.user?.full_name || 'Comercial não identificado'}</span>
            </div>

            {/* Lead */}
            {event.lead && (
              <div className="flex items-center gap-3">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Lead: {event.lead.name}</span>
              </div>
            )}

            {/* Description */}
            {event.description && (
              <div className="pt-2 border-t">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{event.description}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-4 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkComplete}
              disabled={updateEvent.isPending}
            >
              {updateEvent.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : event.status === 'completed' ? (
                <X className="h-4 w-4 mr-1" />
              ) : (
                <Check className="h-4 w-4 mr-1" />
              )}
              {event.status === 'completed' ? 'Reabrir' : 'Concluir'}
            </Button>

            {event.status !== 'cancelled' && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelClick}
                disabled={updateEvent.isPending}
              >
                <X className="h-4 w-4 mr-1" />
                Cancelar
              </Button>
            )}

            <Button variant="outline" size="sm" onClick={onEdit}>
              <Edit className="h-4 w-4 mr-1" />
              Editar
            </Button>

            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteClick}
              disabled={deleteEvent.isPending}
            >
              {deleteEvent.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              <Trash2 className="h-4 w-4 mr-1" />
              Eliminar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {statusDialog}
    </>
  );
}
