import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageCircle, Send, PanelLeft, PanelRight, Clock, Paperclip, SmilePlus, Mic, X, Reply, Archive, FileText, RefreshCw, Download, ImageOff, Copy, Phone, ExternalLink, UserPlus, ChevronRight, Briefcase, FileSignature, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { formatRelativeTime, formatDateTime } from '@/lib/format';
import { shouldDeliverVoiceRecording } from '@/lib/voice-recording';
import { toast } from 'sonner';
import {
  useMetaConversations, useMetaMessages, useSendMetaMessage, useMarkMetaRead,
  useMetaAction, useSendMetaAttachment, useMetaMedia, useFillContactAvatars,
  useWhatsAppTemplates, useSyncWhatsAppTemplates, useSendWhatsAppTemplate,
  type MetaConversation, type MetaMessage, type WhatsAppTemplate,
} from '@/hooks/useMetaInbox';
import { ListStatusTicks } from './StatusTicks';
import { MediaViewer, type MediaItem } from './MediaViewer';
import { createMetaMessageSendPlan } from '@/lib/meta-message-send-plan';
import { MessageText } from './MessageText';
import { FileTypeIcon } from './FileTypeIcon';
import { PdfDocumentCard } from './PdfDocumentCard';
import { isPdfDocument } from './pdf-rendering';
import { ContactNotes } from '@/components/contacts/ContactNotes';
import { ConversationTasks } from '@/components/inbox/ConversationTasks';
import { AddLeadModal } from '@/components/leads/AddLeadModal';
import { useCrmContactByPhone } from '@/hooks/useCrmContactByPhone';
import { useClientProposals, useClientSales } from '@/hooks/useClientHistory';
import { useTeamMembers } from '@/hooks/useTeam';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { SALE_STATUS_LABELS, type SaleStatus } from '@/types/sales';
import { PROPOSAL_STATUS_LABELS, type ProposalStatus } from '@/types/proposals';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

/**
 * Caixa de Instagram / Messenger.
 *
 * Lê das nossas tabelas (meta_conversations / meta_messages), não do Chatwoot —
 * estes canais falam direto com a Meta. Monta-se ao lado do cliente de email,
 * como ele: quando se escolhe uma caixa destas, substitui as colunas do chat.
 */
export function MetaInbox({
  channelId,
  channelLabel,
  channelType,
  caixas,
  onOpenRail,
}: {
  /** Uma caixa, ou várias na vista "Todas as conversas". */
  channelId: string | string[];
  channelLabel: string;
  /** 'instagram' ou 'facebook' — o Instagram só aceita uma reação. */
  channelType?: string;
  /** Nome e tipo de cada caixa, para dizer de onde veio cada conversa. */
  caixas?: Array<{
    id: string;
    label: string | null;
    channel_type: string;
    /** Arquivada: o histórico lê-se, mas já não se responde por ela. */
    archived_at?: string | null;
  }>;
  onOpenRail?: () => void;
}) {
  const { data: conversations = [], isLoading, isError, refetch } = useMetaConversations(channelId);
  // Fotos de WhatsApp que faltam: o servidor vai buscá-las, uma vez por sessão.
  useFillContactAvatars(conversations);
  // Com várias caixas, cada linha tem de dizer a que caixa pertence — senão duas
  // conversas de contas diferentes ficam indistinguíveis na mesma lista.
  const varias = Array.isArray(channelId) && channelId.length > 1;
  const caixaDe = (id: string) => caixas?.find((c) => c.id === id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem('inbox-panel-v1') !== '0');
  const [panelSheetOpen, setPanelSheetOpen] = useState(false);
  const [taskPrefill, setTaskPrefill] = useState<{
    readonly conversationId: string;
    readonly text: string;
    readonly surface: 'desktop' | 'sheet';
  } | null>(null);
  const markRead = useMarkMetaRead();

  // Trocar de caixa não deve manter aberta uma conversa da anterior.
  useEffect(() => { setSelectedId(null); }, [channelId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((c) =>
      (c.contact_name ?? '').toLowerCase().includes(term)
      || (c.last_message ?? '').toLowerCase().includes(term));
  }, [conversations, search]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const openConversation = (c: MetaConversation) => {
    setSelectedId(c.id);
    if (c.unread_count > 0) markRead.mutate({ conversationId: c.id, seen: c.unread_count });
  };

  const openContactPanel = () => {
    if (window.innerWidth >= 1024) {
      setPanelOpen(true);
      localStorage.setItem('inbox-panel-v1', '1');
      return;
    }
    setPanelSheetOpen(true);
  };

  const closeContactPanel = () => {
    setPanelSheetOpen(false);
    if (window.innerWidth >= 1024) {
      setPanelOpen(false);
      localStorage.setItem('inbox-panel-v1', '0');
    }
  };

  const requestTaskPrefill = (text: string) => {
    if (!selected) return;
    setTaskPrefill({ conversationId: selected.id, text, surface: window.innerWidth >= 1024 ? 'desktop' : 'sheet' });
    openContactPanel();
  };
  const consumeTaskPrefill = () => {
    setTaskPrefill((current) => current?.conversationId === selected?.id ? null : current);
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Lista */}
      <aside className={cn(
        'w-full flex-col border-r lg:flex lg:w-96',
        selectedId ? 'hidden lg:flex' : 'flex',
      )}>
        <div className="flex items-center gap-2 border-b p-3">
          {onOpenRail && (
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 lg:hidden" onClick={onOpenRail}>
              <PanelLeft className="h-4 w-4" />
            </Button>
          )}
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Procurar conversa…"
            className="h-9"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
            </div>
          ) : isError ? (
            /* Uma falha de leitura NÃO pode aparecer como "ainda sem conversas":
               o agente lê isso como "este cliente não escreveu nada" e a verdade
               é que não conseguimos ir buscar o que ele escreveu. */
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Não foi possível carregar as conversas.
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title="Ainda sem conversas"
              description={`Quando alguém enviar uma mensagem para ${channelLabel}, ela aparece aqui.`}
            />
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => openConversation(c)}
                className={cn(
                  'flex w-full items-start gap-3 border-b p-3 text-left transition-colors hover:bg-accent/50',
                  selectedId === c.id && 'bg-primary/5',
                )}
              >
                <ContactAvatar name={c.contact_name} url={c.contact_avatar_url} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {c.contact_name || c.contact_ref}
                    </p>
                    {c.last_message_at && (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatRelativeTime(c.last_message_at)}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {c.last_message || 'Sem mensagens'}
                  </p>
                  {varias && caixaDe(c.channel_id) && (
                    <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/80">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: caixaDe(c.channel_id)!.channel_type === 'instagram' ? '#E4405F' : '#0084FF' }}
                      />
                      {caixaDe(c.channel_id)!.label
                        || (caixaDe(c.channel_id)!.channel_type === 'instagram' ? 'Instagram' : 'Messenger')}
                    </p>
                  )}
                </div>
                {c.unread_count > 0 && (
                  <span className="mt-1 shrink-0 rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">
                    {c.unread_count > 99 ? '99+' : c.unread_count}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Conversa */}
      {selected ? (
        <MetaThread
          // Sem `key`, o rascunho e a resposta citada da conversa anterior ainda
          // aparecem por baixo do cabeçalho da nova durante um instante.
          key={selected.id}
          conversation={selected}
          // Na vista de várias caixas o tipo vem da conversa, não da página:
          // reagir numa conversa de Messenger tem mais emojis do que numa de
          // Instagram, e usar o tipo errado oferecia botões que iam falhar.
          channelType={caixaDe(selected.channel_id)?.channel_type ?? channelType}
          // Uma caixa arquivada continua a mostrar tudo o que lá está — é para
          // isso que se arquiva em vez de apagar — mas não se responde por ela.
          arquivada={!!caixaDe(selected.channel_id)?.archived_at}
          onBack={() => setSelectedId(null)}
          onOpenContact={openContactPanel}
          onCreateTask={(caixaDe(selected.channel_id)?.channel_type ?? channelType) === 'whatsapp' && /^[0-9]{9,15}$/.test(selected.contact_ref) ? requestTaskPrefill : undefined}
        />
      ) : (
        <div className="hidden flex-1 items-center justify-center p-8 text-center lg:flex">
          <p className="max-w-sm text-sm text-muted-foreground">
            Escolhe uma conversa para a ler e responder.
          </p>
        </div>
      )}
      {selected && panelOpen && (
        <aside className="hidden w-80 shrink-0 border-l lg:block">
          <MetaContactPanel
            key={selected.id}
            conversation={selected}
            channelType={caixaDe(selected.channel_id)?.channel_type ?? channelType}
            onClose={closeContactPanel}
            taskPrefill={taskPrefill?.conversationId === selected.id && taskPrefill.surface === 'desktop' ? taskPrefill.text : null}
            onPrefillConsumed={consumeTaskPrefill}
          />
        </aside>
      )}
      <Sheet open={panelSheetOpen} onOpenChange={setPanelSheetOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-md">
          <SheetTitle className="sr-only">Contacto</SheetTitle>
          {selected && <MetaContactPanel
            key={selected.id}
            conversation={selected}
            channelType={caixaDe(selected.channel_id)?.channel_type ?? channelType}
            onClose={closeContactPanel}
            taskPrefill={taskPrefill?.conversationId === selected.id && taskPrefill.surface === 'sheet' ? taskPrefill.text : null}
            onPrefillConsumed={consumeTaskPrefill}
          />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

const OPEN_SALE_STATUSES: SaleStatus[] = ['in_progress', 'fulfilled'];
const OPEN_PROPOSAL_STATUSES: ProposalStatus[] = ['draft', 'sent', 'negotiating'];
const euro = (value: number | string | null | undefined) =>
  value == null ? null : new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(Number(value));

function MetaContactPanel({ conversation, channelType, onClose, taskPrefill, onPrefillConsumed }: {
  conversation: MetaConversation;
  channelType?: string;
  onClose: () => void;
  taskPrefill?: string | null;
  onPrefillConsumed?: () => void;
}) {
  const phone = conversation.contact_ref.includes('@') ? null : conversation.contact_ref.replace(/\D/g, '');
  const displayName = conversation.contact_name || conversation.contact_ref;
  const navigate = useNavigate();

  // The CRM record behind this number, as the old inbox panel had it: who
  // this is, what is open with them, and what was promised to them.
  const { data: match, isLoading: matching } = useCrmContactByPhone(phone);
  const clientId = match?.kind === 'client' ? match.id : null;
  const { data: sales = [] } = useClientSales(clientId);
  const { data: proposals = [] } = useClientProposals(clientId);
  const openSales = sales.filter((sale) => OPEN_SALE_STATUSES.includes(sale.status as SaleStatus));
  const openProposals = proposals.filter((proposal) => OPEN_PROPOSAL_STATUSES.includes(proposal.status as ProposalStatus));
  const { data: stages = [] } = usePipelineStages();
  const { data: team = [] } = useTeamMembers();
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const stageName = match?.kind === 'lead' ? stages.find((st) => st.key === match.status)?.name ?? match.status : null;
  const openRecord = () => {
    if (!match) return;
    navigate(match.kind === 'client' ? `/clients?highlight=${match.id}` : `/leads?lead=${match.id}`);
  };

  const copyPhone = async () => {
    if (!phone) return;
    await navigator.clipboard.writeText(phone);
    toast.success('Número copiado');
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
      <header className="flex items-start gap-3 border-b p-4">
        <ContactAvatar name={conversation.contact_name} url={conversation.contact_avatar_url} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{displayName}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{phone || 'Contacto sem número disponível'}</p>
        </div>
        <Button variant="ghost" size="icon" title="Fechar painel" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="space-y-4 p-4">
        {phone && (
          <div className={cn('grid gap-2', channelType === 'whatsapp' ? 'grid-cols-3' : 'grid-cols-2')}>
            <Button variant="outline" size="sm" className="h-auto min-w-0 flex-col gap-1 px-1 py-2 text-xs" asChild>
              <a href={`tel:${phone}`}><Phone className="h-4 w-4" /> Ligar</a>
            </Button>
            <Button variant="outline" size="sm" className="h-auto min-w-0 flex-col gap-1 px-1 py-2 text-xs" onClick={() => void copyPhone()}>
              <Copy className="h-4 w-4" /> Copiar
            </Button>
            {channelType === 'whatsapp' && <Button variant="outline" size="sm" className="h-auto min-w-0 flex-col gap-1 px-1 py-2 text-xs" asChild>
              <a href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> WhatsApp</a>
            </Button>}
          </div>
        )}

        <div className="rounded-xl border bg-card p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contacto</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">Nome</dt>
              <dd className="text-right font-medium">{displayName}</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">Canal</dt>
              <dd className="text-right font-medium">{channelType === 'instagram' ? 'Instagram' : channelType === 'facebook' ? 'Messenger' : 'WhatsApp'}</dd>
            </div>
            {conversation.last_message_at && (
              <div className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">Última mensagem</dt>
                <dd className="text-right font-medium">{formatDateTime(conversation.last_message_at)}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* The CRM record: client or lead, or the way to create one. */}
        {phone && (
          matching ? (
            <Skeleton className="h-20 w-full rounded-xl" />
          ) : match ? (
            <div className="rounded-xl border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {match.kind === 'client' ? 'Cliente' : 'Lead'}
                </p>
                <button type="button" onClick={openRecord} className="flex items-center gap-0.5 text-xs font-medium text-primary hover:underline">
                  Ver ficha <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-2 truncate text-sm font-semibold">{match.name || displayName}</p>
              <dl className="mt-2 space-y-1.5 text-sm">
                {match.kind === 'client' && match.code && (
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Código</dt><dd className="font-medium">{match.code}</dd></div>
                )}
                {match.kind === 'lead' && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Etapa</dt>
                    <dd><span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{stageName || '—'}</span></dd>
                  </div>
                )}
                {match.kind === 'lead' && match.value != null && (
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Valor</dt><dd className="font-semibold text-success">{euro(match.value)}</dd></div>
                )}
                {match.email && (
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Email</dt><dd className="min-w-0 truncate font-medium">{match.email}</dd></div>
                )}
              </dl>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed bg-card p-3">
              <p className="text-sm font-medium">Ainda não está no CRM</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Nenhum cliente ou lead tem este número.</p>
              <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={() => setAddLeadOpen(true)}>
                <UserPlus className="h-3.5 w-3.5" /> Criar lead
              </Button>
            </div>
          )
        )}

        {/* What is open with this client, as the old panel showed it. */}
        {(openSales.length > 0 || openProposals.length > 0) && (
          <div className="space-y-2 rounded-xl border bg-card p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Em aberto</p>
            {openSales.map((sale) => (
              <button
                key={sale.id}
                type="button"
                onClick={() => navigate(`/sales?sale=${sale.id}`)}
                className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors hover:bg-accent/50"
              >
                <Briefcase className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">Venda {sale.code ?? ''}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {[euro(sale.total_value), SALE_STATUS_LABELS[sale.status as SaleStatus]].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
            {openProposals.map((proposal) => (
              <button
                key={proposal.id}
                type="button"
                onClick={() => navigate(`/proposals?proposal=${proposal.id}`)}
                className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors hover:bg-accent/50"
              >
                <FileSignature className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">Proposta {proposal.code ?? ''}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {[euro(proposal.total_value), PROPOSAL_STATUS_LABELS[proposal.status as ProposalStatus]].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}

        {/* What was promised to this person. */}
        {phone && (
          <ConversationTasks
            phone={phone}
            contactName={displayName}
            conversationId={null}
            nativeConversationId={conversation.id}
            channelId={conversation.channel_id}
            leadId={match?.kind === 'lead' ? match.id : null}
            clientId={match?.kind === 'client' ? match.id : null}
            teamMembers={team.map((member) => ({ user_id: member.user_id, full_name: member.full_name }))}
            prefill={taskPrefill}
            onPrefillConsumed={onPrefillConsumed}
          />
        )}

        <ContactNotes phone={phone} source="inbox" />
      </div>

      <AddLeadModal
        open={addLeadOpen}
        onOpenChange={setAddLeadOpen}
        initialData={{ name: conversation.contact_name ?? undefined, phone: phone ?? undefined, source: 'WhatsApp' }}
      />
    </section>
  );
}

/**
 * Uma mensagem escrita pelo agente que a Meta ainda não confirmou.
 *
 * Antes, entre carregar em enviar e a mensagem aparecer, não havia nada: um
 * botão a rodar e a conversa na mesma. A Meta demora porque vai BUSCAR o
 * ficheiro ao nosso armazenamento antes de responder — e nesse silêncio o
 * agente escreve outra vez.
 */
interface Pendente {
  id: string;
  texto?: string;
  ficheiro?: File;
  /** Endereço local, para mostrar a imagem ou ouvir o áudio sem esperar. */
  previewUrl?: string;
  tipo?: string;
  replyToMid?: string | null;
  erro?: string | null;
}

/** Um ficheiro colado na caixa de escrita, ainda por enviar. */
interface Colado {
  id: string;
  file: File;
  previewUrl: string;
}

/**
 * As imagens de uma conversa abrem num visualizador em ecrã inteiro, como no
 * WhatsApp Web: quem enviou, quando, a legenda, setas para as outras imagens.
 * As do WhatsApp por QR só têm endereço depois de carregadas (um ficheiro
 * local do browser), por isso cada imagem regista-se aqui quando aparece.
 */
const VisualizadorContext = createContext<{
  registar: (chave: string, url: string) => void;
  abrir: (chave: string, url: string) => void;
} | null>(null);

/** Guarda a imagem no computador; se o servidor dela não deixar lê-la, abre-a num separador. */
async function descarregarImagem(url: string) {
  try {
    const blob = await (await fetch(url)).blob();
    const ext = blob.type === 'image/png' ? 'png'
      : blob.type === 'image/webp' ? 'webp'
      : blob.type === 'image/gif' ? 'gif'
      : 'jpg';
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `imagem-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

function MetaThread({
  conversation,
  channelType,
  arquivada,
  onBack,
  onOpenContact,
  onCreateTask,
}: {
  conversation: MetaConversation;
  channelType?: string;
  arquivada?: boolean;
  onBack: () => void;
  onOpenContact: () => void;
  onCreateTask?: (text: string) => void;
}) {
  const { data: messages = [], isLoading, isError, refetch } = useMetaMessages(conversation.id);
  const send = useSendMetaMessage();
  const markRead = useMarkMetaRead();
  const act = useMetaAction();
  const sendFile = useSendMetaAttachment();
  const [draft, setDraft] = useState('');
  // Mensagem a que se está a responder. Guarda-se a mensagem inteira, não só o
  // id, para mostrar a citação sem a ir procurar outra vez à lista.
  const [replyTo, setReplyTo] = useState<MetaMessage | null>(null);
  const [aGravar, setAGravar] = useState(false);
  // Mensagens já escritas mas ainda não confirmadas pela Meta. Existem só aqui,
  // no ecrã: quando a Meta confirma, a mensagem verdadeira vem da base de dados
  // e esta desaparece.
  const [pendentes, setPendentes] = useState<Pendente[]>([]);
  // Espelho para a limpeza no desmontar: o efeito de limpeza corre uma vez só e
  // veria a lista vazia do primeiro render.
  const pendentesRef = useRef<Pendente[]>([]);
  pendentesRef.current = pendentes;
  // Imagens coladas com Ctrl+V (um print, por exemplo), à espera de Enviar —
  // como no WhatsApp Web. Um colar sem querer não pode chegar ao cliente.
  const [colados, setColados] = useState<Colado[]>([]);
  const coladosRef = useRef<Colado[]>([]);
  coladosRef.current = colados;

  // Visualizador de imagens. As mensagens vão por ref para o contexto ficar
  // estável: mudar a cada mensagem nova fazia todas as imagens registarem-se
  // outra vez.
  const [visualizador, setVisualizador] = useState<{ itens: MediaItem[]; indice: number } | null>(null);
  const urlsCarregadas = useRef(new Map<string, string>());
  const mensagensRef = useRef<MetaMessage[]>([]);
  mensagensRef.current = messages;
  const contactoRef = useRef(conversation.contact_name || conversation.contact_ref);
  contactoRef.current = conversation.contact_name || conversation.contact_ref;
  const contextoVisualizador = useMemo(() => ({
    registar: (chave: string, url: string) => { urlsCarregadas.current.set(chave, url); },
    abrir: (chave: string, url: string) => {
      const itens: Array<MediaItem & { chave: string }> = [];
      for (const m of mensagensRef.current) {
        if (m.is_deleted) continue;
        (m.attachments ?? []).forEach((a, i) => {
          if (a.type !== 'image') return;
          const k = `${m.id}:${i}`;
          const u = a.url || urlsCarregadas.current.get(k);
          if (!u) return; // do WhatsApp e ainda por carregar
          itens.push({
            chave: k,
            url: u,
            type: 'image',
            title: m.direction === 'outgoing' ? 'Tu' : contactoRef.current,
            subtitle: formatDateTime(m.sent_at ?? m.created_at),
            caption: m.content?.trim() || undefined,
          });
        });
      }
      let indice = itens.findIndex((it) => it.chave === chave);
      if (indice < 0) {
        itens.splice(0, itens.length, { chave, url, type: 'image' });
        indice = 0;
      }
      setVisualizador({ itens, indice });
    },
  }), []);
  const queryClient = useQueryClient();
  const messageListRef = useRef<HTMLDivElement>(null);
  const positionedConversationRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingRef = useRef<number | null>(null);

  useEffect(() => { setDraft(''); setReplyTo(null); }, [conversation.id]);
  useLayoutEffect(() => {
    const viewport = messageListRef.current;
    if (!viewport || isLoading || isError) return;
    const isOpening = positionedConversationRef.current !== conversation.id;
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: isOpening ? 'instant' : 'smooth',
    });
    positionedConversationRef.current = conversation.id;
  }, [conversation.id, isLoading, isError, messages.length, pendentes.length]);

  // Os endereços locais das pré-visualizações ficam presos à memória do
  // browser até serem largados à mão.
  useEffect(() => () => {
    pendentesRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    coladosRef.current.forEach((c) => URL.revokeObjectURL(c.previewUrl));
  }, []);

  // A Meta só deixa responder até 24h depois da última mensagem DA PESSOA.
  // Mostrar isto antes de escrever evita perder uma resposta já redigida.
  const windowExpired = !!conversation.window_expires_at
    && new Date(conversation.window_expires_at) < new Date();

  // "Visto" ao abrir a conversa — é o que a pessoa do outro lado espera ver.
  //
  // Fora da janela das 24h a Meta recusa, e a recusa vinha como erro não tratado
  // sempre que se abria uma conversa antiga. Não se pede o que já se sabe que
  // vai ser negado.
  useEffect(() => {
    // Numa caixa arquivada já não há token nenhum para falar com a Meta — o
    // "visto" ia falhar em todas as conversas que se abrissem.
    if (windowExpired || arquivada) return;
    act.mutate({ conversationId: conversation.id, action: 'mark_seen' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  // Mensagens que cheguem com a conversa ABERTA também contam como lidas. Sem
  // isto, o contador subia na conversa que o agente está literalmente a ler, e
  // só descia ao sair e voltar a entrar.
  useEffect(() => {
    if (conversation.unread_count > 0) {
      markRead.mutate({ conversationId: conversation.id, seen: conversation.unread_count });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, conversation.unread_count]);

  /**
   * "A escrever…" no Instagram da pessoa.
   *
   * Estrangulado a um envio por 3 segundos: a cada tecla seria uma chamada à
   * Meta por caractere, o que arde o limite de pedidos sem acrescentar nada —
   * o indicador dela dura alguns segundos de qualquer forma.
   */
  const sinalizarEscrita = () => {
    const agora = Date.now();
    if (typingRef.current && agora - typingRef.current < 3000) return;
    typingRef.current = agora;
    act.mutate({ conversationId: conversation.id, action: 'typing_on' });
  };

  /**
   * Enviar (ou reenviar) uma mensagem que já está na conversa como pendente.
   *
   * A bolha só sai da lista de pendentes DEPOIS de a releitura trazer a
   * mensagem verdadeira. Tirá-la mal a Meta responde deixava um buraco de
   * meio segundo em que a mensagem não estava em lado nenhum — e é nesse
   * buraco que o agente carrega em enviar outra vez.
   */
  const enviarPendente = async (item: Pendente) => {
    setPendentes((ps) => ps.map((p) => (p.id === item.id ? { ...p, erro: null } : p)));
    try {
      if (item.ficheiro) {
        await sendFile.mutateAsync({
          conversationId: conversation.id,
          file: item.ficheiro,
          text: item.texto,
          replyToMid: item.replyToMid,
        });
      } else {
        await send.mutateAsync({
          conversationId: conversation.id,
          text: item.texto!,
          replyToMid: item.replyToMid ?? null,
        });
      }
      await queryClient.refetchQueries({ queryKey: ['meta-messages', conversation.id] });
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      setPendentes((ps) => ps.filter((p) => p.id !== item.id));
    } catch (e) {
      const msg = (e as Error).message;
      setPendentes((ps) => ps.map((p) => (p.id === item.id ? { ...p, erro: msg } : p)));
      // A bolha diz que falhou; o aviso diz porquê. O motivo da Meta costuma
      // ser longo de mais para caber na conversa.
      toast.error('Não foi enviada', { description: msg });
    }
  };

  const descartar = (item: Pendente) => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setPendentes((ps) => ps.filter((p) => p.id !== item.id));
  };

  const handleSend = () => {
    const text = draft.trim();
    if (!text && colados.length === 0) return;
    const plano = createMetaMessageSendPlan({
      attachments: colados,
      text,
      replyToMid: replyTo?.external_id ?? null,
    });
    const itens = plano.map((item) => item.kind === 'attachment'
      ? pendenteDeFicheiro(item.attachment.file, item.attachment.previewUrl, item.caption, item.replyToMid)
      : { id: crypto.randomUUID(), texto: item.text, replyToMid: item.replyToMid });
    setPendentes((ps) => [...ps, ...itens]);
    setColados([]);
    setDraft('');
    setReplyTo(null);
    void (async () => { for (const item of itens) await enviarPendente(item); })();
  };

  /** Pré-visualização sem esperar pela Meta: o ficheiro já está aqui. */
  const pendenteDeFicheiro = (file: File, previewUrl?: string, texto?: string | null, replyToMid?: string | null): Pendente => ({
    id: crypto.randomUUID(),
    ficheiro: file,
    previewUrl: previewUrl ?? URL.createObjectURL(file),
    tipo: file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('video/') ? 'video'
      : file.type.startsWith('audio/') ? 'audio'
      : 'file',
    texto: texto ?? undefined,
    replyToMid: replyToMid ?? undefined,
  });

  /** Anexo ou nota de voz: mostra-se logo, a partir do ficheiro local. */
  const enviarFicheiro = (file: File) => {
    const item = pendenteDeFicheiro(file);
    setPendentes((ps) => [...ps, item]);
    void enviarPendente(item);
  };

  /** Os mesmos formatos que o clipe deixa escolher (ver `accept` abaixo). */
  const aceitaFicheiro = (file: File) =>
    file.type === 'image/png' || file.type === 'image/jpeg'
    || file.type.startsWith('video/') || file.type.startsWith('audio/')
    || (channelType === 'facebook' && file.type === 'application/pdf');

  /**
   * Ctrl+V com ficheiros na área de transferência (um print, uma imagem
   * copiada): ficam na pré-visualização em vez de se perderem. Devolve true
   * quando tratou o colar; texto cola como sempre.
   */
  const colar = (dados: DataTransfer | null): boolean => {
    const ficheiros = Array.from(dados?.files ?? []);
    if (ficheiros.length === 0) return false;
    const aceites = ficheiros.filter(aceitaFicheiro);
    if (aceites.length < ficheiros.length) {
      toast.error('Formato não suportado', {
        description: channelType === 'facebook'
          ? 'Só imagens PNG ou JPEG, vídeo, áudio ou PDF.'
          : 'Só imagens PNG ou JPEG, vídeo ou áudio.',
      });
    }
    if (aceites.length > 0) {
      setColados((cs) => [
        ...cs,
        ...aceites.map((file) => ({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) })),
      ]);
    }
    return true;
  };

  const tirarColado = (id: string) => {
    const colado = colados.find((c) => c.id === id);
    if (colado) URL.revokeObjectURL(colado.previewUrl);
    setColados((cs) => cs.filter((c) => c.id !== id));
  };

  return (
    <VisualizadorContext.Provider value={contextoVisualizador}>
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b p-3">
        <Button variant="ghost" size="sm" className="lg:hidden" onClick={onBack}>Voltar</Button>
        <ContactAvatar name={conversation.contact_name} url={conversation.contact_avatar_url} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {conversation.contact_name || conversation.contact_ref}
          </p>
          {conversation.window_expires_at && !windowExpired && (
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              Podes responder até {formatDateTime(conversation.window_expires_at)}
            </p>
          )}
        </div>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" title="Painel do contacto" onClick={onOpenContact}>
          <PanelRight className="h-4 w-4" />
        </Button>
      </header>

      <div ref={messageListRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {isLoading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-2/3 rounded-lg" />)
        ) : isError ? (
          /* "Sem mensagens" quando a leitura falhou é enganar o agente: ele
             responde a partir de uma conversa que julga vazia. */
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Não foi possível carregar as mensagens desta conversa.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">Sem mensagens nesta conversa.</p>
        ) : (
          messages.map((m) => {
            const taskText = m.is_deleted ? '' : m.content?.trim();
            return (
            <div key={m.id} className={cn('group/msg flex items-center gap-1', m.direction === 'outgoing' ? 'justify-end' : 'justify-start')}>
              {m.direction === 'outgoing' && onCreateTask && taskText && (
                <TaskFromMessageButton onClick={() => onCreateTask(taskText)} />
              )}
              {/* Reagir. Só faz sentido em mensagens que a Meta conhece pelo id
                  — sem external_id não há a que reagir do lado dela. */}
              {m.direction === 'outgoing' && m.external_id && (
                <>
                  <ReplyButton onClick={() => setReplyTo(m)} />
                  <ReactionPicker
                    channelType={channelType}
                    current={m.reaction}
                    onPick={(emoji) => act.mutate({
                      conversationId: conversation.id,
                      action: emoji ? 'react' : 'unreact',
                      messageExternalId: m.external_id,
                      reaction: emoji ?? undefined,
                    })}
                  />
                </>
              )}
              <div className={cn(
                'relative min-w-0 max-w-[75%] rounded-2xl px-3 py-2 text-sm',
                m.direction === 'outgoing'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground',
              )}>
                {/* Citação da mensagem respondida, como no Instagram. */}
                {m.reply_to_external_id && (
                  <QuotedMessage
                    original={messages.find((o) => o.external_id === m.reply_to_external_id) ?? null}
                    outgoing={m.direction === 'outgoing'}
                  />
                )}
                {m.is_deleted ? (
                  // A pessoa retirou a mensagem. Continuar a mostrá-la seria
                  // responder a algo que ela já não vê do lado dela.
                  <p className="italic opacity-70">Mensagem apagada</p>
                ) : (
                  <>
                    {/* Como no WhatsApp: o ficheiro em cima, a legenda por baixo. */}
                    {m.attachments?.map((a, i) => (
                      <Attachment
                        key={i}
                        type={a.type}
                        url={a.url}
                        // O WhatsApp não manda ficheiro nenhum, manda um id — e
                        // sem estes dois a fotografia de um cliente aparecia
                        // como a palavra "[image]".
                        mediaId={a.media_id ?? null}
                        messageId={m.id}
                        viewerKey={`${m.id}:${i}`}
                        filename={a.filename ?? null}
                        size={a.size ?? null}
                        outgoing={m.direction === 'outgoing'}
                      />
                    ))}
                    {m.content && (
                      <MessageText
                        text={m.content}
                        outgoing={m.direction === 'outgoing'}
                        className={m.attachments?.length ? 'mt-1.5' : undefined}
                      />
                    )}
                  </>
                )}
                <span className={cn(
                  'mt-0.5 flex items-center gap-1 text-[10px]',
                  m.direction === 'outgoing' ? 'text-primary-foreground/70' : 'text-muted-foreground',
                  m.direction === 'outgoing' && 'justify-end',
                )}>
                  {formatRelativeTime(m.sent_at ?? m.created_at)}
                  {/* Entregue / lida / falhada. Só o WhatsApp o diz, e estava
                      guardado na base de dados sem nunca chegar ao ecrã. */}
                  {m.direction === 'outgoing' && m.delivery_status && (
                    <span title={
                      m.delivery_status === 'read' ? 'Lida'
                        : m.delivery_status === 'delivered' ? 'Entregue no telemóvel'
                        : m.delivery_status === 'failed' ? 'Não foi entregue'
                        : 'Enviada'
                    }>
                      <ListStatusTicks status={m.delivery_status} />
                    </span>
                  )}
                </span>
                {m.reaction && (
                  // Colada ao canto inferior, como no Instagram.
                  <span
                    title={m.reaction_by === 'agent' ? 'Reagiste a esta mensagem' : 'Reação do contacto'}
                    className="absolute -bottom-2 -right-1 rounded-full border bg-background px-1 text-xs shadow-sm"
                  >
                    {m.reaction}
                  </span>
                )}
              </div>
              {m.direction === 'incoming' && onCreateTask && taskText && (
                <TaskFromMessageButton onClick={() => onCreateTask(taskText)} />
              )}
              {m.direction === 'incoming' && m.external_id && (
                <>
                  <ReactionPicker
                    channelType={channelType}
                    current={m.reaction}
                    onPick={(emoji) => act.mutate({
                      conversationId: conversation.id,
                      action: emoji ? 'react' : 'unreact',
                      messageExternalId: m.external_id,
                      reaction: emoji ?? undefined,
                    })}
                  />
                  <ReplyButton onClick={() => setReplyTo(m)} />
                </>
              )}
            </div>
            );
          })
        )}

        {/* Já escritas, ainda por confirmar. Ficam esbatidas até a Meta aceitar
            — e se recusar, ficam com o que aconteceu e o que fazer a seguir. */}
        {pendentes.map((p) => (
          <div key={p.id} className="flex justify-end">
            <div className={cn(
              'max-w-[75%] rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground',
              !p.erro && 'opacity-60',
            )}>
              {p.texto && <MessageText text={p.texto} outgoing />}
              {p.previewUrl && p.tipo === 'image' && (
                <img src={p.previewUrl} alt="" className="mt-1 max-h-64 max-w-full rounded-lg" />
              )}
              {p.previewUrl && p.tipo === 'video' && (
                <video src={p.previewUrl} controls className="mt-1 max-h-64 max-w-full rounded-lg" />
              )}
              {p.previewUrl && p.tipo === 'audio' && (
                <audio src={p.previewUrl} controls className="mt-1 max-w-full" />
              )}
              {p.ficheiro && p.tipo === 'file' && (
                <p className="mt-1 text-xs">{p.ficheiro.name}</p>
              )}

              {p.erro ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="font-medium">Não foi enviada</span>
                  <button type="button" onClick={() => void enviarPendente(p)} className="underline">
                    Tentar novamente
                  </button>
                  <button type="button" onClick={() => descartar(p)} className="underline opacity-80">
                    Descartar
                  </button>
                </div>
              ) : (
                <p className="mt-0.5 flex items-center gap-1 text-[10px] text-primary-foreground/70">
                  <Loader2 className="h-3 w-3 animate-spin" /> A enviar…
                </p>
              )}
            </div>
          </div>
        ))}

      </div>

      <footer className="border-t p-3">
        {arquivada ? (
          <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Esta caixa está arquivada. O histórico fica aqui para consulta;
              para voltar a responder, liga a conta outra vez em Definições → Integrações.
            </span>
          </p>
        ) : windowExpired ? (
          // Fora das 24 horas há uma coisa — e uma só — que a Meta aceita: um
          // modelo aprovado, e só no WhatsApp. Nos outros canais não há saída
          // nenhuma, e dizê-lo é melhor do que deixar escrever e falhar depois.
          channelType === 'whatsapp' ? (
            <ModelosWhatsApp
              conversationId={conversation.id}
              channelId={conversation.channel_id}
              contacto={conversation.contact_name || conversation.contact_ref}
            />
          ) : (
            <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              Passaram mais de 24 horas desde a última mensagem desta pessoa. A Meta só permite
              responder dentro desse prazo — poderás voltar a escrever assim que ela enviar
              nova mensagem.
            </p>
          )
        ) : (
          <div className="space-y-2">
          {replyTo && (
            <div className="flex items-start gap-2 rounded-lg border-l-2 border-primary bg-muted/60 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-primary">
                  Responder a {replyTo.direction === 'outgoing' ? 'ti' : (conversation.contact_name || 'contacto')}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {replyTo.content || `[${replyTo.attachments?.[0]?.type ?? 'anexo'}]`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                title="Cancelar resposta"
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {colados.length > 0 && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/40 p-2">
              {colados.map((c) => (
                <div key={c.id} className="relative">
                  {c.file.type.startsWith('image/') ? (
                    <img src={c.previewUrl} alt="" className="h-16 w-16 rounded-md object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-md bg-background px-1 text-[10px] text-muted-foreground">
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="w-full truncate text-center">{c.file.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => tirarColado(c.id)}
                    title="Tirar"
                    className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 text-muted-foreground shadow-sm hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <p className="pb-0.5 text-[11px] text-muted-foreground">
                Enter para enviar{colados.length > 1 ? ` as ${colados.length}` : ''}
              </p>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              // A Meta documenta, para o Instagram, apenas imagem (PNG/JPEG),
              // áudio e vídeo. O PDF é do Messenger — oferecê-lo no Instagram
              // era um botão que dá erro da Meta depois de escolher o ficheiro.
              accept={channelType === 'facebook'
                ? 'image/png,image/jpeg,video/*,audio/*,application/pdf'
                : 'image/png,image/jpeg,video/*,audio/*'}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) enviarFicheiro(f);
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0"
              title={channelType === 'facebook' ? 'Enviar imagem, vídeo, áudio ou PDF' : 'Enviar imagem, vídeo ou áudio'}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Textarea
              value={draft}
              onChange={(e) => { setDraft(e.target.value); sinalizarEscrita(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
              }}
              onPaste={(e) => { if (colar(e.clipboardData)) e.preventDefault(); }}
              placeholder="Escreve a resposta… ou cola uma imagem"
              rows={1}
              className="max-h-32 min-h-[40px] resize-none"
            />
            {/* Como no Instagram: sem texto escrito, o botão grava voz; com
                texto, envia. Um só lugar para "responder", em vez de tratar a
                voz como se fosse um ficheiro qualquer. */}
            {/* `&& !aGravar`: escrever uma letra a meio de uma gravação trocava
                o gravador pelo botão de enviar, e a gravação era interrompida a
                meio — enviando o pedaço já gravado. */}
            {(draft.trim() || colados.length > 0) && !aGravar ? (
              <Button onClick={handleSend} size="icon" className="h-10 w-10 shrink-0">
                <Send className="h-4 w-4" />
              </Button>
            ) : (
              <VoiceRecorder
                onRecordingChange={setAGravar}
                onRecorded={enviarFicheiro}
              />
            )}
          </div>
          </div>
        )}
      </footer>

      {visualizador && (
        <MediaViewer
          items={visualizador.itens}
          index={visualizador.indice}
          onClose={() => setVisualizador(null)}
          onNavigate={(indice) => setVisualizador((v) => (v ? { ...v, indice } : v))}
          onDownload={(item) => { void descarregarImagem(item.url); }}
        />
      )}
    </section>
    </VisualizadorContext.Provider>
  );
}

/**
 * Foto do contacto, com as iniciais como recurso.
 *
 * O endereço da foto vem assinado pela Meta e EXPIRA — por isso o onError não é
 * decoração: quando o link caduca, a imagem falha e sem isto ficava um quadrado
 * partido. Cai nas iniciais, que funcionam sempre.
 */
function ContactAvatar({ name, url }: { name: string | null; url: string | null }) {
  const [failed, setFailed] = useState(false);
  const label = (name ?? '').replace(/^@/, '');
  const initials = label
    ? label.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
    : '?';

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={label || 'Contacto'}
        onError={() => setFailed(true)}
        className="h-9 w-9 shrink-0 rounded-full object-cover"
        loading="lazy"
      />
    );
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
      {initials}
    </span>
  );
}

/**
 * Extrai o tipo e o código de uma publicação/Reel do Instagram.
 *
 * O tipo importa: o incorporador usava sempre `/reel/`, e uma FOTO partilhada
 * ficava com um endereço de reel — uma caixa em branco de 560px.
 */
function instagramCode(url: string): { seg: string; code: string } | null {
  const m = url.match(/instagram\.com\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  if (!m) return null;
  return { seg: m[1] === 'reels' ? 'reel' : m[1], code: m[2] };
}

/**
 * Desenha o anexo conforme o que ele é.
 *
 * A Meta manda tipos diferentes e antes tratava-os todos como "Anexo" com um
 * link — obrigando a sair do CRM para ver uma imagem que já vinha pronta a
 * mostrar.
 *
 * Reels e publicações partilhadas não vêm com ficheiro: vêm com o endereço do
 * post. Para esses usa-se o incorporador público do Instagram, que não precisa
 * de API nem de permissões — mas só funciona com contas/publicações públicas,
 * por isso há sempre o link por baixo.
 *
 * Nota sobre imagens e vídeos: os endereços do CDN da Meta são assinados e
 * EXPIRAM. Enquanto a conversa é recente mostram-se; mais tarde deixam de
 * abrir, e por isso o link fica sempre disponível como alternativa.
 */
/** O nome de um ficheiro tirado do endereço, sem o prefixo único que o upload lhe pôs. */
function nomeDoLink(url: string): string | null {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    const sem = last
      .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '')
      .replace(/^\d{10,}-/, '');
    // O upload troca espaços e acentos por "_"; para ler, voltam a ser espaços.
    return sem ? sem.replace(/_/g, ' ') : null;
  } catch {
    return null;
  }
}

function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} MB`;
}

/**
 * Um documento como no WhatsApp: ícone com a cor do tipo, nome, tipo e
 * tamanho. Clicar abre-o (o PDF no leitor do browser) ou transfere-o.
 */
function CartaoDocumento({ url, filename, size, outgoing }: {
  url: string;
  filename?: string | null;
  size?: number | null;
  outgoing?: boolean;
}) {
  const nome = filename || nomeDoLink(url) || 'Documento';
  const ext = nome.includes('.') ? nome.split('.').pop()!.toLowerCase() : '';
  const detalhe = [ext ? ext.toUpperCase() : null, size ? tamanhoLegivel(size) : null].filter(Boolean).join(' · ');
  const [mime, setMime] = useState('');
  useEffect(() => {
    setMime('');
    if (!url.startsWith('blob:') || isPdfDocument(nome)) return;
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal }).then(response => {
      setMime(response.headers.get('content-type') ?? '');
      void response.body?.cancel();
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name !== 'AbortError') setMime('');
    });
    return () => controller.abort();
  }, [url, nome]);
  if (isPdfDocument(nome, mime)) {
    return <PdfDocumentCard url={url} filename={nome} detail={detalhe} outgoing={outgoing} />;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      download={nome}
      title={`Abrir ${nome}`}
      className={cn(
        'mt-1 flex w-72 max-w-full items-center gap-3 rounded-xl p-2.5 transition-colors',
        outgoing ? 'bg-primary-foreground/15 hover:bg-primary-foreground/25' : 'bg-background/80 hover:bg-background',
      )}
    >
      <FileTypeIcon extension={ext} />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 break-words text-sm font-medium leading-snug">{nome}</span>
        {detalhe && <span className="mt-0.5 block text-[11px] opacity-70">{detalhe}</span>}
      </span>
      <Download className="h-4 w-4 shrink-0 opacity-70" />
    </a>
  );
}

function Attachment({ type, url, mediaId, messageId, viewerKey, filename, size, outgoing }: {
  type: string;
  url: string | null;
  /** WhatsApp: o id do ficheiro na Meta, quando não há endereço. */
  mediaId?: string | null;
  messageId?: string;
  /** Mensagem e posição do anexo — o que o visualizador usa para o encontrar. */
  viewerKey?: string;
  filename?: string | null;
  size?: number | null;
  /** Dentro de uma bolha enviada (azul): o cartão do documento acompanha a cor. */
  outgoing?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const visualizador = useContext(VisualizadorContext);

  // A imagem já carregada fica conhecida do visualizador, para as setas
  // passarem por ela mesmo sem nunca ter sido clicada.
  useEffect(() => {
    if (type === 'image' && url && viewerKey) visualizador?.registar(viewerKey, url);
  }, [type, url, viewerKey, visualizador]);

  // O WhatsApp não manda o ficheiro — manda um id que só se resolve com o token
  // da conta, do lado do servidor. Sem este ramo, tudo o que um cliente
  // enviasse por WhatsApp aparecia como o nome do tipo entre parênteses.
  if (!url && mediaId && messageId) {
    return (
      <AnexoWhatsApp
        type={type}
        mediaId={mediaId}
        messageId={messageId}
        viewerKey={viewerKey}
        filename={filename}
        size={size}
        outgoing={outgoing}
      />
    );
  }

  if (!url) return <span className="text-xs opacity-70">[{type}]</span>;

  const ig = instagramCode(url);
  // `share` foi retirado pela Meta em fevereiro de 2026 e substituído por
  // `ig_post`. Sem o novo nome, uma publicação partilhada caía no ramo genérico
  // e aparecia como "Anexo" com um link.
  const isShare = type === 'ig_reel' || type === 'ig_post' || type === 'share' || !!ig;

  if (isShare && ig && !broken) {
    return <InstagramEmbed seg={ig.seg} code={ig.code} url={url} onBroken={() => setBroken(true)} />;
  }

  if (type === 'image' && !broken) {
    // Abre no visualizador em ecrã inteiro, como no WhatsApp Web. Antes era um
    // link para o ficheiro num separador novo — e a imagem do WhatsApp, que é
    // um ficheiro local do browser, abria numa aba sem nada à volta.
    return (
      <button
        type="button"
        title="Abrir imagem"
        onClick={() => {
          if (visualizador && viewerKey) visualizador.abrir(viewerKey, url);
          else window.open(url, '_blank', 'noopener');
        }}
        className="mt-1 block cursor-zoom-in"
      >
        <img
          src={url}
          alt="Imagem recebida"
          onError={() => setBroken(true)}
          className="max-h-64 max-w-full rounded-lg object-cover"
          loading="lazy"
        />
      </button>
    );
  }

  // Um autocolante é uma imagem pequena, sem visualizador.
  if (type === 'sticker' && !broken) {
    return <img src={url} alt="Autocolante" onError={() => setBroken(true)} className="mt-1 h-32 w-32 object-contain" loading="lazy" />;
  }

  if (type === 'image' && broken) {
    // O ficheiro saiu do armazenamento (ou o link da Meta caducou): dizê-lo em
    // vez de oferecer um link que não abre.
    return (
      <span className="mt-1 flex items-center gap-1.5 rounded-lg bg-black/5 px-2.5 py-2 text-xs opacity-80">
        <ImageOff className="h-3.5 w-3.5 shrink-0" /> A imagem já não está disponível
      </span>
    );
  }

  if ((type === 'document' || type === 'file') && !broken) {
    return <CartaoDocumento url={url} filename={filename} size={size} outgoing={outgoing} />;
  }

  if ((type === 'video' || type === 'audio') && !broken) {
    const Tag = type === 'video' ? 'video' : 'audio';
    return (
      <Tag
        src={url}
        controls
        onError={() => setBroken(true)}
        className={cn('mt-1 max-w-full rounded-lg', type === 'video' && 'max-h-64')}
      />
    );
  }

  const rotulo = type === 'image' ? 'Imagem'
    : type === 'video' ? 'Vídeo'
    : type === 'audio' ? 'Áudio'
    : type === 'story_mention' ? 'Menção em story'
    : type === 'story_reply' ? 'Resposta a um story'
    : isShare ? 'Publicação do Instagram'
    : 'Anexo';

  return (
    <a href={url} target="_blank" rel="noreferrer" className="mt-1 block text-xs underline">
      {rotulo}{broken ? ' (já não abre aqui)' : ''}
    </a>
  );
}

/**
 * Um ficheiro do WhatsApp: pede-se ao servidor e mostra-se.
 *
 * Fica em componente próprio por causa das regras dos hooks — o `Attachment`
 * decide o que desenhar depois de vários `return`, e um hook não pode viver
 * atrás de um deles.
 *
 * Só se descarrega o que está à vista: `loading="lazy"` não serve aqui (não é
 * um `<img src>` normal), por isso quem tem uma conversa com cem fotografias
 * paga cem pedidos ao abrir. É aceitável porque cada um deles é servido com
 * cache de uma hora — mas é o sítio óbvio para pôr um observador de
 * visibilidade se algum dia se notar.
 */
function AnexoWhatsApp({ type, mediaId, messageId, viewerKey, filename, size, outgoing }: {
  type: string;
  mediaId: string;
  messageId: string;
  viewerKey?: string;
  filename?: string | null;
  size?: number | null;
  outgoing?: boolean;
}) {
  const { url, erro, aCarregar } = useMetaMedia(messageId, mediaId);

  if (aCarregar) {
    return (
      <span className="mt-1 flex items-center gap-1.5 text-xs opacity-70">
        <Loader2 className="h-3 w-3 animate-spin" /> A carregar o ficheiro…
      </span>
    );
  }

  if (erro || !url) {
    // Dizer o que aconteceu, e não só que não dá: o caso comum é a Meta já ter
    // deitado fora o ficheiro, e isso não é uma avaria do CRM.
    return (
      <span className="mt-1 block text-xs opacity-70">
        [{type}] {erro ?? 'não foi possível abrir'}
      </span>
    );
  }

  return (
    <Attachment type={type} url={url} viewerKey={viewerKey} filename={filename} size={size} outgoing={outgoing} />
  );
}

/**
 * Modelos aprovados — a única saída de uma conversa fora das 24 horas.
 *
 * PORQUE É QUE ISTO EXISTE
 *
 * Passado o prazo, a Meta recusa qualquer texto livre. Até aqui o compositor
 * dizia isso e mais nada: a conversa ficava um beco sem saída, e a tabela de
 * modelos existia na base de dados sem nunca ter sido preenchida por ninguém.
 *
 * Um modelo tem variáveis ({{1}}, {{2}}, …) que a Meta exige preenchidas pela
 * ordem certa — nem uma a mais nem uma a menos. O formulário é gerado a partir
 * dos componentes que ela devolveu, para não haver adivinhação.
 */
function ModelosWhatsApp({ conversationId, channelId, contacto }: {
  conversationId: string;
  channelId: string;
  contacto: string;
}) {
  const { data: modelos = [], isLoading } = useWhatsAppTemplates(channelId);
  const sincronizar = useSyncWhatsAppTemplates();
  const enviar = useSendWhatsAppTemplate();
  const [escolhido, setEscolhido] = useState<WhatsAppTemplate | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});

  // O corpo e o cabeçalho do modelo escolhido, e quantas variáveis cada um
  // tem. `{{1}}` repetido conta uma vez — é a mesma variável.
  const partes = useMemo(() => {
    const comp = (t: string) =>
      escolhido?.components?.find((c) => c.type?.toUpperCase() === t);
    const contar = (texto?: string) => {
      const nums = [...(texto ?? '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      return nums.length ? Math.max(...nums) : 0;
    };
    const corpo = comp('BODY')?.text ?? '';
    const cabecalho = comp('HEADER');
    // Só cabeçalhos de TEXTO levam variáveis por aqui; os de imagem ou
    // documento precisam de um ficheiro, que é outra conversa.
    const cabTexto = cabecalho?.format?.toUpperCase() === 'TEXT' ? (cabecalho.text ?? '') : '';
    return { corpo, nCorpo: contar(corpo), cabTexto, nCab: contar(cabTexto) };
  }, [escolhido]);

  /** O texto final, como a pessoa o vai ler. */
  const preencher = (texto: string, prefixo: string) =>
    texto.replace(/\{\{(\d+)\}\}/g, (_m, n) => valores[`${prefixo}${n}`] || `{{${n}}}`);

  const porPreencher = [
    ...Array.from({ length: partes.nCab }, (_, i) => `h${i + 1}`),
    ...Array.from({ length: partes.nCorpo }, (_, i) => `b${i + 1}`),
  ].filter((k) => !valores[k]?.trim());

  const submeter = () => {
    if (!escolhido || porPreencher.length > 0) return;
    enviar.mutate({
      conversationId,
      name: escolhido.name,
      language: escolhido.language,
      variables: {
        header: Array.from({ length: partes.nCab }, (_, i) => valores[`h${i + 1}`] ?? ''),
        body: Array.from({ length: partes.nCorpo }, (_, i) => valores[`b${i + 1}`] ?? ''),
      },
      preview: preencher(partes.corpo, 'b'),
    }, {
      onSuccess: () => {
        toast.success('Modelo enviado', {
          description: `${contacto} recebe a mensagem e a conversa reabre quando responder.`,
        });
        setEscolhido(null);
        setValores({});
      },
      onError: (e) => toast.error('Não foi enviado', { description: (e as Error).message }),
    });
  };

  return (
    <div className="space-y-2 rounded-lg bg-muted p-3">
      <p className="text-xs text-muted-foreground">
        Passaram mais de 24 horas desde a última mensagem de {contacto}. Fora desse prazo o
        WhatsApp só entrega <strong>modelos aprovados pela Meta</strong>.
      </p>

      {isLoading ? (
        <Skeleton className="h-9 w-full" />
      ) : modelos.length === 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">
            Ainda não há modelos aprovados guardados para esta caixa.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={sincronizar.isPending}
            onClick={() => sincronizar.mutate(channelId, {
              onSuccess: (r) => toast.success(
                r.aprovados > 0
                  ? `${r.aprovados} modelo(s) aprovado(s) encontrado(s).`
                  : 'A Meta não devolveu nenhum modelo aprovado para esta conta.',
              ),
              onError: (e) => toast.error('Não foi possível sincronizar', {
                description: (e as Error).message,
              }),
            })}
          >
            {sincronizar.isPending
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <RefreshCw className="h-3 w-3" />}
            Ir buscar à Meta
          </Button>
        </div>
      ) : !escolhido ? (
        <div className="flex flex-wrap gap-1.5">
          {modelos.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => { setEscolhido(m); setValores({}); }}
              className="flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs hover:bg-accent"
            >
              <FileText className="h-3 w-3" />
              {m.name}
              <span className="opacity-60">{m.language}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold">{escolhido.name}</p>
            <button
              type="button"
              onClick={() => { setEscolhido(null); setValores({}); }}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Escolher outro modelo"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {[
            ...Array.from({ length: partes.nCab }, (_, i) => ({ k: `h${i + 1}`, n: i + 1, onde: 'Cabeçalho' })),
            ...Array.from({ length: partes.nCorpo }, (_, i) => ({ k: `b${i + 1}`, n: i + 1, onde: 'Corpo' })),
          ].map(({ k, n, onde }) => (
            <Input
              key={k}
              value={valores[k] ?? ''}
              onChange={(e) => setValores((v) => ({ ...v, [k]: e.target.value }))}
              placeholder={`${onde} — variável ${n}`}
              className="h-8 text-xs"
            />
          ))}

          {/* O que vai ser mesmo enviado. Um modelo com variáveis por preencher
              lê-se muito mal em bruto, e o erro só apareceria depois de enviar. */}
          {/* Cada parte com o seu prefixo: as variáveis do cabeçalho e as do
              corpo são numeradas a partir de 1 as duas, e juntá-las numa só
              substituição trocava o texto de sítio. */}
          <p className="whitespace-pre-wrap rounded-lg bg-background p-2 text-xs">
            {partes.cabTexto && (
              <span className="block font-semibold">{preencher(partes.cabTexto, 'h')}</span>
            )}
            {preencher(partes.corpo, 'b')}
          </p>

          <Button
            size="sm"
            className="h-8 w-full gap-1.5 text-xs"
            disabled={porPreencher.length > 0 || enviar.isPending}
            onClick={submeter}
          >
            {enviar.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Send className="h-3.5 w-3.5" />}
            {porPreencher.length > 0
              ? `Faltam ${porPreencher.length} campo(s)`
              : 'Enviar modelo'}
          </Button>
        </div>
      )}
    </div>
  );
}

/** As reações que o Instagram aceita na aplicação. */
// O Instagram só reconhece UMA reação: o coração. Mostrar as outras seis era
// oferecer seis botões dos quais cinco davam erro da Meta em cima da conversa.
// No Messenger existem mesmo todas.
const REACOES_MESSENGER = ['❤️', '😂', '😮', '😢', '😡', '👍'];
const REACOES_INSTAGRAM = ['❤️'];

/**
 * Escolher (ou tirar) a reação a uma mensagem.
 *
 * Aparece ao passar o rato — colar seis emojis a cada linha da conversa
 * tornaria a leitura impossível.
 */
function ReactionPicker({
  current,
  channelType,
  onPick,
}: {
  current: string | null;
  channelType?: string;
  onPick: (emoji: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const reacoes = channelType === 'facebook' ? REACOES_MESSENGER : REACOES_INSTAGRAM;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Reagir"
        className={cn(
          'rounded-full p-1 text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground',
          open ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100',
        )}
      >
        <SmilePlus className="h-3.5 w-3.5" />
      </button>

      {open && (
        <>
          {/* Fecha ao clicar fora, sem prender o clique dentro do seletor. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-1/2 z-20 mb-1 flex -translate-x-1/2 gap-0.5 rounded-full border bg-popover p-1 shadow-md">
            {reacoes.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => { onPick(current === e ? null : e); setOpen(false); }}
                className={cn(
                  'rounded-full px-1 text-base leading-none transition-transform hover:scale-125',
                  current === e && 'bg-accent',
                )}
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Publicação do Instagram incorporada, sem barra de scroll.
 *
 * Uma altura fixa nunca serve: o incorporador traz cabeçalho, vídeo e legenda, e
 * cada publicação tem um tamanho diferente — foi por isso que 400px cortava o
 * Reel e 9:16 continuava a deixar scroll.
 *
 * O próprio Instagram resolve isto: a página incorporada envia à janela-mãe a
 * altura de que precisa, com `{"type":"MEASURE","details":{"height":N}}`. É o
 * mecanismo que o script oficial deles usa para redimensionar. Ouve-se essa
 * mensagem e ajusta-se — assim cabe sempre, seja qual for a publicação.
 */
function InstagramEmbed({
  seg,
  code,
  url,
  onBroken,
}: {
  seg: string;
  code: string;
  url: string;
  onBroken: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Altura inicial só para não saltar antes de a medição chegar.
  const [height, setHeight] = useState(560);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!event.origin.includes('instagram.com')) return;
      // Só mensagens deste iframe: a conversa pode ter vários incorporados.
      if (frameRef.current && event.source !== frameRef.current.contentWindow) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        const h = Number(data?.details?.height);
        if (data?.type === 'MEASURE' && Number.isFinite(h) && h > 0) setHeight(Math.ceil(h));
      } catch { /* nem tudo o que o Instagram envia é a medição */ }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="mt-1 overflow-hidden rounded-lg bg-background">
      <iframe
        ref={frameRef}
        src={`https://www.instagram.com/${seg}/${code}/embed`}
        title="Publicação do Instagram"
        style={{ height }}
        // scrolling="no" evita a barra no intervalo entre montar e medir.
        scrolling="no"
        className="w-full max-w-[340px] border-0"
        loading="lazy"
        allowFullScreen
        onError={onBroken}
      />
      <a href={url} target="_blank" rel="noreferrer" className="block px-2 py-1 text-[11px] underline opacity-80">
        Abrir no Instagram
      </a>
    </div>
  );
}

/**
 * Gravar uma mensagem de voz e enviá-la.
 *
 * Sobre o formato: o MediaRecorder de cada browser grava no que lhe apetece, e a
 * Meta só aceita alguns. Tenta-se por ordem de compatibilidade (MP4/AAC primeiro,
 * que é o mais universal; OGG e WEBM a seguir) em vez de assumir um — o Safari
 * não grava WEBM e o Chrome não grava MP4 em todas as versões.
 */
const FORMATOS_AUDIO = [
  { mime: 'audio/mp4', ext: 'm4a' },
  { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
  { mime: 'audio/webm;codecs=opus', ext: 'webm' },
  { mime: 'audio/webm', ext: 'webm' },
];

function VoiceRecorder({
  onRecorded,
  onRecordingChange,
  disabled,
}: {
  onRecorded: (file: File) => void;
  onRecordingChange?: (a: boolean) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recordingRef = useRef<{ recorder: MediaRecorder; cancelled: boolean } | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const tickRef = useRef<number | null>(null);

  // Largar o microfone e o contador se o componente sair a meio de uma gravação
  // — senão o browser fica com a luz do micro acesa indefinidamente.
  //
  // O buffer é limpo PRIMEIRO. Parar as pistas do stream faz o MediaRecorder
  // disparar `onstop`, e o `onstop` envia: sem esta linha, desmontar a meio de
  // uma gravação mandava ao cliente meio áudio que ninguém pediu, sem sequer
  // aparecer na conversa.
  useEffect(() => () => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    const active = recordingRef.current;
    if (active) active.cancelled = true;
    chunksRef.current = [];
    active?.recorder.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const começar = async () => {
    const formato = FORMATOS_AUDIO.find((f) => MediaRecorder.isTypeSupported(f.mime));
    if (!formato) {
      toast.error('O teu browser não permite gravar áudio.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: formato.mime });
      const active = { recorder: rec, cancelled: false };
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (!active.cancelled && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: formato.mime });
        // Gravações de menos de um segundo são quase sempre um toque acidental.
        if (shouldDeliverVoiceRecording({ cancelled: active.cancelled, byteLength: blob.size })) {
          onRecorded(new File([blob], `voz-${Date.now()}.${formato.ext}`, { type: formato.mime }));
        }
        chunksRef.current = [];
      };
      rec.start();
      recordingRef.current = active;
      setRecording(true);
      onRecordingChange?.(true);
      setSeconds(0);
      tickRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      toast.error('Sem acesso ao microfone', {
        description: 'Autoriza o microfone para este site nas definições do browser.',
      });
    }
  };

  const parar = (enviar: boolean) => {
    if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
    const active = recordingRef.current;
    if (!active) return;
    if (!enviar) active.cancelled = true;
    active.recorder.stop();
    recordingRef.current = null;
    setRecording(false);
    onRecordingChange?.(false);
  };

  if (recording) {
    return (
      <div className="flex h-10 shrink-0 items-center gap-1 rounded-md bg-destructive/10 px-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
        <span className="text-xs font-medium tabular-nums text-destructive">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Cancelar" onClick={() => parar(false)}>
          <X className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" className="h-7 w-7" title="Enviar" onClick={() => parar(true)}>
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-10 w-10 shrink-0"
      title="Gravar mensagem de voz"
      disabled={disabled}
      onClick={começar}
    >
      <Mic className="h-4 w-4" />
    </Button>
  );
}

function TaskFromMessageButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      title="Criar tarefa a partir desta mensagem"
      aria-label="Criar tarefa a partir desta mensagem"
      className="h-10 w-10 shrink-0 rounded-full text-muted-foreground lg:h-8 lg:w-8"
    >
      <ClipboardList className="h-4 w-4" />
    </Button>
  );
}

/** Botão de responder a uma mensagem. Aparece ao passar o rato, como o de reagir. */
function ReplyButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Responder a esta mensagem"
      className="shrink-0 rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/msg:opacity-100"
    >
      <Reply className="h-3.5 w-3.5" />
    </button>
  );
}

/**
 * A mensagem citada dentro da bolha.
 *
 * `original` pode vir nulo: responde-se a mensagens antigas que já não estão
 * carregadas na conversa, e a citação não pode desaparecer só por isso — mostra
 * que houve uma resposta, mesmo sem conseguir mostrar a quê.
 */
function QuotedMessage({
  original,
  outgoing,
}: {
  original: MetaMessage | null;
  outgoing: boolean;
}) {
  return (
    <div className={cn(
      'mb-1 border-l-2 pl-2 text-xs',
      outgoing ? 'border-primary-foreground/40 text-primary-foreground/75' : 'border-primary/40 text-muted-foreground',
    )}>
      {original
        ? <p className="line-clamp-2 break-words">
            {original.content || `[${original.attachments?.[0]?.type ?? 'anexo'}]`}
          </p>
        : <p className="italic opacity-70">mensagem anterior</p>}
    </div>
  );
}
