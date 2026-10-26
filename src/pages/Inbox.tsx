import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { Loader2, Inbox as InboxIcon } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DialogContainerContext } from '@/components/ui/portal-container';
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMessagingChannels, type MessagingChannel } from "@/hooks/useMessagingChannels";
import { useMetaUnreadTotals } from "@/hooks/useMetaInbox";
import { InboxCaixaRail } from "@/components/inbox/InboxCaixaRail";
import { MetaInbox } from "@/components/inbox/MetaInbox";

import { InboxPageSlot } from '@/components/inbox/workspace/InboxWorkspaceSurface';
import { InboxWorkspaceToolbar } from '@/components/inbox/workspace/InboxWorkspaceToolbar';
import { useInboxWorkspace } from '@/components/inbox/workspace/InboxWorkspaceContext';
import '@/components/inbox/inbox-workplace.css';
import { useInterfaceStore } from '@/stores/useInterfaceStore';
import { useAuth } from '@/contexts/AuthContext';
import { ChatWorkspace } from '@/features/workplace/chat/ChatWorkspace';
import { WEBMAIL_ENABLED } from '@/components/layout/workspaceNavigation';

// Internal messages are a Workplace preview feature (same gate as the /mensagens route).
const TEAM_CHAT_ENABLED = import.meta.env.DEV || import.meta.env.MODE === 'local-preview';
export default InboxPageSlot;
const EmailListReader = lazy(() =>
  import("@/components/email/EmailListReader").then((m) => ({ default: m.EmailListReader })));

/**
 * Caixa de Entrada.
 *
 * Esta página teve 5800 linhas: quase todas eram um cliente de Chatwoot
 * completo — lista de conversas, etiquetas, respostas gravadas, kanban,
 * paleta de comandos. O Chatwoot saiu do produto e nada disso tinha o que
 * mostrar: o email fala IMAP/SMTP pelo nosso gateway, e o Instagram e o
 * Messenger falam direto com a Meta.
 *
 * O que sobra é o que resta ser: escolher uma caixa à esquerda e abrir o
 * cliente dela. Cada canal traz o seu — não há aqui lógica de conversas.
 *
 * O histórico do Chatwoot foi exportado antes de isto ser removido e vive em
 * `chatwoot_archive_conversations` / `chatwoot_archive_messages`. Está guardado,
 * mas ainda não tem ecrã — é a peça que falta.
 */
export function InboxContent() {
  const workspace = useInboxWorkspace();
  const legacy = useInterfaceStore(state => state.legacy);
  const compact = workspace?.compact ?? false;
  const readerActive = !workspace || (!workspace.minimized && (!!workspace.popup || workspace.onInbox || workspace.docked));
  const isMobile = useIsMobile();
  const { data: caixas = [] } = useMessagingChannels();
  const { data: metaUnread } = useMetaUnreadTotals();

  // Que caixa está aberta. Uma de cada vez, e são de tipos diferentes: o email
  // tem pastas, os canais da Meta não.
  const [emailChannelId, setEmailChannelId] = useState<string | null>(null);
  const [emailFolderId, setEmailFolderId] = useState<string | null>(null);
  const [metaChannelId, setMetaChannelId] = useState<string | null>(null);
  // "Todas as conversas": Instagram e Messenger numa lista só. O email fica de
  // fora de propósito — tem pastas, rascunhos e anexos, é um cliente próprio e
  // não uma lista de conversas.
  const [todasConversas, setTodasConversas] = useState(false);
  const { user, organization } = useAuth();
  // Internal team messages, a box of their own beside the client channels (not in the compact side panel).
  const [teamChat, setTeamChat] = useState(false);
  const teamChatOn = TEAM_CHAT_ENABLED && !compact && teamChat && !!user && !!organization;
  const [railSheetOpen, setRailSheetOpen] = useState(false);
  // With the WebMail, the email caixas live there (the classic interface keeps them here).
  const emailApart = WEBMAIL_ENABLED && !legacy;
  const caixasVisiveis = useMemo(
    () => compact ? caixas.filter((c) => c.channel_type === 'whatsapp')
      : emailApart ? caixas.filter((c) => c.channel_type !== 'email') : caixas,
    [caixas, compact, emailApart],
  );

  const caixasMensagens = useMemo(
    () => caixasVisiveis.filter((c) => c.channel_type !== 'email'),
    [caixasVisiveis],
  );
  const caixasMensagensIds = useMemo(() => caixasMensagens.map((c) => c.id), [caixasMensagens]);

  // Abre a primeira caixa sozinha: com uma só, obrigar a escolhê-la é um passo
  // a mais para chegar ao mesmo sítio.
  useEffect(() => {
    if (emailChannelId || metaChannelId || todasConversas || teamChatOn || caixas.length === 0) return;
    const whatsapp = caixas.find((c) => c.channel_type === 'whatsapp');
    if (whatsapp) { setMetaChannelId(whatsapp.id); return; }
    const email = caixasVisiveis.find((c) => c.channel_type === "email");
    if (email) setEmailChannelId(email.id);
    else if (caixasVisiveis[0]) setMetaChannelId(caixasVisiveis[0].id);
  }, [caixas, caixasVisiveis, emailChannelId, metaChannelId, todasConversas, teamChatOn]);

  const aberta = useMemo(
    () => caixas.find((c) => c.id === (metaChannelId ?? emailChannelId)) ?? null,
    [caixas, metaChannelId, emailChannelId],
  );
  const whatsappSelecionado = !teamChatOn && aberta?.channel_type === 'whatsapp'
    || (todasConversas && caixasMensagens.length > 0 && caixasMensagens.every((c) => c.channel_type === 'whatsapp'));
  const setWhatsAppSelected = workspace?.setWhatsAppSelected;
  useEffect(() => { setWhatsAppSelected?.(whatsappSelecionado); }, [setWhatsAppSelected, whatsappSelecionado]);

  const escolherMensagens = (ch: MessagingChannel) => {
    setTeamChat(false);
    setTodasConversas(false);
    setEmailChannelId(null);
    setMetaChannelId(ch.id);
    setRailSheetOpen(false);
  };
  const escolherEmail = (ch: MessagingChannel) => {
    setTeamChat(false);
    setTodasConversas(false);
    setMetaChannelId(null);
    setEmailChannelId(ch.id);
    setEmailFolderId(null);
    setRailSheetOpen(false);
  };
  const verTodas = () => {
    setTeamChat(false);
    setEmailChannelId(null);
    setMetaChannelId(null);
    setTodasConversas(true);
    setRailSheetOpen(false);
  };

  const railProps = {
    caixas: caixasVisiveis,
    caixaFilter: null,
    metaChannelId,
    todasConversas,
    unreadByInbox: undefined,
    emailChannelId,
    emailFolderId,
    onSelectAll: verTodas,
    onSelectMessaging: escolherMensagens,
    onSelectEmail: escolherEmail,
    onSelectFolder: (fid: string) => { setTeamChat(false); setEmailFolderId(fid); setRailSheetOpen(false); },
    webmailLink: emailApart && !compact,
    teamChat: TEAM_CHAT_ENABLED && !compact ? {
      active: teamChatOn,
      onSelect: () => { setEmailChannelId(null); setMetaChannelId(null); setTodasConversas(false); setTeamChat(true); setRailSheetOpen(false); },
    } : undefined,
  };

  const totalPorLer = Object.values(metaUnread ?? {}).reduce((s, n) => s + n, 0);

  return (
    <div data-interface={legacy ? 'classic' : 'workspace'} data-compact={compact} className={cn(
      "inbox-workplace flex flex-col overflow-hidden",
      compact || isMobile ? "h-full" : "h-[calc(100dvh-7rem)]",
    )}>
      <InboxWorkspaceToolbar onOpenCaixas={() => setRailSheetOpen(true)} channelLabel={teamChatOn ? 'Mensagens internas' : todasConversas ? 'Todas as conversas' : aberta?.label ?? 'Inbox'} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!compact && <InboxCaixaRail {...railProps} />}

        {/* No telemóvel o mesmo carril vive numa gaveta — o de cima está
            escondido abaixo de lg (1024px). */}
        <DialogContainerContext.Provider value={workspace?.popup?.document.body ?? document.body}>
        <Sheet open={railSheetOpen} onOpenChange={setRailSheetOpen}>
          <SheetContent data-inbox-workspace-control side="left" className="z-[70] flex w-72 flex-col p-0 [&>button]:right-2 [&>button]:top-2 [&>button]:h-10 [&>button]:w-10 [&>button]:translate-y-0" aria-describedby={undefined}>
            <SheetHeader className="border-b p-4 pb-3">
              <SheetTitle>Caixas</SheetTitle>
            </SheetHeader>
            <InboxCaixaRail {...railProps} className="flex min-h-0 w-full flex-1 border-r-0" />
          </SheetContent>
        </Sheet>
        </DialogContainerContext.Provider>

        {teamChatOn && user && organization ? (
          <ChatWorkspace key={`${user.id}:${organization.id}`} organizationId={organization.id} userId={user.id} embedded />
        ) : todasConversas ? (
          <MetaInbox
            channelId={caixasMensagensIds}
            active={readerActive}
            compact={compact}
            channelLabel="as tuas contas"
            caixas={caixasMensagens}
          />
        ) : metaChannelId ? (
          <MetaInbox
            channelId={metaChannelId}
            active={readerActive}
            compact={compact}
            channelLabel={aberta?.label ?? "esta caixa"}
            channelType={aberta?.channel_type}
            caixas={caixasMensagens}
          />
        ) : emailChannelId ? (
          <Suspense fallback={
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }>
            <EmailListReader
              compact={compact}
              channelId={emailChannelId}
              folderId={emailFolderId}
            />
          </Suspense>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <InboxIcon className="h-8 w-8 text-muted-foreground/60" />
            <p className="max-w-sm text-sm text-muted-foreground">
              {caixas.length === 0
                ? "Ainda não tens nenhuma caixa ligada. Liga uma em Definições → Integrações."
                : "Escolhe uma caixa à esquerda para ler e responder."}
            </p>
            {totalPorLer > 0 && (
              <p className="text-xs text-muted-foreground">
                {totalPorLer} {totalPorLer === 1 ? "mensagem por ler" : "mensagens por ler"}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
