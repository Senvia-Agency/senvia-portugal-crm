import { format } from 'date-fns';
import { Check, CheckCheck, Copy, CornerUpLeft, Download, FileText, Forward, Loader2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { reactionEmojis } from '@/features/workplace/feed/recognition-types';
import { duration, fileSize, messageSummary } from './chat-format';
import type { ChatMessage } from './chat-model';
import { useChatFileUrl } from './useChat';
import { PersonAvatar } from './ChatAvatar';

export interface ReactionGroup { readonly emoji: string; readonly userIds: readonly string[] }

interface Props {
  readonly message: ChatMessage;
  readonly mine: boolean;
  readonly showSender: boolean;
  readonly senderName: string;
  readonly senderAvatar: string | null;
  readonly replied: ChatMessage | null;
  readonly repliedName: string;
  readonly reactions: readonly ReactionGroup[];
  readonly myUserId: string;
  readonly nameFor: (id: string) => string;
  /** 1:1 only: whether the other person has read up to this message. */
  readonly seen: boolean | null;
  readonly highlighted: boolean;
  readonly onReply: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onForward: () => void;
  readonly onReact: (emoji: string, on: boolean) => void;
  readonly onJump: (messageId: string) => void;
}

function Attachment({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const attachment = message.attachment!;
  const url = useChatFileUrl(attachment.path);
  if (message.kind === 'image') {
    return url.data
      ? <a href={url.data} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl"><img src={url.data} alt={attachment.name} className="max-h-72 w-full max-w-[18rem] object-cover" /></a>
      : <div className="flex h-40 w-64 max-w-full items-center justify-center rounded-xl bg-black/5"><Loader2 className="h-5 w-5 animate-spin opacity-60" /></div>;
  }
  if (message.kind === 'audio') {
    return <div className="flex min-w-[14rem] items-center gap-2">
      {url.data ? <audio controls preload="metadata" src={url.data} className="h-10 w-full max-w-[16rem]" /> : <Loader2 className="h-4 w-4 animate-spin" />}
      {attachment.durationSec != null && <span className="shrink-0 text-[11px] opacity-75">{duration(attachment.durationSec)}</span>}
    </div>;
  }
  return <a href={url.data} download={attachment.name} target="_blank" rel="noopener noreferrer" aria-disabled={!url.data}
    className={cn('flex min-w-[13rem] max-w-[18rem] items-center gap-3 rounded-xl px-3 py-2.5', mine ? 'bg-white/15 hover:bg-white/20' : 'bg-muted hover:bg-muted/70')}>
    <FileText className="h-8 w-8 shrink-0 opacity-80" aria-hidden="true" />
    <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-semibold">{attachment.name}</span><span className="block text-[11.5px] opacity-75">{fileSize(attachment.size)}</span></span>
    <Download className="h-4 w-4 shrink-0 opacity-75" aria-hidden="true" />
  </a>;
}

export function MessageBubble(props: Props) {
  const { message, mine, showSender, senderName, senderAvatar, replied, reactions, myUserId, seen } = props;
  const deleted = !!message.deletedAt;
  const time = format(new Date(message.createdAt), 'HH:mm');
  const copy = () => { void navigator.clipboard.writeText(message.body ?? '').then(() => toast.success('Mensagem copiada')); };
  return <div id={`chat-message-${message.id}`} className={cn('chat-message group flex items-end gap-2', mine ? 'flex-row-reverse' : 'flex-row', showSender ? 'mt-3' : 'mt-0.5')}>
    {!mine && <span className="w-8 shrink-0">{showSender && <PersonAvatar name={senderName} url={senderAvatar} size={32} />}</span>}
    <div className={cn('flex min-w-0 max-w-[min(32rem,78%)] flex-col', mine ? 'items-end' : 'items-start')}>
      {showSender && !mine && <span className="mb-0.5 ml-1 text-[12px] font-semibold text-muted-foreground">{senderName}</span>}
      <div className="flex max-w-full items-center gap-1">
        <div className={cn('chat-bubble min-w-0 max-w-full rounded-2xl px-3 py-2 text-[14.5px] leading-relaxed', mine ? 'chat-bubble--mine rounded-br-md' : 'chat-bubble--theirs rounded-bl-md',
          deleted && 'chat-bubble--deleted', props.highlighted && 'chat-bubble--highlight')}>
          {message.forwarded && !deleted && <p className="mb-1 flex items-center gap-1 text-[11.5px] italic opacity-75"><Forward className="h-3 w-3" aria-hidden="true" />Reencaminhada</p>}
          {replied && !deleted && <button type="button" onClick={() => props.onJump(replied.id)}
            className={cn('mb-1.5 block w-full rounded-lg border-l-[3px] px-2 py-1 text-left text-[12.5px]', mine ? 'border-white/70 bg-white/15' : 'border-primary bg-primary/[.06]')}>
            <span className="block font-semibold">{props.repliedName}</span>
            <span className="line-clamp-2 opacity-80">{messageSummary({ ...replied, attachmentName: replied.attachment?.name })}</span>
          </button>}
          {deleted ? <p className="italic opacity-70">Mensagem eliminada</p> : <>
            {message.attachment && <div className={cn(message.body && 'mb-1.5')}><Attachment message={message} mine={mine} /></div>}
            {message.body && <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.body}</p>}
          </>}
          <span className={cn('mt-0.5 flex items-center justify-end gap-1 text-[10.5px]', mine ? 'text-white/75' : 'text-muted-foreground')}>
            {message.editedAt && !deleted && <span>editada ·</span>}
            <time dateTime={message.createdAt}>{time}</time>
            {mine && seen !== null && (seen ? <CheckCheck className="h-3.5 w-3.5 text-sky-200" aria-label="Vista" /> : <Check className="h-3.5 w-3.5" aria-label="Enviada" />)}
          </span>
        </div>
        {!deleted && <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Ações da mensagem" className="chat-message-actions flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={mine ? 'end' : 'start'} className="w-56">
            <div className="flex justify-between px-1 py-1" role="group" aria-label="Reagir">
              {reactionEmojis.map(emoji => {
                const on = reactions.some(group => group.emoji === emoji && group.userIds.includes(myUserId));
                return <DropdownMenuItem key={emoji} aria-label={`Reagir com ${emoji}`} onSelect={() => props.onReact(emoji, !on)}
                  className={cn('h-8 w-6 justify-center p-0 text-lg', on && 'bg-primary/10')}>{emoji}</DropdownMenuItem>;
              })}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={props.onReply}><CornerUpLeft className="mr-2 h-4 w-4" />Responder</DropdownMenuItem>
            {message.body && <DropdownMenuItem onSelect={copy}><Copy className="mr-2 h-4 w-4" />Copiar texto</DropdownMenuItem>}
            <DropdownMenuItem onSelect={props.onForward}><Forward className="mr-2 h-4 w-4" />Reencaminhar</DropdownMenuItem>
            {mine && message.kind === 'text' && <DropdownMenuItem onSelect={props.onEdit}><Pencil className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>}
            {mine && <DropdownMenuItem onSelect={props.onDelete} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Eliminar</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
      {reactions.length > 0 && <div className={cn('mt-1 flex flex-wrap gap-1', mine ? 'justify-end' : 'justify-start')}>
        {reactions.map(group => {
          const on = group.userIds.includes(myUserId);
          return <button key={group.emoji} type="button" aria-pressed={on} title={group.userIds.map(props.nameFor).join(', ')}
            aria-label={`${group.emoji} ${group.userIds.length}, ${on ? 'retirar a sua reação' : 'reagir também'}`} onClick={() => props.onReact(group.emoji, !on)}
            className={cn('flex h-6 items-center gap-1 rounded-full border px-1.5 text-[12px] font-semibold transition-colors', on ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card hover:bg-muted')}>
            <span aria-hidden="true">{group.emoji}</span>{group.userIds.length}
          </button>;
        })}
      </div>}
    </div>
  </div>;
}
