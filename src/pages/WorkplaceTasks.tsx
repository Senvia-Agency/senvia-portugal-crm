import { useState } from 'react';
import { CheckCheck, Columns3, List, Plus, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers } from '@/hooks/useTeam';
import { Button } from '@/components/ui/button';
import { TaskCard } from '@/features/workplace/tasks/TaskCard';
import { TaskEditor } from '@/features/workplace/tasks/TaskEditor';
import { useOrganizationTasks } from '@/features/workplace/tasks/useOrganizationTasks';
import { emptyTask, filterTasks, statuses, statusLabels, type TaskScope, type WorkTask } from '@/features/workplace/tasks/model';
import '@/features/workplace/tasks/tasks.css';

const scopes: readonly { key: TaskScope; label: string }[] = [
  { key: 'mine', label: 'As minhas' }, { key: 'team', label: 'Todas' }, { key: 'overdue', label: 'Em atraso' }, { key: 'done', label: 'Concluídas' },
];
export default function WorkplaceTasks() {
  const { user, organization, profile } = useAuth();
  const team = useTeamMembers();
  const shared = useOrganizationTasks();
  const [scope, setScope] = useState<TaskScope>('mine');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'board'>('list');
  const [editing, setEditing] = useState<{ task: WorkTask; scopeKey: string } | null>(null);
  const tasks = shared.data ?? [];
  const visible = filterTasks(tasks, { scope, userId: user?.id ?? '', query, now: Date.now() });
  const members = team.data ?? [];
  const assignee = (id: string) => members.find(m => m.user_id === id)?.full_name || (id === user?.id ? profile?.full_name || 'Eu' : id ? 'Colaborador' : 'Sem responsável');
  const editorMembers = members.some(m => m.user_id === user?.id) || !user ? members : [...members, { id: user.id, user_id: user.id, full_name: profile?.full_name || 'Eu', role: 'viewer' as const, avatar_url: null, email: null, phone: null, organization_id: organization?.id ?? null, is_banned: false }];
  const open = (task: WorkTask) => { if (shared.scopeKey) setEditing({ task, scopeKey: shared.scopeKey }); };
  const active = tasks.filter(t => t.status !== 'done').length;
  const card = (task: WorkTask) => <TaskCard key={task.id} task={task} assignee={assignee(task.assignedTo)} compact={view === 'board'} onOpen={open} busy={shared.saving} onStatus={shared.setStatus} />;
  return <div className="workplace-tasks workplace-tasks--reference p-4 pb-nav-safe md:p-7">

    <header className="work-heading">
      <div><h1>Tarefas <span>{active}</span></h1></div>
      <Button onClick={() => user && open(emptyTask(user.id))}><Plus size={17} className="mr-2" />Nova tarefa</Button>
    </header>
    <div className="work-tasks-layout"><section className="min-w-0">
      <div className="work-toolbar">
        <div className="work-segments" aria-label="Vista de tarefas">
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={16} />Lista</button>
          <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}><Columns3 size={16} />Quadro</button>
        </div>
        <div className="work-scopes">{scopes.map(s => <button key={s.key} type="button" aria-pressed={scope === s.key} onClick={() => setScope(s.key)}>{s.label}</button>)}</div>
        <label className="work-search"><Search size={16} /><input aria-label="Procurar tarefas" placeholder="Procurar tarefa…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      </div>
      {shared.saveError && <p role="alert" className="mb-4 rounded-xl work-error p-4 text-sm">{shared.saveError}</p>}
      {shared.isError && <div role="alert" className="mb-4 rounded-xl work-warning p-4 text-sm">Não foi possível carregar as tarefas da organização. <button className="font-semibold underline" onClick={() => shared.refetch()}>Tentar novamente</button></div>}
      {shared.isLoading && <p className="py-4 text-sm text-muted-foreground" role="status">A carregar tarefas da equipa…</p>}
      {view === 'board' ? <div className="work-board">{statuses.map(s => <section key={s} className={`work-lane work-lane--${s}`}>
        <h2><span />{statusLabels[s]}<small>{visible.filter(t => t.status === s).length}</small></h2>
        <div className="space-y-3">{visible.filter(t => t.status === s).map(card)}{!visible.some(t => t.status === s) && <p className="work-lane-empty">Sem tarefas nesta coluna</p>}</div>
      </section>)}</div> : <div className="work-task-list">{visible.map(card)}</div>}
      {!shared.isLoading && visible.length === 0 && view === 'list' && <div className="work-empty">
        <span><CheckCheck size={28} /></span><h2>{query ? 'Nenhuma tarefa encontrada' : scope === 'done' ? 'As conquistas vão aparecer aqui' : 'Abre espaço para o que vem a seguir'}</h2>
        <p>{query ? 'Experimenta outro termo ou muda o filtro.' : 'Cria uma tarefa ou acompanha aqui os próximos passos das tuas conversas.'}</p>
        <Button variant="outline" onClick={() => user && open(emptyTask(user.id))}><Plus size={16} className="mr-2" />Criar tarefa</Button>
      </div>}
    </section></div>
    {editing && editing.scopeKey === shared.scopeKey && <TaskEditor key={`${editing.scopeKey}:${editing.task.id}`} initial={tasks.find(t => t.id === editing.task.id) ?? editing.task} draftKey={`${editing.scopeKey}:draft:${editing.task.title ? editing.task.id : 'new'}`} members={editorMembers} onSave={shared.save} saveError={shared.saveError} onClose={() => setEditing(null)} />}
  </div>;
}
