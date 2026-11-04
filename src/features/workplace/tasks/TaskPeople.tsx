import { useState } from 'react';
import { Plus, X, Check, Search } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/contexts/AuthContext';
import type { TeamMember } from '@/hooks/useTeam';
import type { WorkTask } from './model';
import { useLanguage } from '@/i18n';

interface Props {
  readonly task: WorkTask;
  readonly members: readonly TeamMember[];
  readonly disabled?: boolean;
  readonly onChange: (patch: Partial<WorkTask>) => void;
}
function PersonAvatar({ member, name }: { readonly member?: TeamMember; readonly name: string }) {
  return <Avatar className="work-person-avatar"><AvatarImage src={member?.avatar_url ?? undefined} alt="" /><AvatarFallback>{name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('')}</AvatarFallback></Avatar>;
}
export function TaskPeople({ task, members, disabled, onChange }: Props) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [picker, setPicker] = useState<'owner' | 'participants' | null>(null);
  const [query, setQuery] = useState('');
  const participants = task.participantIds ?? [];
  const nameFor = (id: string) => id === user?.id ? t('Eu') : members.find(member => member.user_id === id)?.full_name || t('Colaborador');
  const chip = (id: string, owner: boolean) => <span className="work-person-chip" key={id}>
    <PersonAvatar member={members.find(member => member.user_id === id)} name={members.find(member => member.user_id === id)?.full_name || nameFor(id)} /><span>{nameFor(id)}</span>
    <button type="button" disabled={disabled} aria-label={owner ? t('Remover responsável {{name}}', { name: nameFor(id) }) : t('Remover participante {{name}}', { name: nameFor(id) })} onClick={() => onChange(owner ? { assignedTo: '' } : { participantIds: participants.filter(value => value !== id) })}><X size={13} /></button>
  </span>;
  const choose = (kind: 'owner' | 'participants') => <Popover open={picker === kind} onOpenChange={open => { setPicker(open ? kind : null); setQuery(''); }}>
    <PopoverTrigger asChild><button type="button" disabled={disabled} className="work-person-add"><Plus size={14} />{kind === 'owner' && task.assignedTo ? t('Trocar') : t('Adicionar')}</button></PopoverTrigger>
    <PopoverPrimitive.Content className="work-people-picker" align="start" sideOffset={6}>
      <label className="work-people-search"><Search size={15} /><input aria-label={t('Procurar membro da equipa')} placeholder={t('Procurar na equipa…')} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="work-people-options" role="group" aria-label={kind === 'owner' ? t('Escolher responsável') : t('Escolher participantes')}>
        {members.filter(member => member.full_name.toLocaleLowerCase('pt').includes(query.toLocaleLowerCase('pt'))).map(member => {
          const selected = kind === 'owner' ? task.assignedTo === member.user_id : participants.includes(member.user_id);
          return <button type="button" key={member.user_id} aria-pressed={selected} onClick={() => {
            if (kind === 'owner') { onChange({ assignedTo: member.user_id }); setPicker(null); }
            else onChange({ participantIds: selected ? participants.filter(id => id !== member.user_id) : [...participants, member.user_id] });
          }}><PersonAvatar member={member} name={member.full_name} /><span>{member.full_name}{member.user_id === user?.id ? ` (${t('Eu')})` : ''}</span>{selected && <Check size={15} />}</button>;
        })}
        {!members.some(member => member.full_name.toLocaleLowerCase('pt').includes(query.toLocaleLowerCase('pt'))) && <p>{t('Nenhum membro encontrado.')}</p>}
      </div>
    </PopoverPrimitive.Content>
  </Popover>;
  return <div className="work-task-people">
    <div className="work-people-field"><span className="work-people-label">{t('Responsável')}</span><div className="work-people-chips">{task.assignedTo && chip(task.assignedTo, true)}{choose('owner')}</div></div>
    <div className="work-people-field"><span className="work-people-label">{t('Participantes')}</span><div className="work-people-chips">{participants.map(id => chip(id, false))}{choose('participants')}</div></div>
  </div>;
}
