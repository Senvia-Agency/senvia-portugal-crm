import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { ImportPerson } from '@/lib/import/records';
import { useLanguage } from '@/i18n';

export const NOBODY = '__nobody__';

interface DealImportSettingsProps {
  readonly people: readonly (ImportPerson & { is_banned?: boolean | null })[];
  readonly seller: string;
  readonly onSeller: (value: string) => void;
  readonly createClients: boolean;
  readonly onCreateClients: (value: boolean) => void;
  /** The state (and payment, for sales) a line takes when its cell is empty. */
  readonly children?: ReactNode;
}

/** What applies to every line of a proposals or sales import. */
export function DealImportSettings({ people, seller, onSeller, createClients, onCreateClients, children }: DealImportSettingsProps) {
  const { t } = useLanguage();
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">{t("Comercial quando a linha não diz")}</Label>
          <Select value={seller} onValueChange={onSeller}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NOBODY}>{t("Eu")}</SelectItem>
              {people.filter((person) => !person.is_banned).map((person) => (
                <SelectItem key={person.user_id} value={person.user_id}>{person.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {children}
      </div>
      <label className="flex max-w-xl cursor-pointer items-start justify-between gap-4 rounded-lg border p-3">
        <span>
          <span className="block text-sm font-medium">{t("Criar os clientes que não existem")}</span>
          <span className="block text-xs text-muted-foreground">
            {t("O cliente é procurado pelo código, NIF, email e nome. Desligado, as linhas de clientes desconhecidos ficam de fora.")}
          </span>
        </span>
        <Switch checked={createClients} onCheckedChange={onCreateClients} />
      </label>
    </>
  );
}
