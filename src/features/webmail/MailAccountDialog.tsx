import { useEffect, useMemo, useState } from 'react';
import { Bell, Check, Loader2, PenLine, Plug, Plus, Settings2, Star, Trash2, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useDeleteEmailChannel } from '@/hooks/useEmailChannels';
import { cn } from '@/lib/utils';
import { SignatureEditor, sanitizeSignatureHtml, signatureIsEmpty } from './SignatureEditor';
import { describeWebmailError, type PersonalSignature } from './webmail-api';
import { usePersonalSignatures, usePreferenceActions, useSaveSignatures, useWebmailScope } from './useWebmail';
import { ACCOUNT_COLORS, syncState, type MailAccount, type WebmailFolder } from './webmail-model';

type Tab = 'general' | 'signatures' | 'alerts' | 'connection';
interface DraftSignature { readonly key: string; readonly id: string | null; readonly name: string; readonly html: string; readonly is_default: boolean }
const toDraft = (signature: PersonalSignature): DraftSignature => ({ key: signature.id, id: signature.id, name: signature.name, html: signature.html, is_default: signature.is_default });

interface Props {
  readonly account: MailAccount;
  readonly folders: readonly WebmailFolder[];
  readonly admin: boolean;
  readonly onClose: () => void;
  readonly onEditConnection: () => void;
}

export function MailAccountDialog({ account, folders, admin, onClose, onEditConnection }: Props) {
  const { userId } = useWebmailScope();
  const [tab, setTab] = useState<Tab>('general');
  const [label, setLabel] = useState(account.name === account.sharedName ? '' : account.name);
  const [color, setColor] = useState(account.color);
  const [isDefault, setIsDefault] = useState(account.isDefault);
  const [notify, setNotify] = useState(account.notify);
  const signatures = usePersonalSignatures(account.id);
  const [drafts, setDrafts] = useState<DraftSignature[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (drafts === null && signatures.data) {
      setDrafts(signatures.data.map(toDraft));
      setSelected(signatures.data[0]?.id ?? null);
    }
  }, [drafts, signatures.data]);
  const preferences = usePreferenceActions();
  const saveSignatures = useSaveSignatures(account.id);
  const archive = useDeleteEmailChannel();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [saving, setSaving] = useState(false);
  const signatureCount = (drafts ?? signatures.data ?? []).length;
  const signaturesDirty = useMemo(() => drafts !== null && JSON.stringify(drafts.map(({ key, ...rest }) => rest)) !== JSON.stringify((signatures.data ?? []).map(toDraft).map(({ key, ...rest }) => rest)), [drafts, signatures.data]);

  const save = async () => {
    setSaving(true);
    try {
      const name = label.trim();
      if (name.length > 60) throw new Error('O nome da caixa tem no máximo 60 caracteres.');
      await preferences.save.mutateAsync({ channelId: account.id, patch: { label: name && name !== account.sharedName ? name : null, color, notify } });
      if (isDefault !== account.isDefault) await preferences.setDefault.mutateAsync(isDefault ? account.id : null);
      if (signaturesDirty && drafts) {
        // As in Realize: empty signatures are dropped, blank names get a number, exactly one default.
        const kept = drafts.map(draft => ({ ...draft, html: sanitizeSignatureHtml(draft.html) })).filter(draft => !signatureIsEmpty(draft.html));
        await saveSignatures.mutateAsync(kept.map((draft, index) => ({ id: draft.id, name: draft.name.trim().slice(0, 60) || `Assinatura ${index + 1}`, html: draft.html, is_default: draft.is_default })));
      }
      toast.success('Definições da caixa guardadas');
      onClose();
    } catch (error) {
      toast.error('Não foi possível guardar', { description: error instanceof Error ? error.message : describeWebmailError(error) });
    } finally {
      setSaving(false);
    }
  };

  const tabs: { key: Tab; label: string; icon: typeof Settings2; badge?: number }[] = [
    { key: 'general', label: 'Geral', icon: Settings2 },
    { key: 'signatures', label: 'Assinaturas', icon: PenLine, badge: signatureCount },
    { key: 'alerts', label: 'Avisos', icon: Bell },
    { key: 'connection', label: 'Ligação', icon: Plug },
  ];
  const health = syncState(account, folders);
  const meta = (account.channel.metadata ?? {}) as Record<string, unknown>;

  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0" onInteractOutside={event => event.preventDefault()}>
      <DialogHeader className="flex-row items-center gap-3 space-y-0 border-b px-5 py-4 pr-14 text-left md:px-8">
        <span className="webmail-dot !h-4 !w-4" style={{ background: color }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate text-xl">{label.trim() || account.sharedName}</DialogTitle>
          <DialogDescription className="truncate">{account.address}</DialogDescription>
        </div>
        {health.state !== 'ok' && <Button variant="outline" size="sm" className="rounded-full" onClick={() => setTab('connection')}>Ver ligação</Button>}
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="webmail-tabs" role="tablist" aria-label="Definições da caixa">
          {tabs.map(item => <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className="webmail-tab" onClick={() => setTab(item.key)}>
            <item.icon aria-hidden="true" />{item.label}
            {!!item.badge && <span className="ml-auto rounded-full bg-muted px-2 text-[11px] font-semibold text-muted-foreground">{item.badge}</span>}
          </button>)}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8" role="tabpanel">
          <div className="mx-auto max-w-3xl">
            {tab === 'general' && <div className="space-y-7">
              <div className="space-y-1.5">
                <Label htmlFor="webmail-label">Nome da caixa</Label>
                <Input id="webmail-label" value={label} maxLength={60} placeholder={account.sharedName} onChange={event => setLabel(event.target.value)} />
                <p className="text-xs text-muted-foreground">Só para si, na barra lateral. Para todos, a caixa chama-se "{account.sharedName}".</p>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Cor</legend>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor da caixa">
                  {ACCOUNT_COLORS.map(swatch => <button key={swatch} type="button" role="radio" aria-checked={color === swatch} aria-label={`Cor ${swatch}`}
                    className={cn('flex h-9 w-9 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110', color === swatch && 'ring-2 ring-foreground')}
                    style={{ background: swatch }} onClick={() => setColor(swatch)}>
                    {color === swatch && <Check className="h-4 w-4 text-white" aria-hidden="true" />}
                  </button>)}
                </div>
              </fieldset>
              <label className="flex items-start gap-3 rounded-2xl border p-4">
                <Checkbox checked={isDefault} onCheckedChange={value => setIsDefault(value === true)} className="mt-0.5" />
                <span><span className="block text-sm font-medium">Caixa predefinida para escrever</span>
                  <span className="block text-xs text-muted-foreground">"Escrever" abre com esta caixa no campo "De".</span></span>
              </label>
              {account.assignedUserIds.length !== 1 && <p className="flex items-start gap-2 rounded-2xl bg-primary/5 p-4 text-sm text-muted-foreground">
                <UsersRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                Esta caixa é partilhada pela equipa. O nome, a cor, os avisos e as assinaturas que escolher aqui são só seus.
              </p>}
            </div>}

            {tab === 'signatures' && (signatures.error ? <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{describeWebmailError(signatures.error)}</p>
              : !drafts || !userId ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="A carregar" />
              : <SignaturesManager drafts={drafts} setDrafts={setDrafts} selected={selected} setSelected={setSelected} userId={userId} />)}

            {tab === 'alerts' && <label className="flex items-start justify-between gap-4 rounded-2xl border p-4">
              <span><span className="block text-sm font-medium">Avisar emails novos</span>
                <span className="block text-xs text-muted-foreground">Notificação no telemóvel e no computador quando chega um email a esta caixa. Só muda para si.</span></span>
              <Switch checked={notify} onCheckedChange={setNotify} aria-label="Avisar emails novos" />
            </label>}

            {tab === 'connection' && <div className="space-y-5">
              <div className="rounded-2xl border p-4 text-sm">
                <p className="font-medium">Estado</p>
                <p className={cn('mt-1', health.state === 'ok' ? 'text-emerald-600' : health.state === 'connecting' ? 'text-muted-foreground' : 'text-amber-600')}>
                  {health.state === 'ok' ? `Ligada${health.since ? ` · última sincronização ${new Date(health.since).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}` : ''}.`
                    : health.state === 'connecting' ? 'A ligar ao servidor de correio. As pastas aparecem em poucos minutos.'
                    : health.state === 'stale' ? `Sem sincronizar desde ${new Date(health.since!).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}. Confirme o servidor e a palavra-passe.`
                    : 'Ainda não sincronizou. Confirme o servidor e a palavra-passe.'}
                </p>
                <dl className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <div><dt className="inline">IMAP: </dt><dd className="inline">{String(meta.imap_server ?? '—')}:{String(meta.imap_port ?? '')}</dd></div>
                  <div><dt className="inline">SMTP: </dt><dd className="inline">{String(meta.smtp_server ?? '—')}:{String(meta.smtp_port ?? '')}</dd></div>
                </dl>
              </div>
              {admin ? <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="rounded-full" onClick={onEditConnection}><Plug className="mr-2 h-4 w-4" />Editar ligação e equipa</Button>
                <Button variant="outline" className="rounded-full text-destructive hover:text-destructive" onClick={() => setConfirmArchive(true)}><Trash2 className="mr-2 h-4 w-4" />Desligar caixa</Button>
              </div> : <p className="text-sm text-muted-foreground">A ligação desta caixa é gerida pelo administrador.</p>}
            </div>}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t bg-background px-5 py-4 md:px-8">
        <Button variant="outline" className="rounded-full" disabled={saving} onClick={onClose}>Cancelar</Button>
        <Button className="rounded-full" disabled={saving} onClick={() => void save()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar</Button>
      </div>
    </DialogContent>
    <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desligar "{account.sharedName}"?</AlertDialogTitle>
          <AlertDialogDescription>A caixa deixa de receber e enviar para toda a equipa. Os emails já sincronizados ficam guardados e a caixa pode voltar a ser ligada nas Definições.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => archive.mutate(account.id, {
            onSuccess: () => { toast.success('Caixa desligada'); onClose(); },
            onError: error => toast.error('Não foi possível desligar a caixa', { description: error instanceof Error ? error.message : describeWebmailError(error) }),
          })}>Desligar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </Dialog>;
}

/** Several named signatures; one is the default. Saved with the dialog's "Guardar". */
function SignaturesManager({ drafts, setDrafts, selected, setSelected, userId }: {
  drafts: DraftSignature[]; setDrafts: (next: DraftSignature[]) => void; selected: string | null; setSelected: (key: string | null) => void; userId: string;
}) {
  const current = drafts.find(draft => draft.key === selected) ?? null;
  const update = (patch: Partial<DraftSignature>) => setDrafts(drafts.map(draft => (draft.key === selected ? { ...draft, ...patch } : draft)));
  const add = () => {
    const key = crypto.randomUUID();
    setDrafts([...drafts, { key, id: null, name: `Assinatura ${drafts.length + 1}`, html: '', is_default: drafts.length === 0 }]);
    setSelected(key);
  };
  const remove = () => {
    if (!current) return;
    const rest = drafts.filter(draft => draft.key !== current.key);
    // The first remaining one becomes the default when the default goes.
    const next = current.is_default && rest.length ? rest.map((draft, index) => ({ ...draft, is_default: index === 0 })) : rest;
    setDrafts(next);
    setSelected(next[0]?.key ?? null);
  };
  if (drafts.length === 0) return <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
    <PenLine className="h-8 w-8 text-primary" aria-hidden="true" />
    <p className="text-sm text-muted-foreground">Ainda não tem assinaturas nesta caixa. Enquanto não criar uma, usa-se a assinatura da caixa definida pelo administrador.</p>
    <Button className="rounded-full" onClick={add}><Plus className="mr-2 h-4 w-4" />Criar assinatura</Button>
  </div>;
  return <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
    <div className="space-y-1">
      {drafts.map(draft => <button key={draft.key} type="button" aria-current={draft.key === selected}
        className={cn('flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm', draft.key === selected ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted')}
        onClick={() => setSelected(draft.key)}>
        <span className="min-w-0 flex-1 truncate">{draft.name || 'Sem nome'}</span>
        {draft.is_default && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Predefinida" />}
      </button>)}
      <Button variant="ghost" size="sm" className="mt-1 w-full justify-start rounded-xl text-primary" onClick={add}><Plus className="mr-2 h-4 w-4" />Nova assinatura</Button>
    </div>
    {current && <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <Label htmlFor="signature-name">Nome</Label>
          <Input id="signature-name" value={current.name} maxLength={60} onChange={event => update({ name: event.target.value })} />
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <Checkbox checked={current.is_default} disabled={current.is_default}
            onCheckedChange={value => { if (value === true) setDrafts(drafts.map(draft => ({ ...draft, is_default: draft.key === current.key }))); }} />
          Predefinida
        </label>
        <Button variant="ghost" className="h-10 rounded-full text-destructive hover:text-destructive" onClick={remove}><Trash2 className="mr-2 h-4 w-4" />Eliminar</Button>
      </div>
      <SignatureEditor key={current.key} value={current.html} onChange={html => update({ html })} userId={userId} />
    </div>}
  </div>;
}
