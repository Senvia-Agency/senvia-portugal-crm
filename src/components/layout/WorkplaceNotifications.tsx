import { useState } from 'react';
import { Bell, ChevronRight, Inbox } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { InboxUnreadBadge } from './InboxUnreadBadge';

export function WorkplaceNotifications() {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" className="workplace-header-icon relative" aria-label="Abrir notificações">
        <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
        <span className="absolute -right-1 -top-1"><InboxUnreadBadge /></span>
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
      <div className="border-b p-4"><h2 className="text-sm font-semibold">Notificações</h2><p className="mt-1 text-xs text-muted-foreground">Mensagens da organização atual</p></div>
      <Link to="/inbox" onClick={() => setOpen(false)} className="flex items-center gap-3 p-4 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <Inbox className="h-5 w-5 text-primary" aria-hidden="true" />
        <span className="flex-1"><span className="block font-medium">Caixa de entrada</span><span className="block text-xs text-muted-foreground">Consultar emails e conversas por ler</span></span>
        <InboxUnreadBadge /><ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </PopoverContent>
  </Popover>;
}
