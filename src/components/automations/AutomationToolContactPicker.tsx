import { useDeferredValue, useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import { useAutomationToolContacts, type AutomationToolContact } from '@/hooks/useAutomationToolContacts';
export function AutomationToolContactPicker({ enabled, selected, onChange, emptyLabel }: {
  readonly enabled: boolean; readonly selected: AutomationToolContact | null;
  readonly onChange: (contact: AutomationToolContact | null) => void; readonly emptyLabel: string;
}) {
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search);
  const contacts = useAutomationToolContacts(enabled, query);
  const id = useId();
  const available = [...(contacts.data ?? [])];
  if (selected && !available.some(item => item.id === selected.id && item.subjectType === selected.subjectType)) available.unshift(selected);
  const key = (item: AutomationToolContact) => `${item.subjectType}:${item.id}`;
  return <div className="space-y-2">
    <Label htmlFor={id}>Contacto para os dados de exemplo</Label>
    <Input id={id} value={search} onChange={event => setSearch(event.target.value)} placeholder="Pesquisar nome nos contactos…" />
    <SearchableCombobox options={available.map(item => ({ value: key(item), label: item.name, sublabel: item.email || item.phone || (item.subjectType === 'lead' ? 'Lead' : 'Cliente') }))} value={selected ? key(selected) : null} onValueChange={value => onChange(available.find(item => key(item) === value) ?? null)} placeholder={contacts.isLoading ? 'A carregar contactos…' : 'Escolher contacto'} searchPlaceholder="Filtrar resultados…" emptyLabel={emptyLabel} />
    {contacts.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar os contactos.</p>}
    {(contacts.data?.length ?? 0) >= 100 && <p className="text-xs text-muted-foreground">Refine o nome para encontrar o contacto nos resultados.</p>}
  </div>;
}
