import { useState } from 'react';
import { ArrowLeft, ExternalLink, Mailbox, Minimize2, MoreHorizontal, PanelRight, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useInboxWorkspace } from './InboxWorkspaceContext';
import { useLanguage } from '@/i18n';

export function InboxWorkspaceToolbar({ onOpenCaixas, channelLabel }: {
  readonly onOpenCaixas?: () => void;
  readonly channelLabel?: string;
}) {
  const workspace = useInboxWorkspace();
  const { t } = useLanguage();
  const [optionsOpen, setOptionsOpen] = useState(false);
  if (!workspace) return null;
  const run = (action: () => void) => { setOptionsOpen(false); action(); };
  return <header data-inbox-toolbar className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3">
    {onOpenCaixas && <Button variant="outline" size="sm" className={cn('h-10 shrink-0', !workspace.compact && 'lg:hidden')} onClick={onOpenCaixas}>
      <Mailbox className="mr-1.5 h-4 w-4" /> {t("Caixas")}
    </Button>}
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium" title={channelLabel}>{channelLabel ?? t('Inbox')}</p>
      <p className="truncate text-xs text-muted-foreground">{workspace.popup ? t('Mantém o Senvia original aberto') : workspace.enabled && workspace.pinned && workspace.whatsappSelected ? t('Inbox mantido aberto') : t('Inbox')}</p>
    </div>
    {workspace.enabled && workspace.whatsappSelected && <Button variant="outline" size="icon" className="shrink-0" title={t("Minimizar Inbox")} aria-label={t("Minimizar Inbox")} onClick={workspace.minimize}><Minimize2 className="h-4 w-4" /></Button>}
    <Popover open={optionsOpen} onOpenChange={setOptionsOpen}>
      <PopoverTrigger asChild><Button variant="outline" size="icon" className="shrink-0" title={t("Opções do Inbox")} aria-label={t("Opções do Inbox")}><MoreHorizontal className="h-4 w-4" /></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        {workspace.enabled && workspace.whatsappSelected && <>
          {!workspace.pinned && <Button variant="ghost" className="w-full justify-start" onClick={() => run(workspace.pin)}><PanelRight className="mr-2 h-4 w-4" />{t("Manter aberto")}</Button>}
          {workspace.compact && <Button variant="ghost" className="w-full justify-start" onClick={() => run(workspace.returnToInbox)}><ArrowLeft className="mr-2 h-4 w-4" />{t("Voltar ao Inbox")}</Button>}
          <Button variant="ghost" className="w-full justify-start" onClick={() => run(workspace.openWindow)}><ExternalLink className="mr-2 h-4 w-4" />{t("Abrir Inbox noutra janela")}</Button>
        </>}
        <Button variant="ghost" className="w-full justify-start" title={t("Sem apagar rascunhos")} onClick={() => run(workspace.toggleEnabled)}><Power className="mr-2 h-4 w-4" />{workspace.enabled ? t('Desativar painel') : t('Ativar painel lateral')}</Button>
      </PopoverContent>
    </Popover>
  </header>;
}
