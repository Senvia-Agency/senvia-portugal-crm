import { useEffect, useState } from 'react';
import { Radio, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  useOperators,
  useCreateOperator,
  useUpdateOperator,
  useDeleteOperator,
  type Operator,
  type OperatorKind,
  type CommissionBasis,
  type VolumeScope,
} from '@/hooks/useOperators';
import { useLanguage } from '@/i18n';

const KIND_LABELS: Record<OperatorKind, string> = {
  telecom: 'Telecomunicação',
  energia: 'Energia',
};

const BASIS_LABELS: Record<CommissionBasis, string> = {
  per_sale: 'Por venda',
  monthly_volume: 'Volume mensal acumulado',
};

const SCOPE_LABELS: Record<VolumeScope, string> = {
  per_seller: 'Por vendedor',
  org_total: 'Total da organização',
};

export function OperatorsTab() {
  const { data: operators = [], isLoading } = useOperators();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Operator | null>(null);
  const [deleting, setDeleting] = useState<Operator | null>(null);
  const deleteOperator = useDeleteOperator();
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-5 w-5" />
              {t('Operadoras')}
            </CardTitle>
            <CardDescription>
              {t('Operadoras de telecomunicação ou energia. Cada produto do catálogo pode ser ligado a uma.')}
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            {t('Nova Operadora')}
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : operators.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Radio className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>{t('Ainda não tem operadoras configuradas.')}</p>
              <p className="text-sm">{t('Adicione uma para a poder escolher nos produtos.')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {operators.map((op) => (
                <div
                  key={op.id}
                  className="flex items-center justify-between gap-3 p-3.5 rounded-lg border bg-card hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                      <Radio className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{op.name}</span>
                        <Badge variant={op.kind === 'telecom' ? 'default' : 'secondary'} className="text-[10px]">
                          {t(KIND_LABELS[op.kind])}
                        </Badge>
                      </div>
                      {op.commission_basis ? (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t(BASIS_LABELS[op.commission_basis])}
                          {op.commission_basis === 'monthly_volume' && op.volume_scope && (
                            <> · {t(SCOPE_LABELS[op.volume_scope])}</>
                          )}
                        </p>
                      ) : (
                        // No fixed basis: each product says what this operator
                        // pays and what the seller gets, by its own type.
                        <p className="text-xs text-muted-foreground mt-0.5">{t('Operadora paga + comissão, por produto')}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(op); setFormOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(op)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <OperatorFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        operator={editing}
        existingNames={operators.filter(o => o.id !== editing?.id).map(o => o.name)}
      />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Eliminar "{{name}}"?', { name: deleting?.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('Os produtos ligados a esta operadora deixam de ter as regras de comissão por quantidade — ficam com a comissão simples que tinham por baixo. Esta ação não pode ser revertida.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancelar')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleting) deleteOperator.mutate(deleting.id, { onSuccess: () => setDeleting(null) }); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('Eliminar')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function OperatorFormModal({
  open,
  onOpenChange,
  operator,
  existingNames,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operator: Operator | null;
  existingNames: string[];
}) {
  const createOperator = useCreateOperator();
  const updateOperator = useUpdateOperator();
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<OperatorKind>('telecom');
  // 'matriz' is a UI-only choice (energia only) for "no fixed basis — use
  // Matriz de Comissões instead", i.e. commission_basis: null in the DB.
  const [basisChoice, setBasisChoice] = useState<CommissionBasis | 'matriz'>('per_sale');
  const [scope, setScope] = useState<VolumeScope>('per_seller');

  useEffect(() => {
    if (!open) return;
    const initialKind = operator?.kind ?? 'telecom';
    setName(operator?.name ?? '');
    setKind(initialKind);
    setBasisChoice(operator?.commission_basis ?? (initialKind === 'energia' ? 'matriz' : 'per_sale'));
    setScope(operator?.volume_scope ?? 'per_seller');
  }, [open, operator]);

  // 'matriz' only makes sense for energia — switching to telecom needs a real basis.
  const handleKindChange = (v: OperatorKind) => {
    setKind(v);
    if (v === 'telecom' && basisChoice === 'matriz') setBasisChoice('per_sale');
  };

  const trimmed = name.trim();
  const isDuplicate = existingNames.some(n => n.toLowerCase() === trimmed.toLowerCase());
  const isPending = createOperator.isPending || updateOperator.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed || isDuplicate) return;
    const commissionBasis: CommissionBasis | null = basisChoice === 'matriz' ? null : basisChoice;
    const input = {
      name: trimmed,
      kind,
      commission_basis: commissionBasis,
      volume_scope: commissionBasis === 'monthly_volume' ? scope : null,
    };
    if (operator) {
      updateOperator.mutate({ id: operator.id, ...input }, { onSuccess: () => onOpenChange(false) });
    } else {
      createOperator.mutate(input, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{operator ? t('Editar Operadora') : t('Nova Operadora')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="op-name">{t('Nome *')}</Label>
            <Input
              id="op-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Ex: Digi, Vodafone, Iberdrola...')}
              autoFocus
            />
            {isDuplicate && <p className="text-xs text-destructive">{t('Já existe uma operadora com este nome.')}</p>}
          </div>

          <div className="space-y-2">
            <Label>{t('Tipo *')}</Label>
            <Select value={kind} onValueChange={(v) => handleKindChange(v as OperatorKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="telecom">{t('Telecomunicação')}</SelectItem>
                <SelectItem value="energia">{t('Energia')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('Base da comissão')}</Label>
            <Select value={basisChoice} onValueChange={(v) => setBasisChoice(v as CommissionBasis | 'matriz')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {kind === 'energia' && <SelectItem value="matriz">{t('Sem base fixa — por produto')}</SelectItem>}
                <SelectItem value="per_sale">{t('Por venda')}</SelectItem>
                <SelectItem value="monthly_volume">{t('Volume mensal acumulado')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {basisChoice === 'matriz'
                ? t('Cada produto desta operadora diz quanto ela paga e quanto fica para quem vende, conforme o tipo do produto. Um produto sem tipo continua a usar a Matriz de Comissões.')
                : basisChoice === 'per_sale'
                  ? t('Comissão de valor fixo (pessoa/perfil). A quantidade vendida numa proposta/venda decide o escalão de comissão dessa venda.')
                  : t('Comissão de valor fixo (pessoa/perfil). O total acumulado no mês decide o escalão — e vendas anteriores desse mês são atualizadas quando o escalão sobe.')}
            </p>
          </div>

          {basisChoice === 'monthly_volume' && (
            <div className="space-y-2">
              <Label>{t('Acumula por')}</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as VolumeScope)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="per_seller">{t('Por vendedor')}</SelectItem>
                  <SelectItem value="org_total">{t('Total da organização')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {scope === 'per_seller'
                  ? t('Cada comercial sobe de escalão pelo que ele próprio vendeu no mês.')
                  : t('Todos sobem de escalão juntos, pelo total vendido pela organização no mês.')}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('Cancelar')}</Button>
            <Button type="submit" disabled={!trimmed || isDuplicate || isPending}>
              {isPending ? t('A guardar...') : operator ? t('Guardar') : t('Criar Operadora')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
