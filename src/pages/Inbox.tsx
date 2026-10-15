import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { Loader2, Inbox as InboxIcon } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMessagingChannels, type MessagingChannel } from "@/hooks/useMessagingChannels";
import { useMetaUnreadTotals } from "@/hooks/useMetaInbox";
import { InboxCaixaRail } from "@/components/inbox/InboxCaixaRail";
import { MetaInbox } from "@/components/inbox/MetaInbox";

import { InboxPageSlot } from '@/components/inbox/workspace/InboxWorkspaceSurface';
import { InboxWorkspaceToolbar } from '@/components/inbox/workspace/InboxWorkspaceToolbar';
import { useInboxWorkspace } from '@/components/inbox/workspace/InboxWorkspaceContext';
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
  const compact = workspace?.compact ?? false;
  const readerActive = !workspace || (!workspace.minimized && (!!workspace.popup || workspace.onInbox || (workspace.enabled && workspace.pinned)));
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
  const [railSheetOpen, setRailSheetOpen] = useState(false);

  const caixasMensagens = useMemo(
    () => caixas.filter((c) => c.channel_type !== 'email'),
    [caixas],
  );

  // Abre a primeira caixa sozinha: com uma só, obrigar a escolhê-la é um passo
  // a mais para chegar ao mesmo sítio.
  useEffect(() => {
    if (emailChannelId || metaChannelId || todasConversas || caixas.length === 0) return;
    const email = caixas.find((c) => c.channel_type === "email");
    if (email) setEmailChannelId(email.id);
    else setMetaChannelId(caixas[0].id);
  }, [caixas, emailChannelId, metaChannelId, todasConversas]);

  const aberta = useMemo(
    () => caixas.find((c) => c.id === (metaChannelId ?? emailChannelId)) ?? null,
    [caixas, metaChannelId, emailChannelId],
  );

  const escolherMensagens = (ch: MessagingChannel) => {
    setTodasConversas(false);
    setEmailChannelId(null);
    setMetaChannelId(ch.id);
    setRailSheetOpen(false);
  };
  const escolherEmail = (ch: MessagingChannel) => {
    setTodasConversas(false);
    setMetaChannelId(null);
    setEmailChannelId(ch.id);
    setEmailFolderId(null);
    setRailSheetOpen(false);
  };
  const verTodas = () => {
    setEmailChannelId(null);
    setMetaChannelId(null);
    setTodasConversas(true);
    setRailSheetOpen(false);
  };

  const railProps = {
    caixas,
    caixaFilter: null,
    metaChannelId,
    todasConversas,
    unreadByInbox: undefined,
    emailChannelId,
    emailFolderId,
    onSelectAll: verTodas,
    onSelectMessaging: escolherMensagens,
    onSelectEmail: escolherEmail,
    onSelectFolder: (fid: string) => { setEmailFolderId(fid); setRailSheetOpen(false); },
  };

  const totalPorLer = Object.values(metaUnread ?? {}).reduce((s, n) => s + n, 0);

  return (
    <div className={cn(
      "flex flex-col overflow-hidden",
      // No telemóvel a barra de baixo está escondida nesta página: só o
      // cabeçalho (3.5rem + área segura) fica por cima. `dvh` acompanha o
      // crescer e encolher da barra do browser.
      compact ? "h-full" : isMobile
        ? "h-[calc(100dvh-3.5rem-var(--safe-area-top,0px)-var(--safe-area-bottom,0px))]"
        : "h-dvh",
    )}>
      <InboxWorkspaceToolbar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!compact && <InboxCaixaRail {...railProps} />}

        {/* No telemóvel o mesmo carril vive numa gaveta — o de cima está
            escondido abaixo de lg (1024px). */}
        <Sheet open={railSheetOpen} onOpenChange={setRailSheetOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="border-b p-4 pb-3">
              <SheetTitle>Caixas</SheetTitle>
            </SheetHeader>
            <InboxCaixaRail {...railProps} className="flex w-full border-r-0" />
          </SheetContent>
        </Sheet>

        {todasConversas ? (
          <MetaInbox
            channelId={caixasMensagens.map((c) => c.id)}
            active={readerActive}
            compact={compact}
            channelLabel="as tuas contas"
            caixas={caixasMensagens}
            onOpenRail={() => setRailSheetOpen(true)}
          />
        ) : metaChannelId ? (
          <MetaInbox
            channelId={metaChannelId}
            active={readerActive}
            compact={compact}
            channelLabel={aberta?.label ?? "esta caixa"}
            channelType={aberta?.channel_type}
            caixas={caixasMensagens}
            onOpenRail={() => setRailSheetOpen(true)}
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
              onOpenRail={() => setRailSheetOpen(true)}
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
