import { CalendarDays, MessageSquare, ArrowUpRight, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { priorityLabels, statusLabels, type WorkTask, type TaskStatus } from './model';

interface Props {
  readonly task: WorkTask; readonly assignee: string; readonly compact?: boolean; readonly busy?: boolean;
  readonly onOpen: (task: WorkTask) => void; readonly onStatus: (task: WorkTask, status: TaskStatus) => void;
}
export function TaskCard({ task, assignee, compact, busy = false, onOpen, onStatus }: Props) {
  const overdue = task.status !== 'done' && !!task.dueAt && Date.parse(task.dueAt) < Date.now();
  if (!compact) return <article className="work-task work-task--row">
    <button type="button" disabled={busy} aria-label={(task.status === 'done' ? 'Reabrir ' : 'Concluir ') + task.title}
      className={cn('work-task-check', task.status === 'done' && 'work-task-check--done')}
      onClick={() => onStatus(task, task.status === 'done' ? 'todo' : 'done')}><Check size={15} /></button>
    <button type="button" className="work-task-open" onClick={() => onOpen(task)}>
      <span className="work-task-title">{task.title}</span>
      {task.dueAt && <span className={cn('work-task-date', overdue && 'work-overdue')}><CalendarDays size={13} />{new Date(task.dueAt).toLocaleString('pt-PT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
    </button>
    {task.phone && <Link aria-label={'Abrir conversa de ' + task.title} className="work-task-source" to={'/inbox?phone=' + encodeURIComponent(task.phone)}><MessageSquare size={15} /></Link>}
    <span className={'work-priority work-priority--' + task.priority}>{priorityLabels[task.priority]}</span>
    <span className="work-avatar work-task-assignee" title={assignee} aria-label={assignee}>{assignee.split(' ').filter(Boolean).slice(0, 2).map(name => name[0]).join('')}</span>
  </article>;
  return <article className={cn('work-task', compact && 'work-task--board')}>
    <button type="button" disabled={busy} aria-label={`${task.status === 'done' ? 'Reabrir' : 'Concluir'} ${task.title}`}
      className={cn('work-task-check', task.status === 'done' && 'work-task-check--done')}
      onClick={() => onStatus(task, task.status === 'done' ? 'todo' : 'done')}><Check size={14} /></button>
    <div className="min-w-0 flex-1">
      <button type="button" className="work-task-title" onClick={() => onOpen(task)}>{task.title}</button>
      {task.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className={`work-priority work-priority--${task.priority}`}>{priorityLabels[task.priority]}</span>
        {task.dueAt && <span className={cn('inline-flex items-center gap-1', overdue && 'font-medium work-overdue')}><CalendarDays size={13} />{new Date(task.dueAt).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })}{overdue && ' · Em atraso'}</span>}
        {task.source === 'inbox' && <span className="inline-flex items-center gap-1"><MessageSquare size={13} />{task.contactName || 'Inbox'}</span>}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><span className="work-avatar">{assignee.slice(0, 1)}</span>{assignee}</span>
        <select disabled={busy} aria-label={`Estado de ${task.title}`} value={task.status} className="work-status-select" onChange={e => { const status = e.target.value; if (status === 'todo' || status === 'doing' || status === 'done') onStatus(task, status); }}>
          {Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      {task.phone && <Link className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary" to={`/inbox?phone=${encodeURIComponent(task.phone)}`}>Abrir conversa <ArrowUpRight size={13} /></Link>}
    </div>
  </article>;
}
