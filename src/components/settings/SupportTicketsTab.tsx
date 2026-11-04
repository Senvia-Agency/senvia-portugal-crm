import { useSupportTickets } from '@/hooks/useSupportTickets';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, LifeBuoy, Ticket } from 'lucide-react';
import { format } from 'date-fns';
import { dateLocale, useLanguage } from '@/i18n';

const priorityMap: Record<string, { label: string; className: string }> = {
  low: { label: 'Baixa', className: 'bg-muted text-muted-foreground' },
  medium: { label: 'Média', className: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400' },
  high: { label: 'Alta', className: 'bg-destructive/20 text-destructive' },
};

const statusMap: Record<string, { label: string; className: string }> = {
  open: { label: 'Aberto', className: 'bg-blue-500/20 text-blue-700 dark:text-blue-400' },
  in_progress: { label: 'Em progresso', className: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400' },
  resolved: { label: 'Resolvido', className: 'bg-green-500/20 text-green-700 dark:text-green-400' },
  closed: { label: 'Fechado', className: 'bg-muted text-muted-foreground' },
};

export function SupportTicketsTab() {
  const { tickets, isLoading } = useSupportTickets();
  const { t } = useLanguage();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <LifeBuoy className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <h3 className="text-lg font-semibold text-foreground">{t('Nenhum ticket de suporte')}</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          {t('Quando precisar de ajuda, abra o Otto e peça para criar um ticket de suporte.')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tickets.map(ticket => {
        const priority = priorityMap[ticket.priority] || priorityMap.medium;
        const status = statusMap[ticket.status] || statusMap.open;

        return (
          <Collapsible key={ticket.id}>
            <CollapsibleTrigger className="w-full">
              <div className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors text-left w-full">
                <Ticket className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-muted-foreground">
                      {ticket.ticket_code || '—'}
                    </span>
                    <Badge variant="outline" className={priority.className}>
                      {t(priority.label)}
                    </Badge>
                    <Badge variant="outline" className={status.className}>
                      {t(status.label, { context: 'ticket' })}
                    </Badge>
                  </div>
                  <p className="font-medium text-foreground truncate mt-1">{ticket.subject}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {format(new Date(ticket.created_at), t("d 'de' MMMM 'de' yyyy, HH:mm"), { locale: dateLocale() })}
                  </p>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 transition-transform [[data-state=open]_&]:rotate-180" />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-4 pt-2 ml-8 border-l-2 border-border">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{ticket.description}</p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
