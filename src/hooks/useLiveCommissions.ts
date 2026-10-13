import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useTeamMembers } from '@/hooks/useTeam';
import {
  calculateEnergyCommissionPure,
  getVolumeTier,
  type EnergyCommissionConfig,
  type EnergyVolumeTier,
} from '@/hooks/useCommissionMatrix';
import { telecomCommissionInPeriod } from '@/lib/telecom-finance';
import { format, endOfMonth } from 'date-fns';

const NEGOTIATION_TYPE_LABELS: Record<string, string> = {
  angariacao: 'Angariação',
  angariacao_indexado: 'Ang. Indexado',
  renovacao: 'Renovação',
  sem_volume: 'Ang. sem Volume',
};

const NEGOTIATION_MULTIPLIER: Record<string, number> = {
  angariacao: 1,
  angariacao_indexado: 1,
  sem_volume: 1,
  renovacao: 0.25,
};

export interface CpeDetail {
  sale_id: string;
  sale_code: string | null;
  proposal_cpe_id: string;
  serial_number: string | null;
  consumo_anual: number;
  dbl: number;
  duracao_contrato: number;
  margem: number;
  comissao_indicativa: number;
  comissao_final: number;
  negotiation_type: string;
  servicos: string[];
  servicos_kwp: number;
  proposal_type: string;
  client_name: string | null;
  contrato_inicio: string | null;
  contrato_fim: string | null;
}

export interface CommercialEntry {
  userId: string;
  name: string;
  totalConsumoKwh: number;
  totalConsumoMwh: number;
  tier: EnergyVolumeTier;
  totalIndicativa: number;
  totalFinal: number;
  totalEnergyCommission: number;
  totalServicosCommission: number;
  totalServicosKwp: number;
  cpes: CpeDetail[];
}

export interface LiveCommissionsData {
  commercials: CommercialEntry[];
  globalMwh: number;
  globalTier: EnergyVolumeTier;
  totalCommission: number;
  globalEnergyCommission: number;
  globalServicosCommission: number;
  globalServicosKwp: number;
}

export function useLiveCommissions(selectedMonth: string, effectiveUserIds?: string[] | null) {
  const { organization } = useAuth();
  const { data: org } = useOrganization();
  const { data: members } = useTeamMembers();
  const organizationId = organization?.id;
  const isTelecom = organization?.niche === 'telecom';

  const energyConfig: EnergyCommissionConfig | null = (org as any)?.commission_matrix?.ee_gas ?? null;

  const getMemberName = (userId: string) => {
    if (userId === 'unassigned') return 'Sem Comercial';
    const m = members?.find((m: any) => m.user_id === userId);
    return m?.full_name || 'Desconhecido';
  };

  return useQuery<LiveCommissionsData>({
    queryKey: ['commissions-live', organizationId, selectedMonth, members?.length, energyConfig?.bands?.length, isTelecom],
    queryFn: async (): Promise<LiveCommissionsData> => {
      const emptyResult: LiveCommissionsData = { commercials: [], globalMwh: 0, globalTier: 'low', totalCommission: 0, globalEnergyCommission: 0, globalServicosCommission: 0, globalServicosKwp: 0 };
      if (!organizationId) return emptyResult;

      const monthStart = selectedMonth;
      const monthEnd = format(endOfMonth(new Date(selectedMonth)), 'yyyy-MM-dd');

      // Get delivered sales filtered by activation_date
      let salesQuery = supabase
        .from('sales')
        .select('id, code, lead_id, client_id, activation_date, scheduled_install_date, status, proposal_id')
        .eq('organization_id', organizationId)
        .in('status', ['delivered', 'fulfilled']);
      if (!isTelecom) salesQuery = salesQuery.gte('activation_date', monthStart).lte('activation_date', monthEnd);
      const { data: salesRaw, error: salesError } = await salesQuery;
      const sales = isTelecom ? salesRaw?.filter(s => telecomCommissionInPeriod(s, {
        from: new Date(`${monthStart}T00:00:00`), to: new Date(`${monthEnd}T00:00:00`),
      })) : salesRaw;

      if (salesError) throw salesError;
      if (!sales?.length) return emptyResult;

      // Get client assigned_to
      const clientIds = [...new Set(sales.map(s => s.client_id).filter(Boolean))] as string[];
      const { data: clients } = clientIds.length > 0
        ? await supabase
            .from('crm_clients')
            .select('id, assigned_to, name, company')
            .in('id', clientIds)
        : { data: [] };

      const clientMap = new Map((clients || []).map(c => [c.id, c.assigned_to]));
      const clientNameMap = new Map((clients || []).map(c => [c.id, c.name || c.company || null]));

      // Get proposals with negotiation_type filter
      const proposalIds = [...new Set(sales.map(s => s.proposal_id).filter(Boolean))] as string[];
      if (!proposalIds.length) return emptyResult;

      const { data: proposals } = await supabase
        .from('proposals')
        .select('id, negotiation_type, servicos_produtos, servicos_details, proposal_type')
        .in('id', proposalIds);

      if (!proposals?.length) return emptyResult;

      const validProposalIds = proposals.map(p => p.id);
      const proposalNegotiationMap = new Map(proposals.map(p => [p.id, p.negotiation_type]));
      const proposalServicosMap = new Map(proposals.map(p => [p.id, (p.servicos_produtos as string[]) || []]));
      const proposalTypeMap = new Map(proposals.map(p => [p.id, (p as any).proposal_type || '']));

      // Extract kWp from servicos_details JSONB
      const proposalKwpMap = new Map<string, number>();
      for (const p of proposals) {
        let totalKwp = 0;
        const details = p.servicos_details as Record<string, { kwp?: number }> | null;
        if (details && typeof details === 'object') {
          for (const prod of Object.values(details)) {
            totalKwp += (prod?.kwp || 0);
          }
        }
        proposalKwpMap.set(p.id, totalKwp);
      }

      // Map proposal_id -> sale_id
      const proposalToSale = new Map<string, string>();
      for (const s of sales) {
        if (s.proposal_id && validProposalIds.includes(s.proposal_id)) {
          proposalToSale.set(s.proposal_id, s.id);
        }
      }

      const { data: cpes } = await supabase
        .from('proposal_cpes')
        .select('id, proposal_id, consumo_anual, dbl, duracao_contrato, margem, comissao, serial_number, contrato_inicio, contrato_fim')
        .in('proposal_id', validProposalIds);

      if (!cpes?.length) return emptyResult;

      // Count CPEs per proposal to avoid duplicating kWp
      const cpesPerProposal = new Map<string, number>();
      for (const cpe of cpes) {
        cpesPerProposal.set(cpe.proposal_id, (cpesPerProposal.get(cpe.proposal_id) || 0) + 1);
      }

      // Group by commercial
      const byCommercial = new Map<string, CommercialEntry>();
      let totalGlobalKwh = 0;

      for (const cpe of cpes) {
        const saleId = proposalToSale.get(cpe.proposal_id);
        if (!saleId) continue;
        const sale = sales.find(s => s.id === saleId);
        if (!sale) continue;
        const assignedTo = (sale.client_id ? clientMap.get(sale.client_id) : null) || 'unassigned';

        if (!byCommercial.has(assignedTo)) {
          byCommercial.set(assignedTo, {
            userId: assignedTo,
            name: getMemberName(assignedTo),
            totalConsumoKwh: 0,
            totalConsumoMwh: 0,
            tier: 'low',
            totalIndicativa: 0,
            totalFinal: 0,
            totalEnergyCommission: 0,
            totalServicosCommission: 0,
            totalServicosKwp: 0,
            cpes: [],
          });
        }

        const entry = byCommercial.get(assignedTo)!;
        const consumo = cpe.consumo_anual || 0;
        const proposalCpeCount = cpesPerProposal.get(cpe.proposal_id) || 1;
        const cpeServicosKwp = (proposalKwpMap.get(cpe.proposal_id) || 0) / proposalCpeCount;
        const negType = proposalNegotiationMap.get(cpe.proposal_id) || '';
        const countsForVolume = negType !== 'sem_volume' && negType !== 'renovacao';
        if (countsForVolume) {
          entry.totalConsumoKwh += consumo;
          totalGlobalKwh += consumo;
        }
        entry.totalServicosKwp += cpeServicosKwp;
        entry.totalIndicativa += cpe.comissao || 0;
        entry.cpes.push({
          sale_id: saleId,
          sale_code: sale.code || null,
          proposal_cpe_id: cpe.id,
          serial_number: cpe.serial_number,
          consumo_anual: consumo,
          dbl: cpe.dbl || 0,
          duracao_contrato: cpe.duracao_contrato || 0,
          margem: cpe.margem || 0,
          comissao_indicativa: cpe.comissao || 0,
          comissao_final: 0,
          negotiation_type: proposalNegotiationMap.get(cpe.proposal_id) || '',
          servicos: proposalServicosMap.get(cpe.proposal_id) || [],
          servicos_kwp: cpeServicosKwp,
          proposal_type: proposalTypeMap.get(cpe.proposal_id) || '',
          client_name: sale.client_id ? (clientNameMap.get(sale.client_id) ?? null) : null,
          contrato_inicio: (cpe as any).contrato_inicio || null,
          contrato_fim: (cpe as any).contrato_fim || null,
        });
      }

      // Global totalizer
      const globalMwh = totalGlobalKwh / 1000;
      const globalTier = getVolumeTier(totalGlobalKwh);

      // Recalculate commissions per commercial using their own tier
      for (const entry of byCommercial.values()) {
        entry.totalConsumoMwh = entry.totalConsumoKwh / 1000;
        entry.tier = globalTier;
        entry.name = getMemberName(entry.userId);

        let totalFinal = 0;
        let energyFinal = 0;
        let servicosFinal = 0;
        for (const cpe of entry.cpes) {
          const multiplier = NEGOTIATION_MULTIPLIER[cpe.negotiation_type] ?? 1;
          if (energyConfig && energyConfig.bands.length > 0) {
            const final_ = calculateEnergyCommissionPure(cpe.margem, energyConfig, entry.tier);
            cpe.comissao_final = (final_ ?? cpe.comissao_indicativa) * multiplier;
          } else {
            cpe.comissao_final = cpe.comissao_indicativa * multiplier;
          }
          totalFinal += cpe.comissao_final;
          if (cpe.proposal_type === 'energia') energyFinal += cpe.comissao_final;
          else servicosFinal += cpe.comissao_final;
        }
        entry.totalFinal = totalFinal;
        entry.totalEnergyCommission = energyFinal;
        entry.totalServicosCommission = servicosFinal;
      }

      // Apply visibility filter
      let commercials = Array.from(byCommercial.values());
      if (effectiveUserIds && effectiveUserIds.length > 0) {
        commercials = commercials.filter(c => effectiveUserIds.includes(c.userId));
      }
      commercials.sort((a, b) => b.totalFinal - a.totalFinal);

      const totalCommission = commercials.reduce((sum, p) => sum + p.totalFinal, 0);
      const globalServicosKwp = commercials.reduce((sum, p) => sum + p.totalServicosKwp, 0);
      const globalEnergyCommission = commercials.reduce((sum, p) => sum + p.totalEnergyCommission, 0);
      const globalServicosCommission = commercials.reduce((sum, p) => sum + p.totalServicosCommission, 0);

      // Recalculate globalMwh/globalTier from filtered data
      const filteredTotalKwh = commercials.reduce((sum, p) => sum + p.totalConsumoKwh, 0);
      const filteredGlobalMwh = filteredTotalKwh / 1000;
      const filteredGlobalTier = getVolumeTier(filteredTotalKwh);

      return { commercials, globalMwh: filteredGlobalMwh, globalTier: filteredGlobalTier, totalCommission, globalEnergyCommission, globalServicosCommission, globalServicosKwp };
    },
    enabled: !!organizationId && !!selectedMonth,
  });
}
