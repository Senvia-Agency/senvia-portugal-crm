import { useState, useEffect } from 'react';
import { Mail, Settings2, Trash2, Plus, Loader2, Eye, EyeOff, Server, Lock, AlertCircle, UsersRound, ArrowLeft, PenLine, Plane } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useSidebarStore } from '@/stores/useSidebarStore';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  useEmailChannels, useCreateEmailChannel, useUpdateEmailChannel, useDeleteEmailChannel,
  type EmailChannel, type EmailChannelInput, type EmailChannelUpdate,
} from '@/hooks/useEmailChannels';
import { useUpdateChannelAssignment } from '@/hooks/useMessagingChannels';
import { CollaboratorPicker } from './CollaboratorPicker';
import { SignaturesTab, VacationTab } from './EmailExtrasTabs';
import { useLanguage } from '@/i18n';

// --- Form state ---

interface EmailFormState {
  label: string;
  email_address: string;
  imap_server: string;
  imap_port: string;
  imap_ssl: boolean;
  imap_login: string;
  imap_password: string;
  smtp_server: string;
  smtp_port: string;
  smtp_ssl: boolean;
  smtp_login: string;
  smtp_password: string;
}

function emptyForm(): EmailFormState {
  return {
    label: '', email_address: '',
    imap_server: '', imap_port: '993', imap_ssl: true,
    imap_login: '', imap_password: '',
    smtp_server: '', smtp_port: '587', smtp_ssl: false,
    smtp_login: '', smtp_password: '',
  };
}

function formFromChannel(ch: EmailChannel): EmailFormState {
  const m = ch.metadata ?? {};
  return {
    label: ch.label ?? '',
    email_address: m.email_address ?? '',
    imap_server: m.imap_server ?? '',
    imap_port: String(m.imap_port ?? 993),
    imap_ssl: m.imap_ssl !== false,
    imap_login: m.imap_login ?? '',
    imap_password: '',
    smtp_server: m.smtp_server ?? '',
    smtp_port: String(m.smtp_port ?? 587),
    smtp_ssl: m.smtp_ssl === true,
    smtp_login: m.smtp_login ?? '',
    smtp_password: '',
  };
}

// --- PasswordInput ---

function PasswordInput({ value, onChange, placeholder, id }: {
  value: string; onChange: (v: string) => void; placeholder?: string; id?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? 'text' : 'password'} value={value}
        onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="pr-10" autoComplete="new-password" />
      <button type="button" onClick={() => setShow((v) => !v)}
        className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground" tabIndex={-1}>
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

// --- EmailForm ---

function EmailForm({ form, setForm, isEdit = false, error }: {
  form: EmailFormState; setForm: (f: EmailFormState) => void; isEdit?: boolean; error?: string | null;
}) {
  const update = (patch: Partial<EmailFormState>) => setForm({ ...form, ...patch });
  const { t } = useLanguage();

  // 465 = SSL implícito (SMTPS), sempre. 587 = STARTTLS, e aí o valor é escolha.
  // O que se mostra tem de ser o que vai acontecer, não o que está gravado.
  const portaSmtpImplicita = Number(form.smtp_port) === 465;
  const smtpSslEfetivo = portaSmtpImplicita || form.smtp_ssl;

  return (
    <div className="space-y-8">

      {/* Identificacao */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-5 w-1 rounded-full bg-slate-400" />
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t('Identificação')}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="em-label" className="text-sm font-medium">{t('Nome da caixa')}</Label>
            <Input id="em-label" placeholder={t('Ex: Suporte, Vendas')} value={form.label}
              onChange={(e) => update({ label: e.target.value })} autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="em-email" className="text-sm font-medium">{t('Endereço de email')}</Label>
            <Input id="em-email" type="email" placeholder={t('suporte@empresa.com')} value={form.email_address}
              onChange={(e) => update({ email_address: e.target.value, imap_login: e.target.value, smtp_login: e.target.value })}
              autoComplete="new-password" />
          </div>
        </div>
      </div>

      {/* IMAP */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-5 w-1 rounded-full bg-blue-500" />
          <span className="text-xs font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">{t('IMAP — Receção de email')}</span>
        </div>
        <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_auto] gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Server className="h-3.5 w-3.5 text-blue-500" /> {t('Servidor')}
              </Label>
              <Input placeholder={t('imap.seudominio.com')} value={form.imap_server}
                onChange={(e) => update({ imap_server: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t('Porta')}</Label>
              <Input type="number" value={form.imap_port} onChange={(e) => update({ imap_port: e.target.value })} />
            </div>
            <div className="flex flex-col items-center gap-1 pb-1">
              <Label className="text-xs text-muted-foreground">SSL</Label>
              <Switch checked={form.imap_ssl} onCheckedChange={(v) => update({ imap_ssl: v })} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-blue-500" /> {t('Utilizador', { context: 'settings' })}
              </Label>
              <Input placeholder={form.email_address || t('utilizador@email.com')} value={form.imap_login}
                onChange={(e) => update({ imap_login: e.target.value })} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-blue-500" /> {t('Password')}
              </Label>
              <PasswordInput value={form.imap_password} onChange={(v) => update({ imap_password: v })}
                placeholder={isEdit ? t('(manter a atual)') : t('App Password ou password de email')} />
            </div>
          </div>
        </div>
      </div>

      {/* SMTP */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-5 w-1 rounded-full bg-green-500" />
          <span className="text-xs font-bold uppercase tracking-widest text-green-600 dark:text-green-400">{t('SMTP — Envio de email')}</span>
        </div>
        <div className="rounded-xl bg-green-500/5 border border-green-500/20 p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_auto] gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Server className="h-3.5 w-3.5 text-green-500" /> {t('Servidor')}
              </Label>
              <Input placeholder={t('smtp.seudominio.com')} value={form.smtp_server}
                onChange={(e) => update({ smtp_server: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t('Porta')}</Label>
              <Input type="number" value={form.smtp_port} onChange={(e) => update({ smtp_port: e.target.value })} />
            </div>
            {/* A porta 465 é SSL implícito: não existe 465 sem SSL. O
                interruptor deixava-se desligar nela, e ficava a mentir — a caixa
                da Senvia tinha 465 com SSL a false e só funcionava porque o
                gateway força SSL nessa porta.
                A armadilha estava a seguir: quem mudasse para 587 a olhar para
                o interruptor desligado partia o envio, porque na 587 o valor É
                respeitado (e a 587 precisa de STARTTLS). */}
            <div className="flex flex-col items-center gap-1 pb-1">
              <Label className="text-xs text-muted-foreground">SSL</Label>
              <Switch
                checked={smtpSslEfetivo}
                disabled={portaSmtpImplicita}
                onCheckedChange={(v) => update({ smtp_ssl: v })}
              />
            </div>
          </div>
          {portaSmtpImplicita && (
            <p className="text-[11px] text-muted-foreground">
              {t('A porta 465 usa sempre SSL. Para escolher, muda para a porta 587 (STARTTLS).')}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-green-500" /> {t('Utilizador', { context: 'settings' })}
              </Label>
              <Input placeholder={form.email_address || t('utilizador@email.com')} value={form.smtp_login}
                onChange={(e) => update({ smtp_login: e.target.value })} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-green-500" /> {t('Password')}
              </Label>
              <PasswordInput value={form.smtp_password} onChange={(v) => update({ smtp_password: v })}
                placeholder={isEdit ? t('(manter a atual)') : t('App Password ou password de email')} />
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}

// --- Full-Screen Editor ---

type EditorTab = 'config' | 'team' | 'signatures' | 'vacation';

interface TabDef {
  key: EditorTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
}

function EmailFullScreenEditor({
  channel, onDone, members = [],
}: {
  channel: EmailChannel | null;
  onDone: () => void;
  members?: { id: string; user_id?: string; full_name: string | null }[];
}) {
  const isEdit = !!channel;
  const createChannel = useCreateEmailChannel();
  const updateChannel = useUpdateEmailChannel();
  const updateAssign = useUpdateChannelAssignment();
  const { t } = useLanguage();

  const [form, setForm] = useState<EmailFormState>(() => isEdit ? formFromChannel(channel!) : emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>('config');
  const [localColor, setLocalColor] = useState<string | null>(channel?.color ?? null);

  useEffect(() => {
    setForm(isEdit ? formFromChannel(channel!) : emptyForm());
    setFormError(null);
    setActiveTab('config');
    setLocalColor(isEdit ? (channel?.color ?? null) : null);
    setLocalAttendants(isEdit ? ((channel as unknown as { assigned_user_ids?: string[] }).assigned_user_ids ?? []) : []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id]);

  const [localAttendants, setLocalAttendants] = useState<string[]>(
    isEdit ? ((channel as unknown as { assigned_user_ids?: string[] }).assigned_user_ids ?? []) : []
  );

  const isPending = createChannel.isPending || updateChannel.isPending;
  const canSubmit = !!form.label.trim() && form.email_address.includes('@') &&
    !!form.imap_server && !!form.smtp_server &&
    (isEdit || (!!form.imap_password && !!form.smtp_password)) && !isPending;

  const handleSave = () => {
    setFormError(null);
    if (isEdit) {
      updateChannel.mutate({
        channel_id: channel!.id,
        label: form.label.trim() || undefined,
        email_config: {
          email_address: form.email_address.trim(),
          imap_server: form.imap_server.trim(),
          imap_port: Number(form.imap_port) || 993,
          imap_ssl: form.imap_ssl,
          imap_login: (form.imap_login || form.email_address).trim(),
          imap_password: form.imap_password || undefined,
          smtp_server: form.smtp_server.trim(),
          smtp_port: Number(form.smtp_port) || 587,
          // Grava-se o que VAI acontecer: na 465 e sempre SSL. Guardar false
          // numa 465 deixava a base de dados a dizer o contrario do real.
          smtp_ssl: Number(form.smtp_port) === 465 || form.smtp_ssl,
          smtp_login: (form.smtp_login || form.email_address).trim(),
          smtp_password: form.smtp_password || undefined,
        },
      } as EmailChannelUpdate, {
        onSuccess: () => onDone(),
        onError: (e) => setFormError(e.message),
      });
    } else {
      createChannel.mutate({
        label: form.label.trim(),
        email_config: {
          email_address: form.email_address.trim(),
          imap_server: form.imap_server.trim(),
          imap_port: Number(form.imap_port) || 993,
          imap_ssl: form.imap_ssl,
          imap_login: (form.imap_login || form.email_address).trim(),
          imap_password: form.imap_password,
          smtp_server: form.smtp_server.trim(),
          smtp_port: Number(form.smtp_port) || 587,
          // Grava-se o que VAI acontecer: na 465 e sempre SSL. Guardar false
          // numa 465 deixava a base de dados a dizer o contrario do real.
          smtp_ssl: Number(form.smtp_port) === 465 || form.smtp_ssl,
          smtp_login: (form.smtp_login || form.email_address).trim(),
          smtp_password: form.smtp_password,
        },
      } as EmailChannelInput, {
        onSuccess: () => onDone(),
        onError: (e) => setFormError(e.message),
      });
    }
  };

  const TABS: TabDef[] = [
    { key: 'config',     label: t('Configuração da conta'), icon: Settings2,  desc: t('Servidor de email, credenciais IMAP e SMTP.') },
    { key: 'team',       label: t('Colaboradores'),          icon: UsersRound, desc: t('Quem vê e atende esta caixa no Inbox.') },
    { key: 'signatures', label: t('Assinaturas'),            icon: PenLine,    desc: t('Assinaturas incluídas no final das mensagens enviadas.') },
    { key: 'vacation',   label: t('Resposta de férias'),     icon: Plane,      desc: t('Resposta automática às mensagens recebidas durante um período.') },
  ];

  const currentTab = TABS.find((t) => t.key === activeTab)!;
  const displayName = form.label.trim() || (isEdit ? (channel!.label ?? t('Caixa de Email')) : t('Nova Caixa'));
  const displayEmail = form.email_address.trim() || (isEdit ? (channel!.metadata?.email_address ?? '') : '');

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">

      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 h-14 border-b shrink-0 bg-muted/30">
        <Button variant="back" size="sm" onClick={onDone} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> {t('Voltar')}
        </Button>
        <div className="h-5 w-px bg-border mx-1" />
        <span className="text-sm font-semibold">
          {isEdit ? t('Editar caixa de email') : t('Nova caixa de email')}
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Sidebar */}
        <aside className="w-64 shrink-0 border-r bg-muted/10 flex flex-col overflow-y-auto">
          <div className="p-5 border-b space-y-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/15 border border-blue-500/20">
              <Mail className="h-7 w-7 text-blue-600" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm truncate">{displayName}</p>
              {displayEmail
                ? <p className="text-xs text-muted-foreground mt-0.5 truncate">{displayEmail}</p>
                : <p className="text-xs text-muted-foreground/50 mt-0.5 italic">{t('email@empresa.com')}</p>
              }
            </div>
          </div>
          <nav className="flex-1 p-3 space-y-0.5">
            <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t('Secções')}</p>
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.key} type="button" onClick={() => setActiveTab(t.key)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors text-left',
                    activeTab === t.key
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}>
                  <Icon className="h-4 w-4 shrink-0" />
                  {t.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main */}
        <div className="flex flex-1 flex-col min-h-0 min-w-0">
          <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
            <div className="border-b pb-4">
              <h3 className="text-base font-bold">{currentTab.label}</h3>
              <p className="text-sm text-muted-foreground mt-0.5">{currentTab.desc}</p>
            </div>

            {activeTab === 'config' && (
              <>
                {isEdit && (
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t('Cor da caixa')}</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      {['#ef4444','#f97316','#f59e0b','#22c55e','#14b8a6','#3b82f6','#6366f1','#a855f7','#ec4899','#64748b'].map((c) => (
                        <button key={c} type="button"
                          onClick={() => { const next = localColor === c ? null : c; setLocalColor(next); updateAssign.mutate({ channelId: channel!.id, color: next }); }}
                          className={cn('h-6 w-6 rounded-full transition-transform hover:scale-110 ring-offset-background ring-offset-2',
                            localColor === c ? 'ring-2 ring-foreground scale-110' : '')}
                          style={{ background: c }} title={localColor === c ? t('Remover cor') : c} />
                      ))}
                    </div>
                  </div>
                )}
                <EmailForm form={form} setForm={setForm} isEdit={isEdit} error={formError} />
              </>
            )}

            {activeTab === 'team' && (
              isEdit ? (
                <div className="space-y-4">
                  {members.length > 0 ? (
                    <CollaboratorPicker
                      members={members.map((m) => ({ user_id: m.user_id ?? m.id, full_name: m.full_name || m.user_id || m.id }))}
                      value={localAttendants}
                      onChange={(next) => { setLocalAttendants(next); updateAssign.mutate({ channelId: channel!.id, assigned_user_ids: next }); }}
                      mode="multi"
                      emptyHint={t('Vazio = todos os colaboradores veem esta caixa.')} />
                  ) : (
                    <div className="rounded-xl border border-dashed p-8 text-center bg-muted/10">
                      <UsersRound className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-sm font-medium text-muted-foreground">{t('Nenhum colaborador disponível')}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t('Adiciona colaboradores na página de Equipa primeiro.')}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-8 text-center bg-muted/10">
                  <UsersRound className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">{t('Cria a caixa primeiro para poder atribuir colaboradores.')}</p>
                </div>
              )
            )}

            {activeTab === 'signatures' && (
              isEdit ? (
                <SignaturesTab channel={channel!} />
              ) : (
                <div className="rounded-xl border border-dashed p-8 text-center bg-muted/10">
                  <PenLine className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">{t('Cria a caixa primeiro para configurar assinaturas.')}</p>
                </div>
              )
            )}

            {activeTab === 'vacation' && (
              isEdit ? (
                <VacationTab channel={channel!} />
              ) : (
                <div className="rounded-xl border border-dashed p-8 text-center bg-muted/10">
                  <Plane className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">{t('Cria a caixa primeiro para configurar a resposta de férias.')}</p>
                </div>
              )
            )}
          </div>

          {activeTab === 'config' && (
            <div className="border-t bg-muted/10 px-8 py-4 flex items-center gap-3 shrink-0">
              <Button onClick={handleSave} disabled={!canSubmit}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEdit ? t('Guardar alterações') : t('Criar caixa de email')}
              </Button>
              <Button variant="ghost" onClick={onDone}>{t('Cancelar')}</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- AddEmailModal ---

export function AddEmailModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  if (!open) return null;
  return (
    <div className="fixed inset-y-0 right-0 z-50" style={{ left: sidebarCollapsed ? 64 : 256 }}>
      <div className="h-full w-full overflow-auto bg-background">
        <EmailFullScreenEditor channel={null} onDone={() => onOpenChange(false)} />
      </div>
    </div>
  );
}

// --- EditEmailModal ---

export function EditEmailModal({
  channel, open, onOpenChange, members = [],
}: {
  channel: EmailChannel;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members?: { id: string; user_id?: string; full_name: string | null }[];
}) {
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  if (!open) return null;
  return (
    <div className="fixed inset-y-0 right-0 z-50" style={{ left: sidebarCollapsed ? 64 : 256 }}>
      <div className="h-full w-full overflow-auto bg-background">
        <EmailFullScreenEditor channel={channel} onDone={() => onOpenChange(false)} members={members} />
      </div>
    </div>
  );
}

// --- EmailManager ---

export function EmailManager() {
  const { data: channels = [], isLoading } = useEmailChannels();
  const deleteChannel = useDeleteEmailChannel();
  const { t } = useLanguage();
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [editingChannel, setEditingChannel] = useState<EmailChannel | null>(null);

  const openAdd = () => { setEditingChannel(null); setView('editor'); };
  const openEdit = (ch: EmailChannel) => { setEditingChannel(ch); setView('editor'); };
  const goBack = () => { setView('list'); setEditingChannel(null); };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">{t('A carregar...')}</span>
      </div>
    );
  }

  if (view === 'editor') {
    return (
      <div className="fixed inset-0 z-50">
        <EmailFullScreenEditor channel={editingChannel} onDone={goBack} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t('Ligue caixas de email (IMAP/SMTP) para receber e responder emails diretamente no CRM. Cada caixa é uma conta de email separada.')}
        </p>
        <Button size="sm" onClick={openAdd} className="shrink-0 gap-1.5">
          <Plus className="h-4 w-4" /> {t('Adicionar Email')}
        </Button>
      </div>

      {channels.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {channels.map((ch) => (
            <div key={ch.id} className="rounded-2xl border overflow-hidden bg-card shadow-sm hover:shadow-md transition-shadow flex flex-col">
              <div className="px-4 pt-4 pb-3 flex items-start gap-3 bg-blue-500/10">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 dark:bg-black/30 shadow-sm shrink-0">
                  <Mail className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate">{ch.label ?? t('Email')}</p>
                  <p className="text-xs text-muted-foreground truncate">{ch.metadata?.email_address ?? '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 px-4 py-2.5 border-t border-b text-xs text-muted-foreground bg-muted/10">
                <span className="font-mono text-[11px]">IMAP {ch.metadata?.imap_server ?? ''}:{ch.metadata?.imap_port ?? 993}</span>
                <span className="font-mono text-[11px] ml-auto">SMTP {ch.metadata?.smtp_server ?? ''}:{ch.metadata?.smtp_port ?? 587}</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-3 mt-auto">
                <Button size="sm" variant="outline" className="flex-1 gap-1.5 h-8" onClick={() => openEdit(ch)}>
                  <Settings2 className="h-3.5 w-3.5" /> {t('Editar')}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline" className="h-8 px-2.5 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('Eliminar esta caixa?')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('A caixa será removida do CRM. Os emails já recebidos ficam no histórico. Esta ação não pode ser anulada.')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('Cancelar')}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteChannel.mutate(ch.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        {deleteChannel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t('Eliminar')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed p-10 text-center bg-muted/20">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 mx-auto mb-3">
            <Mail className="h-7 w-7 text-blue-500/60" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">{t('Nenhuma caixa de email configurada')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('Clica em "Adicionar Email" para ligar a tua primeira caixa')}</p>
        </div>
      )}

      <div className="rounded-xl border bg-muted/20 p-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Compatibilidade')}</p>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          <li><strong>Gmail</strong> — {t('requer Palavra-passe de App (não a password normal)')}</li>
          <li><strong>Outlook / Office 365</strong> — {t('requer IMAP ativado nas definições do Microsoft 365')}</li>
          <li><strong>{t('Exchange (local)')}</strong> — {t('requer IMAP/SMTP ativado pelo administrador do servidor')}</li>
          <li><strong>{t('Zoho, Mailgun, Postmark, etc.')}</strong> — {t('qualquer servidor IMAP/SMTP padrão')}</li>
        </ul>
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t('As credenciais são guardadas de forma segura e utilizadas pelo servidor para fazer polling IMAP. Cada conta criada aqui equivale a uma caixa independente.')}
        </p>
      </div>
    </div>
  );
}