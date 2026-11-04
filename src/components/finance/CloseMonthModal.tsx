import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers } from '@/hooks/useTeam';
import { useCommissionClosings } from '@/hooks/useCommissionClosings';
import {
  calculateEnergyCommissionPure,
  getVolumeTier,
  type EnergyCommissionConfig,
  type EnergyVolumeTier,
} from '@/hooks/useCommissionMatrix';
import { useOrganization } from '@/hooks/useOrganization';
import { formatCurrency } from '@/lib/format';
import { format, endOfMonth } from 'date-fns';
import { useLanguage, tr, dateLocale } from '@/i18n';
import { Loader2, Zap } from 'lucide-react';

const TIER_LABELS: Record<string, string> = {
  low: 'Baixo (≤300 MWh)',
  mid: 'Médio (301–600 MWh)',
  high: 'Alto (+601 MWh)',
};

const NEGOTIATION_MULTIPLIER: Record<string, number> = {
  angariacao: 1,
  angariacao_indexado: 1,
  sem_volume: 1,
  renovacao: 0.25,
};

interface CommercialPreview {
  userId: string;
  name: string;
  totalConsumoKwh: number;
  totalConsumoMwh: number;
  tier: EnergyVolumeTier;
  totalIndicativa: number;
  totalFinal: number;
  totalChargeback: number;
  cpes: Array<{
    sale_id: string;
    proposal_cpe_id: string;
    serial_number: string | null;
    consumo_anual: number;
    margem: number;
    comissao_indicativa: number;
    comissao_final: number;
    negotiation_type: string;
  }>;
}

interface CloseMonthModalProps {
  month: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CloseMonthModal({ month, open, onOpenChange }: CloseMonthModalProps) {
  const { t } = useLanguage();
  const { organization } = useAuth();
  const { data: org } = useOrganization();
  const { data: members } = useTeamMembers();
  const { closeMonth } = useCommissionClosings();

  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<CommercialPreview[]>([]);
  const [notes, setNotes] = useState('');
  const [globalMwh, setGlobalMwh] = useState(0);
  const [globalTier, setGlobalTier] = useState<EnergyVolumeTier>('low');

  const energyConfig: EnergyCommissionConfig | null = (org as any)?.commission_matrix?.ee_gas ?? null;

  const getMemberName = (userId: string) => {
    const m = members?.find((m: any) => m.user_id === userId);
    return m?.full_name || tr('Desconhecido');
  };

  useEffect(() => {
    if (!open || !organization?.id) return;
    loadPreview();
  }, [open, organization?.id, month]);

  const loadPreview = async () => {
    setLoading(true);
    try {
      const monthStart = month;
      const monthEnd = format(endOfMonth(new Date(month)), 'yyyy-MM-dd');

      // Get delivered sales filtered by activation_date
      const { data: sales, error: salesError } = await supabase
        .from('sales')
        .select('id, lead_id, activation_date, status, proposal_id')
        .eq('organization_id', organization!.id)
        .eq('status', 'delivered')
        .gte('activation_date', monthStart)
        .lte('activation_date', monthEnd);

      if (salesError) throw salesError;
      if (!sales?.length) {
        setPreview([]);
        setGlobalMwh(0);
        setGlobalTier('low');
        setLoading(false);
        return;
      }

      // Get lead assigned_to
      const leadIds = [...new Set(sales.map(s => s.lead_id).filter(Boolean))] as string[];
      const { data: leads } = await supabase
        .from('leads')
        .select('id, assigned_to')
        .in('id', leadIds);

      const leadMap = new Map((leads || []).map(l => [l.id, l.assigned_to]));

      // Get proposals with negotiation_type filter
      const proposalIds = [...new Set(sales.map(s => s.proposal_id).filter(Boolean))] as string[];
      if (!proposalIds.length) {
        setPreview([]);
        setGlobalMwh(0);
        setGlobalTier('low');
        setLoading(false);
        return;
      }

      const { data: proposals } = await supabase
        .from('proposals')
        .select('id, negotiation_type')
        .in('id', proposalIds);

      if (!proposals?.length) {
        setPreview([]);
        setGlobalMwh(0);
        setGlobalTier('low');
        setLoading(false);
        return;
      }

      const validProposalIds = proposals.map(p => p.id);
      const proposalNegotiationMap = new Map(proposals.map(p => [p.id, p.negotiation_type]));

      // Map proposal_id -> sale_id
      const proposalToSale = new Map<string, string>();
      for (const s of sales) {
        if (s.proposal_id && validProposalIds.includes(s.proposal_id)) {
          proposalToSale.set(s.proposal_id, s.id);
        }
      }

      const { data: cpes } = await supabase
        .from('proposal_cpes')
        .select('id, proposal_id, consumo_anual, margem, comissao, serial_number')
        .in('proposal_id', validProposalIds);

      if (!cpes?.length) {
        setPreview([]);
        setGlobalMwh(0);
        setGlobalTier('low');
        setLoading(false);
        return;
      }

      // Group by commercial
      const byCommercial = new Map<string, CommercialPreview>();
      let totalGlobalKwh = 0;

      for (const cpe of cpes) {
        const saleId = proposalToSale.get(cpe.proposal_id);
        if (!saleId) continue;
        const sale = sales.find(s => s.id === saleId);
        if (!sale || !sale.lead_id) continue;
        const assignedTo = leadMap.get(sale.lead_id) || 'unassigned';

        if (!byCommercial.has(assignedTo)) {
          byCommercial.set(assignedTo, {
            userId: assignedTo,
            name: getMemberName(assignedTo),
            totalConsumoKwh: 0,
            totalConsumoMwh: 0,
            tier: 'low',
            totalIndicativa: 0,
            totalFinal: 0,
            totalChargeback: 0,
            cpes: [],
          });
        }

        const entry = byCommercial.get(assignedTo)!;
        const consumo = cpe.consumo_anual || 0;
        entry.totalConsumoKwh += consumo;
        totalGlobalKwh += consumo;
        entry.totalIndicativa += cpe.comissao || 0;
        entry.cpes.push({
          sale_id: saleId,
          proposal_cpe_id: cpe.id,
          serial_number: cpe.serial_number,
          consumo_anual: consumo,
          margem: cpe.margem || 0,
          comissao_indicativa: cpe.comissao || 0,
          comissao_final: 0,
          negotiation_type: proposalNegotiationMap.get(cpe.proposal_id) || '',
        });
      }

      // Global totalizer
      const totalGlobalMwh = totalGlobalKwh / 1000;
      const gTier = getVolumeTier(totalGlobalKwh);
      setGlobalMwh(totalGlobalMwh);
      setGlobalTier(gTier);

      // Recalculate commissions per commercial using their own tier
      for (const entry of byCommercial.values()) {
        entry.totalConsumoMwh = entry.totalConsumoKwh / 1000;
        entry.tier = getVolumeTier(entry.totalConsumoKwh);
        entry.name = getMemberName(entry.userId);

        let totalFinal = 0;
        for (const cpe of entry.cpes) {
          const multiplier = NEGOTIATION_MULTIPLIER[cpe.negotiation_type] ?? 1;
          if (energyConfig && energyConfig.bands.length > 0) {
            const final_ = calculateEnergyCommissionPure(cpe.margem, energyConfig, entry.tier);
            cpe.comissao_final = (final_ ?? cpe.comissao_indicativa) * multiplier;
          } else {
            cpe.comissao_final = cpe.comissao_indicativa * multiplier;
          }
          totalFinal += cpe.comissao_final;
        }
        entry.totalFinal = totalFinal;
      }

      // Deduct this month's matched chargebacks (estornos) per commercial. A
      // commercial with a chargeback but no commission this month still shows
      // (net negative). Period is taken from the import's reference_month (or its
      // created date when not set).
      const monthEndStr = format(endOfMonth(new Date(month)), 'yyyy-MM-dd');
      const { data: cbImports } = await supabase
        .from('commission_chargeback_imports')
        .select('id, reference_month, created_at')
        .eq('organization_id', organization?.id);
      const relevantImportIds = (cbImports || [])
        .filter((imp) => {
          const ref = (imp.reference_month as string | null) || (imp.created_at ? String(imp.created_at).slice(0, 10) : null);
          return ref != null && ref >= month && ref <= monthEndStr;
        })
        .map((imp) => imp.id);

      if (relevantImportIds.length > 0) {
        const { data: cbItems } = await supabase
          .from('commission_chargeback_items')
          .select('matched_user_id, chargeback_amount')
          .eq('organization_id', organization?.id)
          .eq('matched', true)
          .in('import_id', relevantImportIds);
        for (const it of cbItems || []) {
          const uid = it.matched_user_id as string | null;
          if (!uid) continue;
          let entry = byCommercial.get(uid);
          if (!entry) {
            entry = {
              userId: uid, name: getMemberName(uid), totalConsumoKwh: 0, totalConsumoMwh: 0,
              tier: 'low', totalIndicativa: 0, totalFinal: 0, totalChargeback: 0, cpes: [],
            };
            byCommercial.set(uid, entry);
          }
          entry.totalChargeback += Number(it.chargeback_amount || 0);
        }
      }

      setPreview(Array.from(byCommercial.values()).sort((a, b) => (b.totalFinal - b.totalChargeback) - (a.totalFinal - a.totalChargeback)));
    } catch (err) {
      console.error('Error loading preview:', err);
    }
    setLoading(false);
  };

  const totalGross = preview.reduce((sum, p) => sum + p.totalFinal, 0);
  const totalChargebacks = preview.reduce((sum, p) => sum + p.totalChargeback, 0);
  const totalCommission = totalGross - totalChargebacks; // net payable

  const handleClose = () => {
    closeMonth.mutate({
      month,
      totalCommission, // net
      totalChargeback: totalChargebacks,
      notes: notes || undefined,
      items: preview.map(p => ({
        user_id: p.userId,
        total_consumo_mwh: p.totalConsumoMwh,
        volume_tier: p.tier,
        total_commission: p.totalFinal - p.totalChargeback, // net
        total_chargeback: p.totalChargeback,
        items_detail: p.cpes,
      })),
    }, {
      onSuccess: () => onOpenChange(false),
    });
  };

  const monthLabel = format(new Date(month), 'MMMM yyyy', { locale: dateLocale() });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Fechar Mês — {{month}}", { month: monthLabel })}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="space-y-4 py-8">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : preview.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            {t("Nenhuma venda concluída com data de ativação neste mês (Angariação / Angariação Indexado).")}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Global Totalizer */}
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Zap className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{t("Totalizador Global (Angariação)")}</p>
                    <p className="text-2xl font-bold">{globalMwh.toFixed(1)} MWh</p>
                  </div>
                </div>
                <Badge variant="outline" className="text-sm font-semibold w-fit">
                  {t(TIER_LABELS[globalTier] || globalTier)}
                </Badge>
              </CardContent>
            </Card>

            {/* Commercial breakdown */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Comercial")}</TableHead>
                  <TableHead className="text-right">{t("MWh Total")}</TableHead>
                  <TableHead>{t("Patamar")}</TableHead>
                  <TableHead className="text-right">{t("Comissão Indicativa")}</TableHead>
                  <TableHead className="text-right">{t("Comissão Final")}</TableHead>
                  <TableHead className="text-right">{t("Estornos")}</TableHead>
                  <TableHead className="text-right">{t("Líquido a pagar")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map(p => (
                  <TableRow key={p.userId}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-right">{p.totalConsumoMwh.toFixed(1)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{t(TIER_LABELS[p.tier] || p.tier)}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatCurrency(p.totalIndicativa)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(p.totalFinal)}</TableCell>
                    <TableCell className="text-right text-destructive">
                      {p.totalChargeback > 0 ? `−${formatCurrency(p.totalChargeback)}` : '—'}
                    </TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(p.totalFinal - p.totalChargeback)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold">
                  <TableCell colSpan={3}>{t("Total")}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatCurrency(preview.reduce((s, p) => s + p.totalIndicativa, 0))}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(totalGross)}</TableCell>
                  <TableCell className="text-right text-destructive">
                    {totalChargebacks > 0 ? `−${formatCurrency(totalChargebacks)}` : '—'}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(totalCommission)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <div className="space-y-2">
              <Label>{t("Notas (opcional)")}</Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder={t("Observações sobre este fecho...")}
                rows={2}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancelar")}</Button>
          <Button
            onClick={handleClose}
            disabled={loading || preview.length === 0 || closeMonth.isPending}
          >
            {closeMonth.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("Confirmar Fecho")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
