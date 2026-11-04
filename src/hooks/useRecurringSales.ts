import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays } from "date-fns";
import { toast } from "sonner";
import { tr } from "@/i18n";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { RecurringStatus } from "@/types/sales";
import { operationalUnitsForSale } from "@/lib/sale-units";

interface RecurringCycleSummary {
  readonly id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly due_date: string;
  readonly amount: number;
  readonly status: string;
}

interface RecurringSaleWithClient {
  readonly id: string;
  readonly recurrence_id: string;
  readonly code: string;
  readonly client_id: string | null;
  readonly recurring_value: number;
  readonly recurring_status: RecurringStatus;
  readonly next_renewal_date: string;
  readonly last_renewal_date: string | null;
  readonly organization_id: string;
  readonly operational_units: number;
  readonly current_cycle: RecurringCycleSummary | null;
  readonly client?: {
    readonly id: string;
    readonly name: string;
  } | null;
}

interface RenewSaleInput {
  readonly saleId: string;
  readonly organizationId: string;
  readonly amount: number;
  readonly paymentMethod?: string;
}

class RecurrenceActionError extends Error {
  constructor(
    readonly action: "renew" | "cancel",
    readonly saleId: string,
  ) {
    super(`Recurrence ${action} is unavailable for sale ${saleId}`);
    this.name = "RecurrenceActionError";
  }
}

export function useRecurringSales() {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ["recurring-sales", organization?.id],
    queryFn: async (): Promise<RecurringSaleWithClient[]> => {
      if (!organization?.id) return [];

      const soon = addDays(new Date(), 7).toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("sale_recurrences")
        .select(`
          id,
          sale_id,
          organization_id,
          amount,
          next_cycle_date,
          last_cycle_date,
          sales!inner(
            id,
            code,
            client_id,
            servicos_details,
            client:crm_clients(id, name)
          ),
          sale_recurring_cycles(
            id,
            period_start,
            period_end,
            due_date,
            amount,
            status
          )
        `)
        .eq("organization_id", organization.id)
        .eq("service_status", "active")
        .not("next_cycle_date", "is", null)
        .lte("next_cycle_date", soon)
        .order("next_cycle_date", { ascending: true });

      if (error) throw error;

      return (data ?? []).flatMap((recurrence): RecurringSaleWithClient[] => {
        const sale = recurrence.sales;
        if (!sale || !recurrence.next_cycle_date) return [];

        const currentCycle = recurrence.sale_recurring_cycles.reduce<
          RecurringCycleSummary | null
        >((latest, cycle) => {
          if (!latest || cycle.period_start > latest.period_start) return cycle;
          return latest;
        }, null);

        return [{
          id: sale.id,
          recurrence_id: recurrence.id,
          code: sale.code ?? "",
          client_id: sale.client_id,
          recurring_value: recurrence.amount,
          recurring_status: "active",
          next_renewal_date: recurrence.next_cycle_date,
          last_renewal_date: recurrence.last_cycle_date,
          organization_id: recurrence.organization_id,
          operational_units: operationalUnitsForSale(sale),
          current_cycle: currentCycle,
          client: sale.client,
        }];
      });
    },
    enabled: !!organization?.id,
  });
}

export function useRenewSale() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ saleId, organizationId }: RenewSaleInput) => {
      const { data: recurrence, error: recurrenceError } = await supabase
        .from("sale_recurrences")
        .select("id, next_cycle_date")
        .eq("sale_id", saleId)
        .eq("organization_id", organizationId)
        .eq("service_status", "active")
        .maybeSingle();

      if (recurrenceError) throw recurrenceError;
      if (!recurrence?.next_cycle_date) {
        throw new RecurrenceActionError("renew", saleId);
      }

      const { data: cycle, error: cycleError } = await supabase.rpc(
        "create_recurring_cycle",
        {
          p_recurrence_id: recurrence.id,
          p_period_start: recurrence.next_cycle_date,
        },
      );

      if (cycleError) throw cycleError;
      return cycle;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["recurring-sales"] });
      queryClient.invalidateQueries({ queryKey: ["sale-recurrence"] });
      queryClient.invalidateQueries({ queryKey: ["recurring-cycles"] });
      queryClient.invalidateQueries({ queryKey: ["sale-payments"] });
      queryClient.invalidateQueries({ queryKey: ["all-payments"] });
      queryClient.invalidateQueries({ queryKey: ["finance-stats"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success(tr("Ciclo de renovação criado com sucesso!"));
    },
    onError: () => {
      toast.error(tr("Erro ao registar renovação"));
    },
  });
}

export function useCancelRecurrence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (saleId: string) => {
      const { data: recurrence, error: recurrenceError } = await supabase
        .from("sale_recurrences")
        .select("id")
        .eq("sale_id", saleId)
        .in("service_status", ["pending", "active", "paused"])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (recurrenceError) throw recurrenceError;
      if (!recurrence) throw new RecurrenceActionError("cancel", saleId);

      const { error } = await supabase.rpc("transition_sale_recurrence", {
        p_recurrence_id: recurrence.id,
        p_action: "cancel",
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["recurring-sales"] });
      queryClient.invalidateQueries({ queryKey: ["sale-recurrence"] });
      toast.success(tr("Recorrência cancelada"));
    },
    onError: () => {
      toast.error(tr("Erro ao cancelar recorrência"));
    },
  });
}
