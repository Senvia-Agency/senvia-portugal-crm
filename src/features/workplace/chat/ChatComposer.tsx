import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Mic, Paperclip, Pencil, CornerUpLeft, Send, Square, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmojiComposer } from '@/components/inbox/EmojiComposer';
import { cn } from '@/lib/utils';
import { editMessage, sendAttachment, sendText } from './chat-api';
import { duration, fileSize, messageSummary } from './chat-format';
import { CHAT_ACCEPT, CHAT_MAX_FILE_BYTES, CHAT_MESSAGE_MAX, isAcceptedFile, type ChatMessage } from './chat-model';
import { useVoiceRecorder } from './useChat';

interface Props {
  readonly conversationId: string;
  readonly userId: string;
  readonly replyTo: ChatMessage | null;
  readonly replyName: string;
  readonly editing: ChatMessage | null;
  readonly incomingFiles: readonly File[];
  readonly onIncomingTaken: () => void;
  readonly onCancelReply: () => void;
  readonly onCancelEdit: () => void;
  readonly onSent: () => void;
  readonly onTyping: () => void;
  readonly describeError: (error: unknown) => string;
}

const draftKey = (conversationId: string) => `workplace-chat-draft:${conversationId}`;
function readDraft(conversationId: string) {
  try { return localStorage.getItem(draftKey(conversationId)) ?? ''; } catch { return ''; }
}
function writeDraft(conversationId: string, text: string) {
  try { if (text) localStorage.setItem(draftKey(conversationId), text); else localStorage.removeItem(draftKey(conversationId)); } catch { /* The draft stays on screen. */ }
}

/** Keeps only files the bucket accepts, telling the person why the others were left out. */
export function acceptFiles(files: readonly File[]) {
  const accepted = files.filter(file => isAcceptedFile(file) && file.size <= CHAT_MAX_FILE_BYTES);
  const refused = files.length - accepted.length;
  if (refused > 0) toast.error(refused === 1 ? 'Um ficheiro não foi adicionado' : `${refused} ficheiros não foram adicionados`, { description: 'Imagens, PDF, Office, texto, ZIP ou áudio, até 25 MB.' });
  return accepted;
}

export function ChatComposer(props: Props) {
  const { conversationId, userId, replyTo, editing } = props;
  const [text, setText] = useState(() => readDraft(conversationId));
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorder = useVoiceRecorder();

  useEffect(() => { if (!editing) writeDraft(conversationId, text); }, [conversationId, text, editing]);
  useEffect(() => {
    if (editing) { setText(editing.body ?? ''); composerRef.current?.focus(); }
  }, [editing]);
  useEffect(() => { if (replyTo) composerRef.current?.focus(); }, [replyTo]);
  // Files dropped on the conversation join the ones already chosen.
  const { incomingFiles, onIncomingTaken } = props;
  useEffect(() => {
    if (incomingFiles.length === 0) return;
    setFiles(current => [...current, ...acceptFiles(incomingFiles)]);
    onIncomingTaken();
  }, [incomingFiles, onIncomingTaken]);

  const canSend = !sending && (editing ? !!text.trim() && text.trim() !== editing.body : !!text.trim() || files.length > 0);

  async function send() {
    if (!canSend) return;
    setSending(true);
    try {
      if (editing) {
        await editMessage(editing.id, text.trim());
        props.onCancelEdit();
        setText(readDraft(conversationId));
      } else {
        const body = text.trim();
        if (files.length > 0) {
          for (const [index, file] of files.entries()) {
            await sendAttachment(conversationId, userId, file, { replyToId: index === 0 ? replyTo?.id : null, caption: index === 0 ? body : undefined });
          }
        } else {
          await sendText(conversationId, userId, body, replyTo?.id ?? null);
        }
        setText(''); setFiles([]); props.onCancelReply();
      }
      props.onSent();
      composerRef.current?.focus();
    } catch (error) {
      toast.error('Mensagem não enviada', { description: `${props.describeError(error)} O texto foi mantido.` });
    } finally {
      setSending(false);
    }
  }

  async function toggleRecording() {
    if (!recorder.recording) {
      try { await recorder.start(); } catch { toast.error('Sem acesso ao microfone', { description: 'Autorize o microfone no browser para gravar notas de voz.' }); }
      return;
    }
    const note = await recorder.stop();
    if (!note) return;
    setSending(true);
    try {
      await sendAttachment(conversationId, userId, note.file, { replyToId: replyTo?.id ?? null, durationSec: note.durationSec });
      props.onCancelReply(); props.onSent();
    } catch (error) {
      toast.error('Nota de voz não enviada', { description: props.describeError(error) });
    } finally {
      setSending(false);
    }
  }

  return <div className="chat-composer border-t bg-card/80 px-3 pb-3 pt-2">
    {(replyTo || editing) && <div className="mb-2 flex items-center gap-2 rounded-xl border-l-[3px] border-primary bg-primary/[.06] px-3 py-2 text-[13px]">
      {editing ? <Pencil className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : <CornerUpLeft className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{editing ? 'Editar mensagem' : `Responder a ${props.replyName}`}</span>
        <span className="block truncate text-muted-foreground">{messageSummary({ ...(editing ?? replyTo)!, attachmentName: (editing ?? replyTo)?.attachment?.name })}</span>
      </span>
      <button type="button" aria-label={editing ? 'Cancelar edição' : 'Cancelar resposta'} onClick={() => { if (editing) { props.onCancelEdit(); setText(readDraft(conversationId)); } else props.onCancelReply(); }}
        className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
    </div>}
    {files.length > 0 && <div className="mb-2 flex flex-wrap gap-2">
      {files.map((file, index) => <span key={`${file.name}-${index}`} className="flex max-w-full items-center gap-2 rounded-xl border bg-card px-2.5 py-1.5 text-[12.5px]">
        <FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 max-w-[12rem] truncate font-medium">{file.name}</span>
        <span className="text-muted-foreground">{fileSize(file.size)}</span>
        <button type="button" aria-label={`Remover ${file.name}`} onClick={() => setFiles(current => current.filter((_, at) => at !== index))} className="rounded-full p-0.5 hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
      </span>)}
    </div>}
    {recorder.recording ? <div className="flex items-center gap-2">
      <Button type="button" variant="ghost" size="icon" aria-label="Descartar gravação" onClick={recorder.cancel} className="h-10 w-10 rounded-full text-destructive"><Trash2 className="h-5 w-5" /></Button>
      <span className="flex flex-1 items-center gap-2 rounded-full bg-destructive/10 px-4 py-2.5 text-sm font-semibold text-destructive">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive motion-reduce:animate-none" aria-hidden="true" />A gravar · {duration(recorder.seconds)}
      </span>
      <Button type="button" size="icon" aria-label="Enviar nota de voz" onClick={() => void toggleRecording()} className="h-10 w-10 rounded-full"><Send className="h-4 w-4" /></Button>
    </div> : <div className="flex items-end gap-2">
      <input ref={fileRef} type="file" multiple accept={CHAT_ACCEPT.join(',')} className="hidden"
        onChange={event => { setFiles(current => [...current, ...acceptFiles(Array.from(event.target.files ?? []))]); event.target.value = ''; }} />
      <Button type="button" variant="outline" size="icon" aria-label="Anexar ficheiro" title="Anexar ficheiro" disabled={!!editing} onClick={() => fileRef.current?.click()} className="h-10 w-10 shrink-0 rounded-full">
        <Paperclip className="h-5 w-5" />
      </Button>
      <EmojiComposer composerRef={composerRef} value={text} rows={1} maxLength={CHAT_MESSAGE_MAX}
        placeholder={files.length ? 'Legenda (opcional)' : 'Escreva uma mensagem'}
        className="max-h-40 min-h-10 resize-none rounded-2xl py-2.5"
        onValueChange={value => { setText(value); props.onTyping(); }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); }
          if (event.key === 'Escape' && (editing || replyTo)) { event.preventDefault(); if (editing) { props.onCancelEdit(); setText(readDraft(conversationId)); } else props.onCancelReply(); }
        }} />
      {canSend || editing
        ? <Button type="button" size="icon" aria-label={editing ? 'Guardar edição' : 'Enviar'} disabled={!canSend} onClick={() => void send()} className="h-10 w-10 shrink-0 rounded-full">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        : <Button type="button" variant="outline" size="icon" aria-label="Gravar nota de voz" title="Gravar nota de voz" disabled={sending} onClick={() => void toggleRecording()}
            className={cn('h-10 w-10 shrink-0 rounded-full')}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : recorder.recording ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
          </Button>}
    </div>}
  </div>;
}
