import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Eye, EyeOff, Info, Loader2, Lock, MailCheck, Server, ShieldCheck, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateEmailChannel } from '@/hooks/useEmailChannels';
import { cn } from '@/lib/utils';
import { tileStyle } from '@/features/workplace/feed/FeedPostCard';
import { PROVIDERS, SOURCE_LABEL, discoverServers, type DiscoverySource, type ProviderPreset } from './autodiscover';

/** Full-pane grid shown when no caixa is connected yet (and from "Ligar outra caixa"). */
export function ProviderGrid({ admin, onPick, onBack }: { admin: boolean; onPick: (provider: ProviderPreset) => void; onBack?: () => void }) {
  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-10">
    {onBack && <Button variant="ghost" className="self-start rounded-full" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Voltar ao email</Button>}
    <div className="space-y-2 text-center">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Ligue a caixa de email da empresa</h2>
      <p className="mx-auto max-w-xl text-sm text-muted-foreground">Leia, responda e organize os emails sem sair do Senvia. A caixa fica disponível para quem o administrador escolher.</p>
    </div>
    {admin ? <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {PROVIDERS.map(provider => <li key={provider.key}>
        <button type="button" className="webmail-provider w-full" disabled={provider.microsoft} onClick={() => onPick(provider)}
          aria-describedby={provider.microsoft ? `provider-${provider.key}-note` : undefined}>
          <span className="webmail-provider-mark" style={{ ...tileStyle(provider.tile), background: 'linear-gradient(145deg, hsl(var(--tile-start)), hsl(var(--tile-end)))' }} aria-hidden="true">{provider.mark}</span>
          <span><span className="block text-sm font-semibold">{provider.name}</span><span className="block text-xs text-muted-foreground">{provider.subtitle}</span></span>
          {provider.microsoft && <span id={`provider-${provider.key}-note`} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Ligação Microsoft em breve</span>}
        </button>
      </li>)}
    </ul> : <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Ainda não tem acesso a nenhuma caixa de email. Peça ao administrador da organização para ligar uma caixa e a partilhar consigo.</p>}
    <ul className="grid gap-3 text-sm sm:grid-cols-3">
      {[{ icon: Zap, text: 'Emails novos chegam em segundos e avisam no telemóvel.' },
        { icon: ShieldCheck, text: 'As palavras-passe ficam cifradas no servidor; o browser nunca as recebe de volta.' },
        { icon: MailCheck, text: 'Assinaturas, listas de contactos e rascunhos guardados automaticamente.' }].map(item =>
        <li key={item.text} className="flex items-start gap-3 rounded-2xl bg-primary/5 p-4"><item.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span className="text-muted-foreground">{item.text}</span></li>)}
    </ul>
  </div>;
}

interface Form { label: string; email: string; password: string; imapHost: string; imapPort: string; smtpHost: string; smtpPort: string }

/** IMAP/SMTP connection (Gmail, iCloud and Yahoo with an app password). The gateway starts syncing within a minute. */
export function ConnectMailDialog({ provider, onClose, onConnected }: { provider: ProviderPreset; onClose: () => void; onConnected: (channelId: string) => void }) {
  const create = useCreateEmailChannel();
  const [form, setForm] = useState<Form>({ label: '', email: '', password: '', imapHost: provider.servers?.imapHost ?? '', imapPort: String(provider.servers?.imapPort ?? 993), smtpHost: provider.servers?.smtpHost ?? '', smtpPort: String(provider.servers?.smtpPort ?? 465) });
  const [showServers, setShowServers] = useState(provider.key === 'imap');
  const [showPassword, setShowPassword] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [source, setSource] = useState<DiscoverySource | null>(provider.servers ? 'known' : null);
  const [note, setNote] = useState<string | null>(null);
  const [microsoft, setMicrosoft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Discovery fills the servers only until the person edits one by hand.
  const touched = useRef(false);
  const set = (patch: Partial<Form>) => setForm(current => ({ ...current, ...patch }));

  useEffect(() => {
    if (provider.servers || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(form.email.trim())) { setMicrosoft(false); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setDiscovering(true);
      const found = await discoverServers(form.email.trim());
      if (!active) return;
      setDiscovering(false);
      setMicrosoft(found?.kind === 'microsoft');
      if (found?.kind === 'servers' && !touched.current) {
        set({ imapHost: found.servers.imapHost, imapPort: String(found.servers.imapPort), smtpHost: found.servers.smtpHost, smtpPort: String(found.servers.smtpPort) });
        setSource(found.source);
        setNote(found.note ?? null);
        if (found.source === 'guess') setShowServers(true);
      }
    }, 600);
    return () => { active = false; window.clearTimeout(timer); };
  }, [form.email, provider.servers]);

  const submit = async () => {
    setError(null);
    const email = form.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Escreva um endereço de email válido.'); return; }
    if (!form.password) { setError('Escreva a palavra-passe (ou a palavra-passe de aplicação).'); return; }
    if (!form.imapHost.trim() || !form.smtpHost.trim()) { setShowServers(true); setError('Faltam os servidores IMAP e SMTP.'); return; }
    const imapPort = Number(form.imapPort) || 993;
    const smtpPort = Number(form.smtpPort) || 465;
    try {
      const result = await create.mutateAsync({
        label: form.label.trim() || email,
        email_config: {
          email_address: email,
          imap_server: form.imapHost.trim(), imap_port: imapPort, imap_ssl: imapPort === 993, imap_login: email, imap_password: form.password,
          // 465 is implicit TLS; 587 and 25 upgrade with STARTTLS.
          smtp_server: form.smtpHost.trim(), smtp_port: smtpPort, smtp_ssl: smtpPort === 465, smtp_login: email, smtp_password: form.password,
          provider_key: provider.key,
        },
      });
      toast.success('Caixa ligada', { description: 'A sincronização começa dentro de um minuto.' });
      onConnected(result.channel_id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível ligar a caixa.');
    }
  };

  return <Dialog open onOpenChange={open => { if (!open && !create.isPending) onClose(); }}>
    <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0" onInteractOutside={event => event.preventDefault()}>
      <DialogHeader className="flex-row items-center gap-3 space-y-0 border-b px-5 py-4 pr-14 text-left md:px-8">
        <span className="webmail-provider-mark !h-10 !w-10" style={{ ...tileStyle(provider.tile), background: 'linear-gradient(145deg, hsl(var(--tile-start)), hsl(var(--tile-end)))' }} aria-hidden="true">{provider.mark}</span>
        <div><DialogTitle className="text-xl">Ligar {provider.name}</DialogTitle><DialogDescription>{provider.subtitle}</DialogDescription></div>
      </DialogHeader>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8">
          <div className="mx-auto max-w-xl space-y-5">
            {provider.help && <p className="flex items-start gap-2 rounded-2xl bg-primary/5 p-4 text-sm text-muted-foreground"><Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />{provider.help}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="connect-email">Endereço de email</Label>
              <Input id="connect-email" type="email" autoComplete="off" value={form.email} onChange={event => set({ email: event.target.value })} placeholder="nome@empresa.pt" />
            </div>
            {microsoft ? <p role="status" className="rounded-2xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Este endereço é da Microsoft (Outlook ou Microsoft 365), que já não aceita ligar com palavra-passe. A ligação com a conta Microsoft chega na próxima fase do WebMail.
            </p> : <>
              <div className="space-y-1.5">
                <Label htmlFor="connect-password">Palavra-passe (ou de aplicação)</Label>
                <div className="relative">
                  <Input id="connect-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.password} onChange={event => set({ password: event.target.value })} className="pr-11" />
                  <button type="button" className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? 'Esconder palavra-passe' : 'Mostrar palavra-passe'} onClick={() => setShowPassword(value => !value)}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="connect-label">Nome da caixa <span className="font-normal text-muted-foreground">(opcional)</span></Label>
                <Input id="connect-label" value={form.label} maxLength={60} onChange={event => set({ label: event.target.value })} placeholder="Ex.: Comercial, Suporte" />
              </div>
              <div className="rounded-2xl border">
                <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium" aria-expanded={showServers} onClick={() => setShowServers(value => !value)}>
                  <Server className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Servidores
                  <span className="ml-2 min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground">
                    {discovering ? 'A procurar…' : source ? SOURCE_LABEL[source] : 'Escreva o email para os procurar'}
                  </span>
                  {discovering ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', showServers && 'rotate-180')} />}
                </button>
                {showServers && <div className="grid gap-3 border-t p-4 sm:grid-cols-[1fr_6rem]">
                  <div className="space-y-1"><Label htmlFor="imap-host" className="text-xs">Servidor IMAP</Label><Input id="imap-host" value={form.imapHost} onChange={event => { touched.current = true; set({ imapHost: event.target.value }); }} /></div>
                  <div className="space-y-1"><Label htmlFor="imap-port" className="text-xs">Porta</Label><Input id="imap-port" inputMode="numeric" value={form.imapPort} onChange={event => { touched.current = true; set({ imapPort: event.target.value.replace(/\D/g, '') }); }} /></div>
                  <div className="space-y-1"><Label htmlFor="smtp-host" className="text-xs">Servidor SMTP</Label><Input id="smtp-host" value={form.smtpHost} onChange={event => { touched.current = true; set({ smtpHost: event.target.value }); }} /></div>
                  <div className="space-y-1"><Label htmlFor="smtp-port" className="text-xs">Porta</Label><Input id="smtp-port" inputMode="numeric" value={form.smtpPort} onChange={event => { touched.current = true; set({ smtpPort: event.target.value.replace(/\D/g, '') }); }} /></div>
                  <p className="text-xs text-muted-foreground sm:col-span-2"><Lock className="mr-1 inline h-3 w-3" aria-hidden="true" />IMAP 993 e SMTP 465 usam SSL; 587 usa STARTTLS.</p>
                </div>}
              </div>
              {note && <p className="text-xs text-muted-foreground">{note}</p>}
            </>}
            {error && <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t bg-background px-5 py-4 md:px-8">
          <Button type="button" variant="outline" className="rounded-full" disabled={create.isPending} onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="rounded-full" disabled={create.isPending || microsoft}>{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Ligar caixa</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
