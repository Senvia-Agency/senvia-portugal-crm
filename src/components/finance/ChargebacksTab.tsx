import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { pt } from 'date-fns/locale';
import { AlertTriangle, Check, Plus, Undo2, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useSaleChargebacks,
  useUpdateChargebackStatus,
  useCreateManualChargeback,
  CHARGEBACK_STATUS_LABELS,
  type SaleChargeback,
  type ChargebackStatus,
} from '@/hooks/useSaleChargebacks';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers } from '@/hooks/useTeam';
import { useClients } from '@/hooks/useClients';
import { isBdsOrganization } from '@/lib/bds-finance';
import { resolveManualChargebackClient } from '@/lib/manual-chargeback-client';

const STATUS_STYLES: Record<ChargebackStatus, string> = {
  pending: 'bg-amber-500/20 text-amber-600 border-amber-500/30',
  reconciled: 'bg-red-500/20 text-red-500 border-red-500/30',
  dismissed: 'bg-slate-500/20 text-slate-500 border-slate-500/30',
};

/**
 * Commission clawed back when a telecom sale is cancelled AFTER install.
 * Rows appear automatically the moment a sale is marked "Cancelado" — they
 * are a projection until the operator's own chargeback file confirms them,
 * which is what "Confirmar" / "Descartar" record.
 */
export function ChargebacksTab() {
  const { data: chargebacks = [], isLoading } = useSaleChargebacks();
  const updateStatus = useUpdateChargebackStatus();
  const { isAdmin } = usePermissions();
  const { organization } = useAuth();
  const { data: teamMembers = [] } = useTeamMembers(true);
  const { data: clients = [] } = useClients();
  const createManual = useCreateManualChargeback();
  const [manualOpen, setManualOpen] = useState(false);
  const [sellerId, setSellerId] = useState('');
  const [amount, setAmount] = useState('');
  const [clientName, setClientName] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<SaleChargeback | null>(null);
  const [applicationMonth, setApplicationMonth] = useState('');
  const canCreateManual = isAdmin && isBdsOrganization(organization?.name);

  const totals = useMemo(() => {
    const sum = (status: ChargebackStatus) =>
      chargebacks.filter(c => c.status === status).reduce((acc, c) => acc + (c.amount || 0), 0);
    return {
      pending: sum('pending'),
      reconciled: sum('reconciled'),
      pendingCount: chargebacks.filter(c => c.status === 'pending').length,
    };
  }, [chargebacks]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              Por confirmar
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatCurrency(totals.pending)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {totals.pendingCount} CB por confirmar
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Confirmados</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-red-500">{formatCurrency(totals.reconciled)}</p>
            <p className="text-xs text-muted-foreground mt-1">Associados ao mês de comissão escolhido</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Chargebacks (CB)</CardTitle>
              <CardDescription>
                Gerados automaticamente quando uma venda passa a "Cancelado" (cancelada após a instalação).
                Vendas anuladas antes da instalação não geram CB.
              </CardDescription>
            </div>
            {canCreateManual && (
              <Dialog open={manualOpen} onOpenChange={setManualOpen}>
                <DialogTrigger asChild>
                      <Button type="button" size="sm">
                        <Plus className="mr-1.5 h-4 w-4" />Chargeback manual
                      </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Registar chargeback manual</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Comercial que vendeu *</Label>
                      <Select value={sellerId} onValueChange={setSellerId}>
                        <SelectTrigger><SelectValue placeholder="Selecionar comercial" /></SelectTrigger>
                        <SelectContent>
                          {teamMembers.filter(member => !member.is_banned && member.role !== 'viewer').map(member => (
                            <SelectItem key={member.user_id} value={member.user_id}>{member.full_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="manual-chargeback-amount">Valor (€) *</Label>
                      <Input id="manual-chargeback-amount" inputMode="decimal" placeholder="0,00" value={amount} onChange={event => setAmount(event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="manual-chargeback-client">Cliente (opcional)</Label>
                      <Input
                        id="manual-chargeback-client"
                        type="text"
                        list="manual-chargeback-client-options"
                        placeholder="Escrever nome do cliente"
                        value={clientName}
                        onChange={event => setClientName(event.target.value)}
                      />
                      <datalist id="manual-chargeback-client-options">
                        {clients.map(client => <option key={client.id} value={client.name} />)}
                      </datalist>
                      <p className="text-xs text-muted-foreground">
                        Pode escrever um nome antigo que não esteja no CRM. O registo não cria um cliente.
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="button" disabled={createManual.isPending || !sellerId || !amount} onClick={() => {
                      const client = resolveManualChargebackClient(clientName, clients);
                      createManual.mutate({ userId: sellerId, amountText: amount, ...client }, {
                        onSuccess: () => {
                          setManualOpen(false);
                          setSellerId(''); setAmount(''); setClientName('');
                        },
                      });
                    }}>Registar por confirmar</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : chargebacks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Sem chargebacks. Aparecem aqui assim que uma venda for marcada como cancelada após a instalação.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Venda / cliente</TableHead>
                    <TableHead>Beneficiário</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Mês de desconto</TableHead>
                    {isAdmin && <TableHead className="w-32" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chargebacks.map(cb => (
                    <TableRow key={cb.id}>
                      <TableCell className="text-sm">
                        <span className="font-medium">{cb.reason === 'manual' ? 'Manual' : (cb.sale?.code ?? '—')}</span>
                        {cb.reason === 'manual' && (cb.client_name || cb.client?.name) && (
                          <span className="ml-2 text-xs text-muted-foreground">{cb.client_name || cb.client?.name}</span>
                        )}
                        {cb.sale?.sale_date && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {new Date(cb.sale.sale_date).toLocaleDateString('pt-PT')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{cb.beneficiary_name ?? '—'}</TableCell>
                      <TableCell className="text-right text-sm font-medium text-red-500">
                        −{formatCurrency(cb.amount || 0)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_STYLES[cb.status]}>
                          {CHARGEBACK_STATUS_LABELS[cb.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {cb.application_month ? format(parseISO(cb.application_month), 'MMMM yyyy', { locale: pt }) : '—'}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            {cb.status === 'pending' ? (
                              <>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  title="Confirmar — a operadora cobrou mesmo"
                                  onClick={() => { setConfirmTarget(cb); setApplicationMonth(''); }}
                                >
                                  <Check className="h-3.5 w-3.5 text-green-600" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  title="Descartar — não se aplica"
                                  onClick={() => updateStatus.mutate({ id: cb.id, status: 'dismissed', manual: cb.reason === 'manual' })}
                                >
                                  <X className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </>
                            ) : !cb.applied_at ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="Voltar a por confirmar"
                                onClick={() => updateStatus.mutate({ id: cb.id, status: 'pending', manual: cb.reason === 'manual' })}
                              >
                                <Undo2 className="h-3.5 w-3.5 text-muted-foreground" />
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={!!confirmTarget} onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar chargeback</DialogTitle>
            <DialogDescription>Escolhe o mês da comissão em que este valor será descontado.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="chargeback-application-month">Mês de desconto</Label>
            <Input id="chargeback-application-month" type="month" value={applicationMonth} onChange={(event) => setApplicationMonth(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" disabled={!confirmTarget || !applicationMonth || updateStatus.isPending} onClick={() => {
              if (!confirmTarget) return;
              updateStatus.mutate({ id: confirmTarget.id, status: 'reconciled', manual: confirmTarget.reason === 'manual', applicationMonth }, {
                onSuccess: () => { setConfirmTarget(null); setApplicationMonth(''); },
              });
            }}>Confirmar desconto</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
