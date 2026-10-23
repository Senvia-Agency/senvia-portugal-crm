import { TaskPeople } from './TaskPeople';
import { CalendarDays, Pencil, Save } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import type { TeamMember } from '@/hooks/useTeam';
import { statuses, statusLabels, priorityLabels, type WorkTask, type TaskStatus } from './model';

interface Props {
  readonly task: WorkTask;
  readonly members: readonly TeamMember[];
  readonly busy: boolean;
  readonly changed: boolean;
  readonly onStatus: (status: TaskStatus) => void;
  readonly onEdit: () => void;
  readonly onSave: () => void;
  readonly onChange: (patch: Partial<WorkTask>) => void;
}
export function TaskDetails({ task, members, busy, changed, onStatus, onEdit, onSave, onChange }: Props) {
  const overdue = task.status !== 'done' && !!task.dueAt && Date.parse(task.dueAt) < Date.now();
  return <div className="work-task-details">
    <div className="work-detail-statuses" aria-label="Estado da tarefa">{statuses.map(status => <button type="button" disabled={busy} key={status} aria-pressed={task.status === status} className={'work-detail-status work-detail-status--' + status} onClick={() => onStatus(status)}><span />{statusLabels[status]}</button>)}</div>
    <h2>{task.title}</h2>
    {task.description && <p className="work-detail-description">{task.description}</p>}
    <dl className="work-detail-properties">
      <div className="work-detail-people"><TaskPeople task={task} members={members} onChange={onChange} disabled={busy} /></div>
      <dt>Prazo</dt><dd className={overdue ? 'work-overdue' : undefined}><CalendarDays size={15} />{task.dueAt ? new Date(task.dueAt).toLocaleString('pt-PT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'Sem prazo'}</dd>
      <dt>Prioridade</dt><dd><span className={'work-priority work-priority--' + task.priority}>{priorityLabels[task.priority]}</span></dd>
      <dt>Criada em</dt><dd>{new Date(task.createdAt).toLocaleDateString('pt-PT')}</dd>
      {task.source === 'inbox' && <><dt>Origem</dt><dd>{task.contactName || 'Inbox'}</dd></>}
    </dl>
    {task.phone && <Link className="work-detail-conversation" to={'/inbox?phone=' + encodeURIComponent(task.phone)}>Abrir conversa no Inbox</Link>}
    <div className="work-detail-actions"><Button type="button" variant="secondary" onClick={onEdit}><Pencil size={15} className="mr-2" />Editar</Button>{changed && <Button type="button" disabled={busy} onClick={onSave}><Save size={15} className="mr-2" />{busy ? 'A guardar…' : 'Guardar alterações'}</Button>}</div>
  </div>;
}
