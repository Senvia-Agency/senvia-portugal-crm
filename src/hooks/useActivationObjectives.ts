import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { startOfMonth, startOfYear, format } from "date-fns";
import { toast } from "sonner";
import { sumOperationalSaleUnits } from "@/lib/sale-units";

export interface ActivationObjective {
  id: string;
  organization_id: string;
  user_id: string;
  period_type: "monthly" | "annual";
  proposal_type: "energia" | "servicos";
  month: string;
  target_quantity: number;
}

export type ActivationCountMode = "value" | "count";

const ENERGY_ACTIVATION_NEGOTIATION_TYPES = ["angariacao", "angariacao_indexado"] as const;
const EXCLUDED_SERVICE_PRODUCT_NAMES = new Set(["cobertura", "coberturas"]);

function normalizeServiceProductName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function useActivationObjectives(referenceDate?: Date) {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  const orgId = organization?.id;
  const isTelecom = organization?.niche === "telecom";

  const ref = referenceDate || new Date();
  const currentMonthStart = format(startOfMonth(ref), "yyyy-MM-dd");
  const currentYearStart = format(startOfYear(ref), "yyyy-MM-dd");
  const monthEnd = format(new Date(ref.getFullYear(), ref.getMonth() + 1, 0), "yyyy-MM-dd");
  const yearEnd = format(new Date(ref.getFullYear(), 11, 31), "yyyy-MM-dd");

  // Fetch all objectives for current month and year
  const { data: objectives = [], isLoading: objectivesLoading } = useQuery({
    queryKey: ["activation-objectives", orgId, currentMonthStart, currentYearStart],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("activation_objectives" as any)
        .select("*")
        .eq("organization_id", orgId)
        .in("month", [currentMonthStart, currentYearStart]);
      if (error) throw error;
      return (data || []) as unknown as ActivationObjective[];
    },
    enabled: !!orgId,
  });

  // Telecom lines count from the moment they become active (fulfilled); in
  // every other niche, activations are only counted when concluded.
  const { data: monthlyActivations = [], isLoading: monthlyLoading } = useQuery({
    queryKey: ["activations-monthly", orgId, currentMonthStart],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("sales")
        .select("created_by, proposal_type, activation_date, proposal_id, operational_units")
        .eq("organization_id", orgId)
        .not("activation_date", "is", null)
        .gte("activation_date", currentMonthStart)
        .lte("activation_date", monthEnd)
        .in("status", isTelecom ? ["fulfilled", "delivered"] : ["delivered"]);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });

  // Same lifecycle rule for the annual objective.
  const { data: annualActivations = [], isLoading: annualLoading } = useQuery({
    queryKey: ["activations-annual", orgId, currentYearStart],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("sales")
        .select("created_by, proposal_type, activation_date, proposal_id, operational_units")
        .eq("organization_id", orgId)
        .not("activation_date", "is", null)
        .gte("activation_date", currentYearStart)
        .lte("activation_date", yearEnd)
        .in("status", isTelecom ? ["fulfilled", "delivered"] : ["delivered"]);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });

  // Get all unique proposal_ids from activations
  const allProposalIds = [...new Set(
    [...monthlyActivations, ...annualActivations]
      .map((s: any) => s.proposal_id)
      .filter(Boolean)
  )];

  // Fetch proposal_cpes consumo_anual for energia
  const { data: proposalCpes = [] } = useQuery({
    queryKey: ["activation-proposal-cpes", orgId, allProposalIds],
    queryFn: async () => {
      if (!orgId || allProposalIds.length === 0) return [];
      const { data, error } = await supabase
        .from("proposal_cpes")
        .select("proposal_id, consumo_anual")
        .in("proposal_id", allProposalIds);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && allProposalIds.length > 0,
  });

  // Fetch proposal metadata needed for activation filtering and services kWp
  const { data: proposalsMetadata = [] } = useQuery({
    queryKey: ["activation-proposals-metadata", orgId, allProposalIds],
    queryFn: async () => {
      if (!orgId || allProposalIds.length === 0) return [];
      const { data, error } = await supabase
        .from("proposals")
        .select("id, proposal_type, negotiation_type, servicos_details")
        .in("id", allProposalIds);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && allProposalIds.length > 0,
  });

  // Build lookup maps
  const cpesByProposal = proposalCpes.reduce((acc: Record<string, number>, cpe: any) => {
    const pid = cpe.proposal_id;
    acc[pid] = (acc[pid] || 0) + (cpe.consumo_anual || 0);
    return acc;
  }, {});

  const proposalMetadataById = proposalsMetadata.reduce((acc: Record<string, any>, proposal: any) => {
    acc[proposal.id] = proposal;
    return acc;
  }, {});

  const kwpByProposal = proposalsMetadata.reduce((acc: Record<string, number>, p: any) => {
    if (p.proposal_type !== "servicos") return acc;

    const details = p.servicos_details;
    if (details && typeof details === "object") {
      let totalKwp = 0;

      for (const [productKey, rawProductDetail] of Object.entries(details as Record<string, any>)) {
        const productDetail = rawProductDetail as { name?: string; kwp?: number | string | null };
        const productName = typeof productDetail.name === "string" ? productDetail.name : productKey;
        const normalizedProductName = normalizeServiceProductName(productName);

        if (EXCLUDED_SERVICE_PRODUCT_NAMES.has(normalizedProductName)) continue;

        totalKwp += Number(productDetail.kwp) || 0;
      }

      acc[p.id] = totalKwp;
    }
    return acc;
  }, {});

  // Helper to get objective target
  const getTarget = useCallback((userId: string, periodType: "monthly" | "annual", proposalType: "energia" | "servicos"): number => {
    const month = periodType === "monthly" ? currentMonthStart : currentYearStart;
    const obj = objectives.find(
      (o) => o.user_id === userId && o.period_type === periodType && o.proposal_type === proposalType && o.month === month
    );
    return obj?.target_quantity || 0;
  }, [objectives, currentMonthStart, currentYearStart]);

  // Sum activations: MWh for energia, kWp for servicos (or count when countMode='count')
  const sumActivations = useCallback((
    userId: string | null,
    periodType: "monthly" | "annual",
    proposalType: "energia" | "servicos",
    countMode: ActivationCountMode = "value"
  ): number => {
    const source = periodType === "monthly" ? monthlyActivations : annualActivations;
    const filtered = source.filter((s: any) => {
      const proposal = s.proposal_id ? proposalMetadataById[s.proposal_id] : null;
      const resolvedProposalType = proposal?.proposal_type ?? s.proposal_type ?? null;
      const negotiationType = proposal?.negotiation_type ?? null;
      const isEligibleEnergyActivation =
        resolvedProposalType === "energia" &&
        ENERGY_ACTIVATION_NEGOTIATION_TYPES.includes(negotiationType);
      const matchType = proposalType === "energia"
        ? isEligibleEnergyActivation
        : resolvedProposalType === "servicos";
      const matchUser = userId ? s.created_by === userId : true;

      return matchType && matchUser;
    });

    if (countMode === "count") {
      return sumOperationalSaleUnits(filtered);
    }

    if (proposalType === "energia") {
      // Sum consumo_anual from proposal_cpes, convert to MWh
      return filtered.reduce((total: number, s: any) => {
        const consumo = s.proposal_id ? (cpesByProposal[s.proposal_id] || 0) : 0;
        return total + consumo / 1000;
      }, 0);
    }

    // Sum kWp from proposals.servicos_details
    return filtered.reduce((total: number, s: any) => {
      const kwp = s.proposal_id ? (kwpByProposal[s.proposal_id] || 0) : 0;
      return total + kwp;
    }, 0);
  }, [monthlyActivations, annualActivations, proposalMetadataById, cpesByProposal, kwpByProposal]);

  // Upsert objective
  const saveObjective = useMutation({
    mutationFn: async ({
      userId,
      periodType,
      proposalType,
      targetQuantity,
    }: {
      userId: string;
      periodType: "monthly" | "annual";
      proposalType: "energia" | "servicos";
      targetQuantity: number;
    }) => {
      if (!orgId) throw new Error("Sem organização");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sem utilizador");

      const month = periodType === "monthly" ? currentMonthStart : currentYearStart;
      const { error } = await supabase
        .from("activation_objectives" as any)
        .upsert(
          {
            organization_id: orgId,
            user_id: userId,
            period_type: periodType,
            proposal_type: proposalType,
            month,
            target_quantity: targetQuantity,
            created_by: user.id,
          } as any,
          { onConflict: "organization_id,user_id,period_type,proposal_type,month" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activation-objectives"] });
      toast.success("Objetivo guardado com sucesso");
    },
    onError: (err: any) => {
      toast.error("Erro ao guardar objetivo: " + err.message);
    },
  });

  return {
    objectives,
    // Render the panel as soon as its primary data is available. CPE and
    // proposal metadata are enrichment queries; waiting for them here kept the
    // entire widget on skeletons when those secondary requests were slow.
    isLoading: objectivesLoading || monthlyLoading || annualLoading,
    getTarget,
    countActivations: sumActivations,
    saveObjective,
    currentMonthStart,
    currentYearStart,
  };
}
