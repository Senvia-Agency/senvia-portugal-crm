import { useState } from 'react';
import { AtSign, Bell, ChevronRight, Inbox, PartyPopper } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { InboxUnreadBadge } from './InboxUnreadBadge';
import { WEBMAIL_ENABLED } from './workspaceNavigation';
import { useInterfaceStore } from '@/stores/useInterfaceStore';
import { useLanguage } from '@/i18n';
import { useClosedSales } from '@/hooks/useClosedSales';
import { formatCurrency, formatRelativeTime } from '@/lib/format';

export function WorkplaceNotifications() {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();
  const closed = useClosedSales();
  // With the WebMail, email is its own page: the bell lists it on its own line and counts it too.
  const legacy = useInterfaceStore(state => state.legacy);
  const separateEmail = WEBMAIL_ENABLED && !legacy;
  return <Popover open={open} onOpenChange={(value) => { setOpen(value); if (!value) closed.markSeen(); }}>
    <PopoverTrigger asChild>
      <button type="button" data-otto-target="guide-notifications" className="workplace-header-icon relative" aria-label={t("Abrir notificações")}>
        <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
        <span className="absolute -right-1 -top-1"><InboxUnreadBadge part="all" /></span>
        {closed.unseen > 0 && <span className="absolute -bottom-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold leading-none text-white">{closed.unseen}</span>}
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
      <div className="border-b p-4"><h2 className="text-sm font-semibold">{t("Notificações")}</h2><p className="mt-1 text-xs text-muted-foreground">{t("Mensagens da organização atual")}</p></div>
      <Link to="/inbox" onClick={() => setOpen(false)} className="flex items-center gap-3 p-4 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <Inbox className="h-5 w-5 text-primary" aria-hidden="true" />
        <span className="flex-1"><span className="block font-medium">{t("Caixa de entrada")}</span><span className="block text-xs text-muted-foreground">{t(separateEmail ? "Consultar conversas por ler" : "Consultar emails e conversas por ler")}</span></span>
        <InboxUnreadBadge part={separateEmail ? "meta" : "all"} /><ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
      {separateEmail && (
        <Link to="/webmail" onClick={() => setOpen(false)} className="flex items-center gap-3 p-4 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <AtSign className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="flex-1"><span className="block font-medium">{t("Email")}</span><span className="block text-xs text-muted-foreground">{t("Consultar emails por ler")}</span></span>
          <InboxUnreadBadge part="email" /><ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
      {closed.enabled && closed.list.length > 0 && (
        <div className="border-t">
          <h3 className="flex items-center gap-2 px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <PartyPopper className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />{t("Vendas fechadas")}
          </h3>
          <ul className="max-h-72 overflow-y-auto pb-2">
            {closed.list.map(sale => (
              <li key={sale.id}>
                <Link to="/sales" onClick={() => setOpen(false)} className="flex items-start gap-3 px-4 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{sale.seller ? t("{{seller}} fechou: {{client}}", { seller: sale.seller.split(" ")[0], client: sale.client ?? t("Cliente") }) : (sale.client ?? t("Cliente"))}</span>
                    <span className="block text-xs text-muted-foreground">{formatCurrency(sale.total_value ?? 0)} · {formatRelativeTime(sale.closedAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PopoverContent>
  </Popover>;
}
