import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Copy, FlaskConical, KeyRound, Loader2, X } from 'lucide-react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
async function failureMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    try {
      const body: unknown = await error.context.json();
      if (record(body) && typeof body.error === 'string') {
        return body.error === 'MFA_REQUIRED' ? 'Confirme a autenticação em dois passos para continuar.' : body.error;
      }
    } catch {
      return 'Não foi possível ler a resposta. Tente novamente.';
    }
  }
  return error instanceof Error ? error.message : 'Não foi possível comunicar com o webhook.';
}

export function IncomingHookSettings() {
  const { id } = useParams<{ id: string }>();
  const { roles } = useAuth();
  if (!id) return <p className="text-sm text-muted-foreground">Guarde a automação para configurar a ligação.</p>;
  if (!roles.includes('admin') && !roles.includes('super_admin')) {
    return <p className="text-sm text-muted-foreground">Um administrador pode configurar e testar esta ligação.</p>;
  }
  return <HookControls key={id} flowId={id} />;
}

function HookControls({ flowId }: { flowId: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [payload, setPayload] = useState('{\n  "name": "Contacto de teste",\n  "email": "teste@example.com"\n}');
  const [preview, setPreview] = useState<Readonly<Record<string, unknown>> | null>(null);
  const [busy, setBusy] = useState<'rotate' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const baseUrl = `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, '')}/functions/v1/automation-hook`;
  const productionUrl = `${baseUrl}?flow_id=${encodeURIComponent(flowId)}`;
  const testUrl = `${productionUrl}&action=test`;

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copiado');
    } catch {
      toast.error('Não foi possível copiar. Selecione e copie o texto.');
    }
  }
  async function rotate() {
    setBusy('rotate');
    setError(null);
    setSecret(null);
    try {
      const result = await supabase.functions.invoke<unknown>(`automation-hook?flow_id=${encodeURIComponent(flowId)}&action=rotate`, { body: {} });
      if (result.error) throw result.error;
      if (!record(result.data) || typeof result.data.secret !== 'string') throw new Error('O serviço não devolveu a chave.');
      setSecret(result.data.secret);
    } catch (cause) {
      setError(await failureMessage(cause));
    } finally {
      setBusy(null);
    }
  }
  async function test() {
    setError(null);
    setPreview(null);
    let body: unknown;
    try { body = JSON.parse(payload); } catch {
      setError('O pedido precisa de ser um objeto JSON válido.');
      return;
    }
    if (!record(body)) {
      setError('O pedido precisa de ser um objeto JSON válido.');
      return;
    }
    setBusy('test');
    try {
      const result = await supabase.functions.invoke<unknown>(`automation-hook?flow_id=${encodeURIComponent(flowId)}&action=test`, { body });
      if (result.error) throw result.error;
      if (!record(result.data) || !record(result.data.preview) || result.data.executed !== false) throw new Error('Resposta de teste inesperada.');
      setPreview(result.data.preview);
    } catch (cause) {
      setError(await failureMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border p-4" aria-label="Ligação de entrada">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Ligação de entrada</h3>
        <p className="text-sm text-muted-foreground">Guarde a automação e o mapeamento antes de configurar a aplicação de origem.</p>
      </div>
      <UrlField label="URL de produção" value={productionUrl} onCopy={() => copy(productionUrl)} />
      <p className="text-sm text-muted-foreground">Envie um pedido POST com o cabeçalho x-senvia-hook-secret. A produção recebe contactos quando a automação está ativa.</p>
      <div className="space-y-2">
        <Button type="button" variant="outline" disabled={busy !== null} onClick={rotate}>
          {busy === 'rotate' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
          Gerar ou substituir chave
        </Button>
        <p className="text-sm text-muted-foreground">Substituir a chave desativa imediatamente a anterior. Atualize a aplicação de origem.</p>
        {secret && (
          <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <Label htmlFor="incoming-hook-secret">Chave apresentada uma única vez</Label>
            <Input id="incoming-hook-secret" readOnly value={secret} autoComplete="off" className="font-mono text-sm" />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => copy(secret)}><Copy className="mr-2 h-4 w-4" />Copiar chave</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setSecret(null)}><X className="mr-2 h-4 w-4" />Ocultar</Button>
            </div>
          </div>
        )}
      </div>
      <div className="space-y-3 border-t border-border pt-4">
        <UrlField label="URL de teste" value={testUrl} onCopy={() => copy(testUrl)} />
        <p className="text-sm text-muted-foreground">O teste verifica os dados mapeados. Requer a sessão de administrador e não inicia a automação.</p>
        <Label htmlFor="incoming-hook-payload">Pedido de exemplo</Label>
        <Textarea id="incoming-hook-payload" value={payload} onChange={event => setPayload(event.target.value)} rows={6} className="font-mono text-sm" spellCheck={false} />
        <Button type="button" variant="outline" disabled={busy !== null} onClick={test}>
          {busy === 'test' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
          Verificar dados
        </Button>
        {preview && <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-sm" aria-label="Dados mapeados">{JSON.stringify(preview, null, 2)}</pre>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
function UrlField({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  const id = label === 'URL de produção' ? 'incoming-hook-production' : 'incoming-hook-test';
  return <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <div className="flex gap-2">
      <Input id={id} readOnly value={value} className="min-w-0 font-mono text-sm" />
      <Button type="button" variant="outline" size="icon" aria-label={`Copiar ${label}`} onClick={onCopy}><Copy className="h-4 w-4" /></Button>
    </div>
  </div>;
}
