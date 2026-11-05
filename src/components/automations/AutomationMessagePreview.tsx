import { useState } from 'react';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AutomationToolContactPicker } from './AutomationToolContactPicker';
import type { AutomationToolContact } from '@/hooks/useAutomationToolContacts';
import { renderAutomationPreview } from '@/lib/automation-editor-tools';
import { automationPreviewVariables } from '@/lib/automation-preview-context';
import { sanitizeEmailHtml } from '@/lib/email-html';
import type { AutomationGraphNode } from '@/types/automations';
export function AutomationMessagePreview({ node, context = {}, templates = [] }: {
  readonly node: AutomationGraphNode;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly templates?: readonly { readonly id: string; readonly subject: string | null; readonly html_content: string | null }[];
}) {
  const [open, setOpen] = useState(false), [contact, setContact] = useState<AutomationToolContact | null>(null);
  if (node.type !== 'send_whatsapp' && node.type !== 'send_email') return null;
  const variables = automationPreviewVariables(context, contact);
  const template = templates.find(item => item.id === node.config.template_id);
  const subject = renderAutomationPreview(node.config.subject || template?.subject || '', variables);
  const body = renderAutomationPreview(node.type === 'send_email' ? node.config.html || template?.html_content || '' : node.config.message || '', variables, node.type === 'send_email');
  const missing = [...new Set([...subject.missing, ...body.missing])];
  const invalid = [...new Set([...(subject.invalid ?? []), ...(body.invalid ?? [])])];
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="outline" size="sm"><Eye className="mr-2 h-4 w-4" />Pré-visualizar mensagem</Button></DialogTrigger>
    <DialogContent className="flex max-h-[85dvh] max-w-2xl flex-col overflow-hidden">
      <DialogHeader><DialogTitle>Pré-visualização da mensagem</DialogTitle><DialogDescription>Veja o conteúdo com os dados de um contacto. Esta pré-visualização não envia mensagens.</DialogDescription></DialogHeader>
      <AutomationToolContactPicker enabled={open} selected={contact} onChange={setContact} emptyLabel="Usar dados da execução" />
      {!!invalid.length && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">Variáveis com formato inválido: {invalid.join(', ')}. Use uma variável, uma omissão entre aspas ou os formatos data e moeda.</p>}
      {!!missing.length && <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">Sem dados para: {missing.join(', ')}. {contact ? 'O contacto escolhido não fornece estes dados nesta pré-visualização.' : 'Estes valores não estão disponíveis nos dados da execução.'}</p>}
      <div className="min-h-0 overflow-y-auto rounded-xl border bg-background p-4">
        {node.type === 'send_email' ? <><p className="mb-4 border-b pb-3 text-sm font-semibold">{subject.text || 'Sem assunto'}</p><div className="break-words text-sm" dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(body.text) }} /></> : <p className="ml-auto max-w-sm whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-primary/10 p-4 text-sm">{body.text || 'A mensagem ainda não tem conteúdo.'}</p>}
      </div>
    </DialogContent>
  </Dialog>;
}
