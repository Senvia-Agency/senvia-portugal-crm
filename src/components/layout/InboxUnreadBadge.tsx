import { useEffect, useState } from "react";
import { useMessagingChannels } from "@/hooks/useMessagingChannels";
import { useEmailFolders } from "@/hooks/useEmail";
import { useMetaUnreadTotals } from "@/hooks/useMetaInbox";
import { cn } from "@/lib/utils";
import { useInterfaceStore } from "@/stores/useInterfaceStore";
import { WEBMAIL_ENABLED } from "./workspaceNavigation";

// Pastas que NAO contam para o total da caixa.
//
// Enviados e rascunhos sao nossos. Lixo e spam sao mensagens que a pessoa ja
// pos de lado — contar o lixo faz o distintivo pedir atencao para o que ja foi
// descartado, e o numero nunca desce.
const FORA_DO_TOTAL = new Set(['sent', 'drafts', 'trash', 'junk']);


/**
 * Por ler de UMA caixa de email — as pastas trazem o contador já feito.
 *
 * Um componente por caixa porque `useEmailFolders` é por canal: é a forma de ter
 * um número por caixa sem uma consulta que junte tudo. São poucas caixas.
 */
function ContaEmail({ channelId, onCount }: { channelId: string; onCount: (n: number) => void }) {
  const { data: folders = [] } = useEmailFolders(channelId);
  const total = folders
    // Enviados e rascunhos não contam: são nossos.
    .filter((f) => !FORA_DO_TOTAL.has(f.role))
    .reduce((s, f) => s + (f.unread_count || 0), 0);
  useEffect(() => { onCount(total); }, [total, onCount]);
  return null;
}

/**
 * Contador de mensagens por ler, no menu.
 *
 * Montado globalmente, mantém também o título do separador em dia — "(3) Senvia
 * OS" — para se ver que chegou coisa nova estando noutra página.
 *
 * Já contou o Chatwoot. Deixou de haver: o email vem das nossas pastas IMAP e o
 * Instagram/Messenger das nossas tabelas.
 */
export function InboxUnreadBadge({ className }: { className?: string }) {
  const { data: channels = [] } = useMessagingChannels();
  const { data: metaUnread } = useMetaUnreadTotals();

  const emailChannels = channels.filter((c) => c.channel_type === "email");
  const [emailCounts, setEmailCounts] = useState<Record<string, number>>({});

  // As caixas arquivadas não contam para o distintivo. As conversas delas
  // ficam (é para isso que se arquiva em vez de apagar), mas o que lá estava
  // por ler no momento do arquivo ficaria a pedir atenção para sempre, numa
  // caixa a que já ninguém tem de responder.
  const arquivadas = new Set(channels.filter((c) => c.archived_at).map((c) => c.id));
  // useMetaUnreadTotals lê TODAS as meta_conversations da org, sem filtrar por
  // tipo de canal — por isso um canal pausado em MESSAGING_CHANNELS (que já
  // não aparece em `channels`, via isChannelEnabled) continuava a somar aqui.
  // Só contam canais que a UI realmente mostra.
  const visiveis = new Set(channels.filter((c) => c.channel_type !== "email").map((c) => c.id));
  const totalMeta = Object.entries(metaUnread ?? {})
    .filter(([channelId]) => visiveis.has(channelId) && !arquivadas.has(channelId))
    .reduce((s, [, n]) => s + n, 0);
  const totalEmail = Object.values(emailCounts).reduce((s, n) => s + n, 0);
  const total = totalMeta + totalEmail;
  // With the WebMail, email has its own badge on "Email"; the tab title still counts everything.
  const legacy = useInterfaceStore((state) => state.legacy);
  const shown = WEBMAIL_ENABLED && !legacy ? totalMeta : total;

  useEffect(() => {
    const baseTitle = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = total > 0 ? `(${total}) ${baseTitle}` : baseTitle;
    // Sair com mensagens por ler (ex.: mudar para uma organização sem caixas)
    // não pode deixar um "(3)" preso no separador.
    return () => {
      document.title = document.title.replace(/^\(\d+\)\s*/, "");
    };
  }, [total]);

  return (
    <>
      {emailChannels.map((c) => (
        <ContaEmail
          key={c.id}
          channelId={c.id}
          onCount={(n) => setEmailCounts((prev) => (prev[c.id] === n ? prev : { ...prev, [c.id]: n }))}
        />
      ))}
      {shown > 0 && (
        <span
          className={cn(
            "flex h-5 min-w-[20px] items-center justify-center rounded-full bg-green-600 px-1.5 text-[10px] font-semibold text-white",
            className,
          )}
        >
          {shown > 99 ? "99+" : shown}
        </span>
      )}
    </>
  );
}
