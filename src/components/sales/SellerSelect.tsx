import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTeamMembers } from '@/hooks/useTeam';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';

interface SellerSelectProps {
  /** Persisted seller. A null value means the sale has no seller assigned. */
  value: string | null;
  onChange: (userId: string | null) => void;
  /** Fallback name shown to non-admins, who cannot change the assignment. */
  createdByName?: string | null;
  className?: string;
}

/**
 * Who made the sale and gets paid for it. An admin often types in a sale on
 * behalf of a salesperson, and without this the commission would land on the
 * admin instead. Only admins see the selector; everyone else sees the name.
 */
export function SellerSelect({ value, onChange, createdByName, className }: SellerSelectProps) {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const { data: members = [], isLoading } = useTeamMembers();

  const activeMembers = members.filter((m) => !m.is_banned);
  const effectiveValue = value ?? '';
  const selected = activeMembers.find((m) => m.user_id === effectiveValue);

  if (!isAdmin) {
    return (
      <div className={className}>
        <Label>Vendedor</Label>
        <p className="mt-2 text-sm text-muted-foreground">
          {selected?.full_name || createdByName || 'Sem vendedor'}
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <Label htmlFor="seller-select">Vendedor</Label>
      <Select
        // The member list loads asynchronously; if the Select first mounts with
        // a value before its matching item exists, Radix shows a blank trigger
        // forever instead of the name. Remounting once a real value is known
        // (or once the list has actually loaded) sidesteps that.
        key={effectiveValue || (isLoading ? 'loading' : 'ready')}
        value={effectiveValue}
        onValueChange={onChange}
        disabled={isLoading}
      >
        <SelectTrigger id="seller-select">
          <SelectValue placeholder={isLoading ? 'A carregar…' : 'Selecionar vendedor'} />
        </SelectTrigger>
        <SelectContent>
          {activeMembers.map((m) => (
            <SelectItem key={m.user_id} value={m.user_id}>
              {m.full_name}
              {m.user_id === user?.id ? ' (eu)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {value ? 'A comissão desta venda é paga a quem estiver aqui selecionado.' : 'Selecione um vendedor para atribuir a comissão.'}
      </p>
    </div>
  );
}
