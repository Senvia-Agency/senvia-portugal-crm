import { useState } from 'react';
import { Award, Check, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { TeamMember } from '@/hooks/useTeam';
import { cn } from '@/lib/utils';
import { FeedAvatar, FeedKindTile, FeedPostContent, feedPostFrame, tileStyle } from './FeedPostCard';
import type { FeedEntry } from './feed-model';
import { recognitionReason, recognitionType, recognitionTypes, type RecognitionKey } from './recognition-types';

export interface RecognitionInput {
  readonly id: string;
  readonly recipientId: string;
  readonly recognitionType: RecognitionKey;
  readonly body: string;
}
interface Props {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly members: readonly TeamMember[];
  readonly selfId: string;
  readonly selfName: string;
  readonly onSubmit: (input: RecognitionInput) => Promise<unknown>;
  readonly describeError: (error: unknown) => string;
}
export function RecognitionDialog({ open, onOpenChange, members, selfId, selfName, onSubmit, describeError }: Props) {
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [type, setType] = useState<RecognitionKey | null>(null);
  const [reason, setReason] = useState('');
  const [query, setQuery] = useState('');
  // Retrying the same choice reuses its ID, so an uncertain save never duplicates.
  const [attemptId, setAttemptId] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const people = members.filter(member => member.user_id !== selfId && !member.is_banned
    && member.full_name.toLocaleLowerCase('pt').includes(query.trim().toLocaleLowerCase('pt')));
  const recipient = members.find(member => member.user_id === recipientId);
  const length = reason.trim().length;
  const valid = !!recipientId && !!type && length >= recognitionReason.min && length <= recognitionReason.max;
  function edit(apply: () => void) { apply(); setAttemptId(crypto.randomUUID()); setError(''); }
  async function submit() {
    if (!valid || !recipientId || !type || submitting) return;
    setSubmitting(true); setError('');
    try {
      await onSubmit({ id: attemptId, recipientId, recognitionType: type, body: reason.trim() });
      setRecipientId(null); setType(null); setReason(''); setQuery(''); setAttemptId(crypto.randomUUID());
      onOpenChange(false);
      toast.success('Reconhecimento publicado');
    } catch (failure) {
      setError(`${describeError(failure)} A escolha foi mantida.`);
    } finally {
      setSubmitting(false);
    }
  }
  const chosen = type ? recognitionType(type) : null;
  // Nothing is saved for the preview: it is the real card, read as a colleague will see it.
  const preview: FeedEntry | null = recipient && type ? {
    id: 'recognition-preview', author: { id: selfId, name: selfName }, kind: 'recognition', pinned: false, createdAt: new Date().toISOString(),
    text: reason.trim() || 'O que a pessoa fez aparece aqui.', reactions: [], comments: [], attachments: [],
    recipient: { id: recipient.user_id, name: recipient.full_name }, recognitionType: type,
  } : null;
  return <Dialog open={open} onOpenChange={next => { if (!submitting) onOpenChange(next); }}>
    <DialogContent variant="fullScreen" className="recognition-dialog flex flex-col gap-0 p-0">
      <DialogHeader className="border-b px-5 py-4 text-left md:px-8">
        <DialogTitle className="flex items-center gap-2 text-xl"><Award className="h-5 w-5 text-primary" aria-hidden="true" />Reconhecer o trabalho de alguém</DialogTitle>
        <DialogDescription>O reconhecimento fica visível para toda a organização.</DialogDescription>
      </DialogHeader>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8">
          <div className="mx-auto flex max-w-4xl flex-col gap-8">
            <fieldset className="space-y-3" disabled={submitting}>
              <legend className="text-base font-semibold">1. Quem quer reconhecer?</legend>
              <label className="flex h-11 items-center gap-2 rounded-full border bg-card px-4 focus-within:ring-2 focus-within:ring-ring">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Procurar colega…" aria-label="Procurar colega" value={query} onChange={event => setQuery(event.target.value)} />
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Colegas">
                {people.map(member => <button key={member.user_id} type="button" aria-label={member.full_name} aria-pressed={recipientId === member.user_id}
                  onClick={() => edit(() => setRecipientId(member.user_id))}
                  className={cn('flex min-h-14 items-center gap-3 rounded-2xl border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    recipientId === member.user_id && 'border-primary bg-primary/10 ring-1 ring-primary')}>
                  <FeedAvatar name={member.full_name} avatarUrl={member.avatar_url} />
                  <span className="min-w-0 flex-1 truncate font-medium">{member.full_name}</span>
                  {recipientId === member.user_id && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                </button>)}
                {people.length === 0 && <p className="text-sm text-muted-foreground">Nenhum colega encontrado.</p>}
              </div>
            </fieldset>
            <fieldset className="space-y-3" disabled={submitting}>
              <legend className="text-base font-semibold">2. O que quer reconhecer?</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label="Tipo de reconhecimento">
                {recognitionTypes.map(option => <button key={option.key} type="button" aria-pressed={type === option.key} style={tileStyle(option.tile)}
                  onClick={() => edit(() => setType(option.key))}
                  className={cn('flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-2xl border bg-card p-3 text-center text-sm font-medium transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    type === option.key && 'border-primary bg-primary/10 ring-1 ring-primary')}>
                  <FeedKindTile className="feed-kind-tile--small"><option.icon /></FeedKindTile>
                  {option.label}
                </button>)}
              </div>
            </fieldset>
            <fieldset className="space-y-2" disabled={submitting}>
              <legend className="text-base font-semibold">3. Conte o que a pessoa fez</legend>
              <Textarea rows={4} aria-label="O que a pessoa fez" maxLength={recognitionReason.max} value={reason} onChange={event => edit(() => setReason(event.target.value))}
                aria-describedby="recognition-reason-hint" placeholder="Ex.: Fechou a proposta da semana com um acompanhamento impecável ao cliente." />
              <p id="recognition-reason-hint" className={cn('text-xs', length > 0 && length < recognitionReason.min ? 'text-destructive' : 'text-muted-foreground')}>
                {length < recognitionReason.min ? `Mínimo ${recognitionReason.min} caracteres (faltam ${recognitionReason.min - length}).` : `${length}/${recognitionReason.max}`}
              </p>
            </fieldset>
            <section className="space-y-3" aria-label="Pré-visualização">
              <h3 className="text-base font-semibold">Pré-visualização <span className="text-sm font-normal text-muted-foreground">· assim aparece para a equipa</span></h3>
              {preview ? <div className="workplace-feed workplace-feed--embedded"><article {...feedPostFrame(preview)}><FeedPostContent post={preview} viewerId="" /></article></div>
                : <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Escolha a pessoa e o motivo para ver o card.</p>}
            </section>
          </div>
        </div>
        <div className="border-t bg-background px-5 py-4 md:px-8">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              {recipient && chosen ? <>Vai reconhecer <strong className="text-foreground">{recipient.full_name}</strong> por <strong className="text-foreground">{chosen.label}</strong>.</> : 'Escolha a pessoa, o motivo e escreva o que ela fez.'}
            </p>
            {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={!valid || submitting}>{submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Reconhecer</Button>
          </div>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
