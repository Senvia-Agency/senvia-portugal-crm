import { useState } from 'react';
import { CalendarPlus, ListTodo, Printer } from 'lucide-react';
import DOMPurify from 'dompurify';
import { Button } from '@/components/ui/button';
import { CreateEventModal } from '@/components/calendar/CreateEventModal';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers } from '@/hooks/useTeam';
import type { EmailMessage } from '@/hooks/useEmail';
import { TaskEditor } from '@/features/workplace/tasks/TaskEditor';
import { emptyTask } from '@/features/workplace/tasks/model';
import { useOrganizationTasks } from '@/features/workplace/tasks/useOrganizationTasks';
import { escapeEmailText } from '@/lib/email-html';
import { toast } from 'sonner';

function emailContext(message: EmailMessage) {
  return [`Email de ${message.from_name || ''} <${message.from_address || ''}>`,
    `Assunto: ${message.subject || '(sem assunto)'}`, message.date || '', '',
    message.text_body || message.snippet || ''].join('\n').slice(0, 10000);
}

function EmailTask({ message, onClose }: { message: EmailMessage; onClose: () => void }) {
  const { user } = useAuth();
  const { data: members = [] } = useTeamMembers();
  const tasks = useOrganizationTasks();
  const [initial] = useState(() => ({ ...emptyTask(user?.id || ''),
    title: (message.subject || 'Seguimento de email').slice(0, 200), description: emailContext(message) }));
  if (!tasks.scopeKey) return null;
  return <TaskEditor startEditing initial={initial} members={members}
    draftKey={`${tasks.scopeKey}:email:${message.id}`} onClose={onClose} saveError={tasks.saveError}
    onSave={async task => { const saved = await tasks.save(task); if (saved) toast.success('Tarefa criada e partilhada com a equipa.'); return saved; }} />;
}

function EmailEvent({ message, onClose }: { message: EmailMessage; onClose: () => void }) {
  const [date] = useState(() => new Date());
  return <CreateEventModal open onOpenChange={open => !open && onClose()} selectedDate={date}
    initialTitle={(message.subject || 'Seguimento de email').slice(0, 200)} initialDescription={emailContext(message)} />;
}

function printEmail(message: EmailMessage, button: HTMLButtonElement) {
  button.ownerDocument.querySelector('iframe[title="Impressão do email"]')?.remove();
  const frame = button.ownerDocument.createElement('iframe');
  frame.title = 'Impressão do email';
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;bottom:0;right:0';
  const rendered = button.closest('.inbox-email-reading')?.querySelector<HTMLIFrameElement>('iframe[title="Email"]');
  const body = rendered?.contentDocument?.body.innerHTML || message.html_body
    || `<pre>${escapeEmailText(message.text_body || message.snippet || '')}</pre>`;
  const safeBody = DOMPurify.sanitize(body, { FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link'], FORBID_ATTR: ['srcdoc'] });
  frame.onload = () => {
    const target = frame.contentWindow;
    if (!target) { frame.remove(); toast.error('Não foi possível abrir a impressão.'); return; }
    target.addEventListener('afterprint', () => frame.remove(), { once: true });
    target.focus(); target.print();
  };
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline';"><title>${escapeEmailText(message.subject || 'Email')}</title><style>body{font:14px/1.6 sans-serif;margin:24px;color:#18181b}header{border-bottom:1px solid #ddd;margin-bottom:24px;padding-bottom:16px}h1{font-size:22px}img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style></head><body><header><h1>${escapeEmailText(message.subject || '(sem assunto)')}</h1><div>De: ${escapeEmailText(message.from_name || '')} &lt;${escapeEmailText(message.from_address || '')}&gt;</div><div>Para: ${escapeEmailText(message.to_addresses.map(a => a.address).join(', '))}</div><div>${escapeEmailText(message.date || '')}</div></header>${safeBody}</body></html>`;
  button.ownerDocument.body.append(frame);
}

export function EmailWorkflowActions({ message }: { message: EmailMessage }) {
  const [workflow, setWorkflow] = useState<'task' | 'event' | null>(null);
  return <>
    <Button size="sm" variant="ghost" onClick={() => setWorkflow('task')}><ListTodo className="mr-1.5 h-4 w-4 text-emerald-600" />Criar tarefa</Button>
    <Button size="sm" variant="ghost" onClick={() => setWorkflow('event')}><CalendarPlus className="mr-1.5 h-4 w-4 text-rose-500" />Criar evento</Button>
    <Button size="sm" variant="ghost" disabled={!message.body_fetched} onClick={event => printEmail(message, event.currentTarget)}><Printer className="mr-1.5 h-4 w-4" />Imprimir</Button>
    {workflow === 'task' && <EmailTask message={message} onClose={() => setWorkflow(null)} />}
    {workflow === 'event' && <EmailEvent message={message} onClose={() => setWorkflow(null)} />}
  </>;
}
