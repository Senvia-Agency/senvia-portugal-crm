import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { z } from 'zod';
import { TaskPeople } from './TaskPeople';
import { TaskDetails } from './TaskDetails';
import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { TeamMember } from '@/hooks/useTeam';
import { priorities, priorityLabels, statuses, statusLabels, taskSchema, type WorkTask } from './model';
import { tr, useLanguage } from '@/i18n';

interface Props {
  readonly startEditing?: boolean; readonly initial: WorkTask; readonly draftKey: string; readonly members: readonly TeamMember[];
  readonly onClose: () => void; readonly onSave: (task: WorkTask) => Promise<boolean>; readonly saveError?: string | null;
}
function readDraft(key: string, fallback: WorkTask): { task: WorkTask; error: string | null } {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { task: fallback, error: null };
    const result = taskSchema.extend({ title: z.string().max(200) }).safeParse(JSON.parse(raw));
    return result.success ? { task: result.data, error: null } : { task: fallback, error: tr('O rascunho guardado não pôde ser recuperado. Foi preservado.') };
  } catch (error) {
    if (error instanceof DOMException || error instanceof SyntaxError) return { task: fallback, error: tr('Não foi possível recuperar o rascunho. Não feche este painel se tiver alterações por guardar.') };
    throw error;
  }
}
function taskChanged(first: WorkTask, second: WorkTask) {
  const { participantIds: firstPeople = [], ...firstFields } = first;
  const { participantIds: secondPeople = [], ...secondFields } = second;
  return firstPeople.length !== secondPeople.length || firstPeople.some(id => !secondPeople.includes(id))
    || Object.entries(firstFields).some(([key, value]) => Reflect.get(secondFields, key) !== value);
}
function inputDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function TaskEditor({ initial, draftKey, members, onClose, onSave, saveError, startEditing = false }: Props) {
  const { t } = useLanguage();
  const [recovered] = useState(() => readDraft(draftKey, initial));
  const [task, setTask] = useState(recovered.task);
  const [editingFields, setEditingFields] = useState(startEditing || !initial.title || taskChanged(recovered.task, initial));
  const [error, setError] = useState(recovered.error);
  const [submitting, setSubmitting] = useState(false);
  const change = (patch: Partial<WorkTask>) => {
    const next = { ...task, ...patch }; setTask(next);
    if (recovered.error) return;
    try { localStorage.setItem(draftKey, JSON.stringify(next)); setError(null); }
    catch (e) { if (e instanceof DOMException) setError(t('O rascunho ainda não foi guardado neste navegador. Mantenha o painel aberto.')); else throw e; }
  };
  const submit = async () => {
    if (submitting) return;
    if (recovered.error) { setError(t('O rascunho anterior foi preservado. Recupere-o antes de substituir os dados.')); return; }
    const result = taskSchema.safeParse(task);
    if (!result.success) { setError(t('Escreva um título válido (até 200 caracteres).')); return; }
    setSubmitting(true);
    try {
      const saved = await onSave(result.data);
      if (!saved) { setError(t('Não foi possível guardar a tarefa. O rascunho foi mantido; tente novamente.')); return; }
      try { localStorage.removeItem(draftKey); }
      catch (e) { if (e instanceof DOMException) { setError(t('Tarefa guardada, mas não foi possível limpar o rascunho.')); return; } throw e; }
      onClose();
    } catch {
      setError(t('Não foi possível confirmar a gravação da tarefa. O texto continua neste painel e o rascunho foi mantido; tente novamente.'));
    } finally {
      setSubmitting(false);
    }
  };
  const close = () => { if (!submitting) onClose(); };
  if (editingFields) return <Dialog open onOpenChange={open => !open && close()}><DialogContent className="work-task-editor work-task-edit-dialog">
    <DialogHeader><DialogTitle>{initial.title && !startEditing ? t('Editar tarefa') : t('Nova tarefa')}</DialogTitle><DialogDescription className="sr-only">{t('Defina os detalhes da tarefa. O rascunho é preservado até guardar.')}</DialogDescription></DialogHeader>
    <form className="work-task-edit-form" onSubmit={e => { e.preventDefault(); void submit(); }}><fieldset disabled={submitting} className="space-y-4">
      <label className="work-field work-main-field"><span>{t('Título')}</span><Textarea className="work-task-title-input" rows={2} autoFocus required maxLength={200} value={task.title} onChange={e => change({ title: e.target.value })} placeholder={t('O que precisa de ser feito?')} /></label>
      <label className="work-field work-main-field"><span>{t('Descrição')}</span><Textarea className="work-task-description-input" rows={8} maxLength={10000} value={task.description} onChange={e => change({ description: e.target.value })} placeholder={t('Descrição (opcional)')} /></label>
      <TaskPeople task={task} members={members} onChange={change} />
      <div className="work-edit-schedule">
      <label className="work-field">{t('Prazo')}<Input type="datetime-local" value={inputDate(task.dueAt)} onChange={e => change({ dueAt: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
      <div className="work-edit-state">
        <div className="work-field"><span id="task-state-label">{t('Estado')}</span><Select value={task.status} disabled={submitting} onValueChange={value => { const state = taskSchema.shape.status.safeParse(value); if (state.success) change({ status: state.data }); }}><SelectTrigger aria-labelledby="task-state-label"><SelectValue /></SelectTrigger><SelectContent>{statuses.map(status => <SelectItem key={status} value={status}>{t(statusLabels[status])}</SelectItem>)}</SelectContent></Select></div>

      </div>
      </div>
      <fieldset className="work-priority-picker"><legend>{t('Prioridade')}</legend><div>{priorities.map(priority => <button key={priority} type="button" aria-pressed={task.priority === priority} className={"work-priority-choice work-priority-choice--" + priority} onClick={() => change({ priority })}>{t(priorityLabels[priority])}</button>)}</div></fieldset>
      {(error || saveError) && <p role="alert" className="text-sm text-destructive">{saveError || error}</p>}
      {initial.version !== task.version && <div className="rounded-xl border p-3 text-sm"><p>{t('A tarefa mudou na equipa. Guarde uma cópia do seu texto antes de repor os dados atuais.')}</p><Button type="button" variant="outline" className="mt-2" onClick={() => change(initial)}>{t('Repor versão atual')}</Button></div>}
      <p className="text-xs text-muted-foreground">{t('O rascunho fica neste navegador até guardar. Ao guardar, a tarefa é partilhada com a equipa.')}</p>
      <Button className="work-task-save" type="submit">{submitting ? t('A guardar…') : t('Guardar')}</Button>
    </fieldset></form>
  </DialogContent></Dialog>;
  return <Sheet open onOpenChange={open => !open && close()}><SheetContent className="work-task-editor w-full overflow-y-auto sm:max-w-[570px]">
    <SheetHeader className="sr-only"><SheetTitle>{t('Detalhes da tarefa')}</SheetTitle><SheetDescription>{t('Responsável, prazo e progresso da tarefa.')}</SheetDescription></SheetHeader>
    <TaskDetails onChange={change} task={task} members={members} busy={submitting} changed={taskChanged(task, initial)} onStatus={status => change({ status })} onEdit={() => setEditingFields(true)} onSave={() => { void submit(); }} />
    {(error || saveError) && <p role="alert" className="mt-4 text-sm text-destructive">{saveError || error}</p>}
  </SheetContent></Sheet>;
}
