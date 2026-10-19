import { useState } from 'react';
import { ArrowLeft, ExternalLink, Mailbox, Minimize2, MoreHorizontal, PanelRight, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useInboxWorkspace } from './InboxWorkspaceContext';

export function InboxWorkspaceToolbar({ onOpenCaixas, channelLabel }: {
  readonly onOpenCaixas?: () => void;
  readonly channelLabel?: string;
}) {
  const workspace = useInboxWorkspace();
  const [optionsOpen, setOptionsOpen] = useState(false);
  if (!workspace) return null;
  const run = (action: () => void) => { setOptionsOpen(false); action(); };
  return <header data-inbox-toolbar className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3">
    {onOpenCaixas && <Button variant="outline" size="sm" className={cn('h-10 shrink-0', !workspace.compact && 'lg:hidden')} onClick={onOpenCaixas}>
      <Mailbox className="mr-1.5 h-4 w-4" /> Caixas
    </Button>}
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium" title={channelLabel}>{channelLabel ?? 'Inbox'}</p>
      <p className="truncate text-xs text-muted-foreground">{workspace.popup ? 'Mantém o Senvia original aberto' : workspace.enabled && workspace.pinned && workspace.whatsappSelected ? 'Inbox mantido aberto' : 'Inbox'}</p>
    </div>
    {workspace.enabled && workspace.whatsappSelected && <Button variant="outline" size="icon" className="shrink-0" title="Minimizar Inbox" aria-label="Minimizar Inbox" onClick={workspace.minimize}><Minimize2 className="h-4 w-4" /></Button>}
    <Popover open={optionsOpen} onOpenChange={setOptionsOpen}>
      <PopoverTrigger asChild><Button variant="outline" size="icon" className="shrink-0" title="Opções do Inbox" aria-label="Opções do Inbox"><MoreHorizontal className="h-4 w-4" /></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        {workspace.enabled && workspace.whatsappSelected && <>
          {!workspace.pinned && <Button variant="ghost" className="w-full justify-start" onClick={() => run(workspace.pin)}><PanelRight className="mr-2 h-4 w-4" />Manter aberto</Button>}
          {workspace.compact && <Button variant="ghost" className="w-full justify-start" onClick={() => run(workspace.returnToInbox)}><ArrowLeft className="mr-2 h-4 w-4" />Voltar ao Inbox</Button>}
          <Button variant="ghost" className="w-full justify-start" onClick={() => run(workspace.openWindow)}><ExternalLink className="mr-2 h-4 w-4" />Abrir Inbox noutra janela</Button>
        </>}
        <Button variant="ghost" className="w-full justify-start" title="Sem apagar rascunhos" onClick={() => run(workspace.toggleEnabled)}><Power className="mr-2 h-4 w-4" />{workspace.enabled ? 'Desativar painel' : 'Ativar painel lateral'}</Button>
      </PopoverContent>
    </Popover>
  </header>;
}
