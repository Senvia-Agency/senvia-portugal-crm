import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { CommissionSplitRow } from './CommissionSplitRow';
import type { CommissionSplit, TelecomTechnology } from '@/types/proposals';

interface Member {
  user_id: string;
  full_name: string;
}

interface Profile {
  id: string;
  name: string;
}

interface CommissionSplitsEditorProps {
  splits: CommissionSplit[];
  members: Member[];
  profiles: Profile[];
  onChange: (splits: CommissionSplit[]) => void;
  /** Called when an edit is finished and should be persisted. */
  onCommit: (splits: CommissionSplit[]) => void;
  /** Passed down so each line shows one value box per technology when there are two. */
  technologies?: TelecomTechnology[];
  /** The product pays extra SIM cards — each line shows whether its person gets them. */
  extraCards?: boolean;
}

/**
 * Who gets paid for one catalog product. Each line is either a named person or
 * a profile, and a profile line pays the seller of the sale when they hold it.
 */
export function CommissionSplitsEditor({
  splits,
  members,
  profiles,
  onChange,
  onCommit,
  technologies,
  extraCards,
}: CommissionSplitsEditorProps) {
  const addLine = () => {
    onCommit([...splits, { kind: 'user', type: 'fixed', value: 0 }]);
  };

  const updateLine = (index: number, updates: Partial<CommissionSplit>, commit = false) => {
    const next = splits.map((s, i) => (i === index ? { ...s, ...updates } : s));
    if (commit) onCommit(next);
    else onChange(next);
  };

  const removeLine = (index: number) => {
    onCommit(splits.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Quem recebe</Label>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={addLine}>
          <Plus className="h-3 w-3 mr-1" />
          Adicionar
        </Button>
      </div>

      {splits.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Sem comissão configurada para este produto.
        </p>
      ) : (
        <div className="space-y-2">
          {splits.map((split, index) => (
            <CommissionSplitRow
              key={index}
              split={split}
              members={members}
              profiles={profiles}
              onChange={(updates, commit) => updateLine(index, updates, commit)}
              onCommit={() => onCommit(splits)}
              onRemove={() => removeLine(index)}
              technologies={technologies}
              extraCards={extraCards}
            />
          ))}

          <p className="text-[11px] text-muted-foreground">
            Uma linha de perfil paga a uma pessoa só, o comercial que fez a venda, e apenas se ele
            tiver esse perfil.
          </p>
        </div>
      )}
    </div>
  );
}
