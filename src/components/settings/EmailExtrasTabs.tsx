import { useMemo, useState } from 'react';
import { Plus, Trash2, Loader2, PenLine, Save, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { RichTextEditor } from '@/components/shared/RichTextEditor';
import { useSaveEmailChannelMeta, type EmailChannel, type EmailSignature, type VacationReply } from '@/hooks/useEmailChannels';
import { useLanguage } from '@/i18n';

function newId(): string {
  // crypto.randomUUID is available in all supported browsers; fallback just in case.
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sig-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signatures
// ─────────────────────────────────────────────────────────────────────────────
export function SignaturesTab({ channel }: { channel: EmailChannel }) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const save = useSaveEmailChannelMeta();
  const meta = channel.metadata ?? {};

  const [signatures, setSignatures] = useState<EmailSignature[]>(meta.signatures ?? []);
  const [defaultNew, setDefaultNew] = useState<string | null>(meta.signature_default_new ?? null);
  const [defaultReply, setDefaultReply] = useState<string | null>(meta.signature_default_reply ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(meta.signatures?.[0]?.id ?? null);

  const selected = signatures.find((s) => s.id === selectedId) ?? null;

  const addSignature = () => {
    const sig: EmailSignature = { id: newId(), name: t('Assinatura {{n}}', { n: signatures.length + 1 }), html: '' };
    setSignatures((prev) => [...prev, sig]);
    setSelectedId(sig.id);
  };

  const updateSelected = (patch: Partial<EmailSignature>) => {
    if (!selected) return;
    setSignatures((prev) => prev.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)));
  };

  const deleteSignature = (id: string) => {
    setSignatures((prev) => prev.filter((s) => s.id !== id));
    if (defaultNew === id) setDefaultNew(null);
    if (defaultReply === id) setDefaultReply(null);
    if (selectedId === id) setSelectedId(null);
  };

  const handleSave = () => {
    save.mutate(
      {
        channelId: channel.id,
        patch: {
          signatures,
          signature_default_new: defaultNew,
          signature_default_reply: defaultReply,
        },
      },
      {
        onSuccess: () => toast({ title: t('Assinaturas guardadas') }),
        onError: (e) => toast({ title: t('Falha ao guardar'), description: (e as Error).message, variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {t('Assinaturas incluídas no final das mensagens enviadas por esta caixa. Define qual usar em emails novos e em respostas/encaminhamentos.')}
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
        {/* List */}
        <div className="space-y-2">
          <div className="rounded-xl border divide-y overflow-hidden">
            {signatures.length === 0 ? (
              <p className="px-3 py-4 text-xs text-muted-foreground">{t('Ainda sem assinaturas.')}</p>
            ) : (
              signatures.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors',
                    selectedId === s.id ? 'bg-primary/10' : 'hover:bg-accent/50',
                  )}
                  onClick={() => setSelectedId(s.id)}
                >
                  <PenLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-sm font-medium">{s.name || t('Sem nome')}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); deleteSignature(s.id); }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
          <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={addSignature}>
            <Plus className="h-4 w-4" /> {t('Criar nova')}
          </Button>
        </div>

        {/* Editor */}
        <div className="space-y-3">
          {selected ? (
            <>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" /> {t('Nome da assinatura')}
                </Label>
                <Input value={selected.name} onChange={(e) => updateSelected({ name: e.target.value })} placeholder={t('Ex: Thiago, Suporte...')} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{t('Conteúdo')}</Label>
                <RichTextEditor
                  key={selected.id}
                  value={selected.html}
                  onChange={(html) => updateSelected({ html })}
                  placeholder={t('Escreve a tua assinatura (formatação, links e imagens são aceites)...')}
                  minHeight={180}
                />
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              {t('Seleciona uma assinatura à esquerda, ou cria uma nova.')}
            </div>
          )}
        </div>
      </div>

      {/* Defaults */}
      <div className="rounded-xl border bg-muted/10 p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t('Assinaturas predefinidas')}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('Para novos emails')}</Label>
            <Select value={defaultNew ?? 'none'} onValueChange={(v) => setDefaultNew(v === 'none' ? null : v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('Sem assinatura')}</SelectItem>
                {signatures.map((s) => <SelectItem key={s.id} value={s.id}>{s.name || t('Sem nome')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('Para respostas / encaminhamentos')}</Label>
            <Select value={defaultReply ?? 'none'} onValueChange={(v) => setDefaultReply(v === 'none' ? null : v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('Sem assinatura')}</SelectItem>
                {signatures.map((s) => <SelectItem key={s.id} value={s.id}>{s.name || t('Sem nome')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Button onClick={handleSave} disabled={save.isPending} className="gap-1.5">
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {t('Guardar assinaturas')}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Vacation auto-reply
// ─────────────────────────────────────────────────────────────────────────────
export function VacationTab({ channel }: { channel: EmailChannel }) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const save = useSaveEmailChannelMeta();
  const vac: VacationReply = channel.metadata?.vacation_reply ?? { enabled: false };

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [enabled, setEnabled] = useState(!!vac.enabled);
  const [startDate, setStartDate] = useState(vac.start_date ?? todayIso);
  const [hasEnd, setHasEnd] = useState(!!vac.end_date);
  const [endDate, setEndDate] = useState(vac.end_date ?? '');
  const [subject, setSubject] = useState(vac.subject ?? '');
  const [message, setMessage] = useState(vac.message ?? '');
  const [onlyContacts, setOnlyContacts] = useState(!!vac.only_contacts);

  const handleSave = () => {
    if (enabled && !subject.trim()) {
      toast({ title: t('Indica um assunto para a resposta'), variant: 'destructive' });
      return;
    }
    if (enabled && !message.trim()) {
      toast({ title: t('Escreve a mensagem da resposta'), variant: 'destructive' });
      return;
    }
    const payload: VacationReply = {
      enabled,
      start_date: startDate || null,
      end_date: hasEnd ? (endDate || null) : null,
      subject: subject.trim(),
      message,
      only_contacts: onlyContacts,
    };
    save.mutate(
      { channelId: channel.id, patch: { vacation_reply: payload } },
      {
        onSuccess: () => toast({ title: enabled ? t('Resposta de férias ativada') : t('Resposta de férias guardada') }),
        onError: (e) => toast({ title: t('Falha ao guardar'), description: (e as Error).message, variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {t('Envia uma resposta automática às mensagens recebidas nesta caixa. Se um contacto enviar várias mensagens, a resposta é enviada no máximo a cada 4 dias.')}
      </p>

      <div className="flex items-center gap-3 rounded-xl border p-4">
        <Switch checked={enabled} onCheckedChange={setEnabled} />
        <span className="text-sm font-medium">{enabled ? t('Resposta automática de férias ativada') : t('Resposta automática de férias desativada')}</span>
      </div>

      <div className={cn('space-y-4 transition-opacity', !enabled && 'pointer-events-none opacity-50')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">{t('Primeiro dia')}</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <input id="vac-hasend" type="checkbox" checked={hasEnd} onChange={(e) => setHasEnd(e.target.checked)} className="h-4 w-4" />
              <Label htmlFor="vac-hasend" className="text-sm font-medium">{t('Último dia (opcional)')}</Label>
            </div>
            <Input type="date" value={endDate} disabled={!hasEnd} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium">{t('Assunto')}</Label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('Ex: Estou de férias')} />
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium">{t('Mensagem')}</Label>
          <RichTextEditor
            value={message}
            onChange={setMessage}
            placeholder={t('Olá, estou de férias e responderei assim que possível...')}
            minHeight={160}
          />
        </div>

        <div className="flex items-center gap-2">
          <input id="vac-onlycontacts" type="checkbox" checked={onlyContacts} onChange={(e) => setOnlyContacts(e.target.checked)} className="h-4 w-4" />
          <Label htmlFor="vac-onlycontacts" className="text-sm">{t('Enviar resposta apenas a contactos existentes no CRM (leads/clientes)')}</Label>
        </div>
      </div>

      <Button onClick={handleSave} disabled={save.isPending} className="gap-1.5">
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {t('Guardar')}
      </Button>
    </div>
  );
}
