import { ArrowLeft, ExternalLink, Minimize2, PanelRight, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useInboxWorkspace } from './InboxWorkspaceContext';

export function InboxWorkspaceToolbar() {
  const workspace = useInboxWorkspace();
  if (!workspace) return null;
  return <header className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-card px-3 py-2">
    <p className="mr-auto text-sm font-medium">{workspace.popup ? 'Inbox noutra janela' : workspace.pinned ? 'Inbox mantido aberto' : 'Inbox'}</p>
    {workspace.enabled && <>
      {!workspace.pinned && <Button variant="outline" size="sm" onClick={workspace.pin}>
        <PanelRight className="mr-1 h-4 w-4" /> Manter aberto
      </Button>}
      {(workspace.compact || workspace.minimized) && <Button variant="ghost" size="icon" title="Voltar ao Inbox" aria-label="Voltar ao Inbox" onClick={workspace.returnToInbox}><ArrowLeft className="h-4 w-4" /></Button>}
      <Button variant="ghost" size="icon" title="Minimizar Inbox" aria-label="Minimizar Inbox" onClick={workspace.minimize}><Minimize2 className="h-4 w-4" /></Button>
      <Button variant="ghost" size="icon" title="Abrir Inbox noutra janela" aria-label="Abrir Inbox noutra janela" onClick={workspace.openWindow}><ExternalLink className="h-4 w-4" /></Button>
    </>}
    <Button variant="ghost" size="sm" title="Voltar ao comportamento original sem apagar rascunhos" onClick={workspace.toggleEnabled}>
      <Power className="mr-1 h-4 w-4" /> {workspace.enabled ? 'Desativar painel' : 'Ativar painel lateral'}
    </Button>
    {workspace.popup && <p className="w-full text-xs text-muted-foreground">Mantém o separador original do Senvia aberto.</p>}
  </header>;
}
