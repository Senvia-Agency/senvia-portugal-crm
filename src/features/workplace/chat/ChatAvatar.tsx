import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, Hash, Search, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TeamMember } from '@/hooks/useTeam';
import type { ChatKind } from './chat-model';

// A stable hue per person, the same rule as the Feed avatars.
const hueOf = (name: string) => [...name].reduce((hue, character) => (hue * 31 + character.charCodeAt(0)) % 360, 0);
const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();

export function PersonAvatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, '--chat-hue': hueOf(name), fontSize: Math.max(11, size * 0.32) } as CSSProperties;
  return url && !broken
    ? <img src={url} alt="" style={style} className="chat-avatar object-cover" onError={() => setBroken(true)} />
    : <span aria-hidden="true" style={style} className="chat-avatar chat-avatar--initials">{initials(name) || '?'}</span>;
}

/** Group and channel conversations get a dimensional tile instead of a face. */
export function ConversationAvatar({ kind, name, url, size = 44 }: { kind: ChatKind; name: string; url?: string | null; size?: number }) {
  if (kind === 'direct') return <PersonAvatar name={name} url={url} size={size} />;
  const Icon = kind === 'channel' ? Hash : Users;
  return <span aria-hidden="true" className={cn('chat-avatar chat-tile', kind === 'channel' ? 'chat-tile--channel' : 'chat-tile--group')} style={{ width: size, height: size }}>
    <Icon style={{ width: size * 0.45, height: size * 0.45 }} />
  </span>;
}

/** Searchable list of colleagues, single or multiple choice. */
export function PeoplePicker({ people, selected, onToggle, excludeIds = [], multiple }: {
  people: readonly TeamMember[]; selected: readonly string[]; onToggle: (userId: string) => void; excludeIds?: readonly string[]; multiple: boolean;
}) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLocaleLowerCase('pt');
  const list = people.filter(person => !excludeIds.includes(person.user_id) && person.full_name.toLocaleLowerCase('pt').includes(term));
  return <div className="space-y-3">
    <label className="flex h-11 items-center gap-2 rounded-full border bg-card px-4 focus-within:ring-2 focus-within:ring-ring">
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Procurar colega…" aria-label="Procurar colega" value={query} onChange={event => setQuery(event.target.value)} />
    </label>
    <div role="group" aria-label="Colegas" className="grid gap-1.5 sm:grid-cols-2">
      {list.map(person => {
        const isSelected = selected.includes(person.user_id);
        return <button key={person.user_id} type="button" aria-pressed={isSelected} aria-label={person.full_name} onClick={() => onToggle(person.user_id)}
          className={cn('flex min-h-14 items-center gap-3 rounded-2xl border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isSelected && 'border-primary bg-primary/10 ring-1 ring-primary')}>
          <PersonAvatar name={person.full_name} url={person.avatar_url} size={36} />
          <span className="min-w-0 flex-1 truncate font-medium">{person.full_name}</span>
          {multiple && <span aria-hidden="true" className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-md border', isSelected && 'border-primary bg-primary text-primary-foreground')}>{isSelected && <Check className="h-3.5 w-3.5" />}</span>}
        </button>;
      })}
      {list.length === 0 && <p className="text-sm text-muted-foreground">Nenhum colega encontrado.</p>}
    </div>
  </div>;
}
