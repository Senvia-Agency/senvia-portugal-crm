import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/hooks/useModules";
import {
  buildProspectPayload,
  createEmptyImportResult,
  isDuplicateConflictError,
  mapProspectsError,
  normalizeEmail,
  normalizeIdentifierValue,
} from "@/lib/prospects/import";
import { toast } from "sonner";
import { tr } from "@/i18n";
import type { DistributeProspectsPayload, Prospect, ProspectImportResult, ProspectSalesperson } from "@/types/prospects";

const getFunctionInvokeErrorMessage = (error: unknown, fallback: string) => {
  const maybeError = error as { message?: string; context?: unknown };
  const context = maybeError?.context;

  if (typeof context === "string" && context.trim()) {
    try {
      const parsed = JSON.parse(context) as { error?: string; message?: string };
      if (typeof parsed?.error === "string" && parsed.error.trim()) return parsed.error;
      if (typeof parsed?.message === "string" && parsed.message.trim()) return parsed.message;
    } catch {
      return context;
    }
  }

  if (context && typeof context === "object") {
    const parsed = context as { error?: string; message?: string };
    if (typeof parsed?.error === "string" && parsed.error.trim()) return parsed.error;
    if (typeof parsed?.message === "string" && parsed.message.trim()) return parsed.message;
  }

  return maybeError?.message || fallback;
};

export function useProspects() {
  const { organization } = useAuth();
  const { modules } = useModules();

  return useQuery({
    queryKey: ["prospects", organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [] as Prospect[];

      const client = supabase as any;
      const { data, error } = await client
        .from("prospects")
        .select("*")
        .eq("organization_id", organization.id)
        .order("imported_at", { ascending: false })
        .limit(5000);

      if (error) throw new Error(mapProspectsError(error));
      return (data || []) as Prospect[];
    },
    enabled: !!organization?.id && modules.prospects,
  });
}

export function useProspectSalespeople() {
  const { organization } = useAuth();
  const { modules } = useModules();

  return useQuery({
    queryKey: ["prospect-salespeople", organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [] as ProspectSalesperson[];

      const { data, error } = await (supabase as any).rpc("get_org_salespeople", {
        p_org_id: organization.id,
      });

      if (error) throw new Error(mapProspectsError(error));
      return (data || []) as ProspectSalesperson[];
    },
    enabled: !!organization?.id && modules.prospects,
  });
}

export function useImportProspects() {
  const { organization, user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      fileName,
      rows,
    }: {
      fileName: string;
      rows: Record<string, unknown>[];
    }): Promise<ProspectImportResult> => {
      if (!organization?.id) throw new Error(tr("Sem organização ativa."));

      const client = supabase as any;
      const result = createEmptyImportResult();
      const { data: existingRows, error: existingError } = await client
        .from("prospects")
        .select("id, nif, cpe, email")
        .eq("organization_id", organization.id);

      if (existingError) {
        throw new Error(tr("Erro ao validar duplicados: {{error}}", { error: mapProspectsError(existingError) }));
      }

      const existingPairMap = new Map<string, string>();
      const existingEmailMap = new Map<string, string>();

      for (const item of (existingRows || []) as Array<{ id: string; nif?: string | null; cpe?: string | null; email?: string | null }>) {
        const nif = normalizeIdentifierValue(item.nif);
        const cpe = normalizeIdentifierValue(item.cpe);
        const email = normalizeEmail(item.email);

        if (nif && cpe) existingPairMap.set(`${nif}::${cpe}`, item.id);
        if (email) existingEmailMap.set(email, item.id);
      }

      const queuedPairKeys = new Set<string>();
      const queuedEmailKeys = new Set<string>();
      const prospectsToInsert: Record<string, unknown>[] = [];
      const prospectsToUpdate: Array<{ id: string; payload: Record<string, unknown> }> = [];

      for (const row of rows) {
        try {
          const payload = buildProspectPayload({
            row,
            fileName,
            organizationId: organization.id,
            userId: user?.id,
          });

          if (!payload.company_name) {
            result.skipped += 1;
            continue;
          }

          const pairKey = payload.nif && payload.cpe ? `${payload.nif}::${payload.cpe}` : null;
          const emailKey = payload.email ? normalizeEmail(payload.email) : null;

          const duplicatedInFile =
            (pairKey && queuedPairKeys.has(pairKey)) ||
            (emailKey && queuedEmailKeys.has(emailKey));

          if (duplicatedInFile) {
            result.skipped += 1;
            continue;
          }

          const existingId =
            (pairKey ? existingPairMap.get(pairKey) : null) ||
            (emailKey ? existingEmailMap.get(emailKey) : null);

          if (pairKey) queuedPairKeys.add(pairKey);
          if (emailKey) queuedEmailKeys.add(emailKey);

          if (existingId) {
            prospectsToUpdate.push({ id: existingId, payload });
            continue;
          }

          prospectsToInsert.push(payload);
        } catch (error) {
          result.failed += 1;
          result.firstError ??= `Erro ao preparar linha: ${mapProspectsError(error)}`;
        }
      }

      const insertSingle = async (payload: Record<string, unknown>) => {
        const { error } = await client.from("prospects").insert(payload);

        if (!error) {
          result.inserted += 1;
          return;
        }

        if (isDuplicateConflictError(error)) {
          result.skipped += 1;
          return;
        }

        result.failed += 1;
        result.firstError ??= mapProspectsError(error);
      };

      const updateSingle = async ({ id, payload }: { id: string; payload: Record<string, unknown> }) => {
        const { error } = await client.from("prospects").update(payload).eq("id", id);

        if (!error) {
          result.updated += 1;
          return;
        }

        result.failed += 1;
        result.firstError ??= mapProspectsError(error);
      };

      for (let index = 0; index < prospectsToInsert.length; index += 200) {
        const chunk = prospectsToInsert.slice(index, index + 200);
        const { error } = await client.from("prospects").insert(chunk);

        if (!error) {
          result.inserted += chunk.length;
          continue;
        }

        for (const payload of chunk) {
          await insertSingle(payload);
        }
      }

      for (const prospect of prospectsToUpdate) {
        await updateSingle(prospect);
      }

      return result;
    },
    onSuccess: ({ inserted, updated, skipped, failed, firstError }) => {
      queryClient.invalidateQueries({ queryKey: ["prospects"] });

      if (failed > 0) {
        toast.warning(tr("{{inserted}} novos • {{updated}} atualizados • {{skipped}} ignorados • {{failed}} falhados", { inserted, updated, skipped, failed }));
        if (firstError) toast.error(firstError);
        return;
      }

      toast.success(skipped ? tr("{{inserted}} novos • {{updated}} atualizados • {{skipped}} ignorados", { inserted, updated, skipped }) : tr("{{inserted}} novos • {{updated}} atualizados", { inserted, updated }));
    },
    onError: (error: Error) => {
      toast.error(mapProspectsError(error));
    },
  });
}

export function useGenerateProspects() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      organizationId: string;
      searchStrings: string[];
      location: string;
      maxResults: number;
      language: string;
      skipClosed: boolean;
      searchMatching?: string;
      placeMinimumStars?: string;
      website?: string;
      scrapePlaceDetailPage?: boolean;
      scrapeTableReservationProvider?: boolean;
      includeWebResults?: boolean;
      scrapeDirectories?: boolean;
      maxQuestions?: number;
      scrapeContacts?: boolean;
      scrapeSocialMediaProfiles?: {
        facebooks: boolean;
        instagrams: boolean;
        youtubes: boolean;
        tiktoks: boolean;
        twitters: boolean;
      };
      maximumLeadsEnrichmentRecords?: number;
      startUrls?: string[];
      onProgress?: (status: string) => void;
    }) => {
      const { onProgress, ...bodyParams } = params;

      // Step 1: Start the Apify run
      onProgress?.("starting");
      const { data: startData, error: startError } = await supabase.functions.invoke("generate-prospects", {
        body: bodyParams,
      });

      if (startError) {
        throw new Error(getFunctionInvokeErrorMessage(startError, tr("Erro ao iniciar geração")));
      }
      if (startData?.error) {
        throw new Error(typeof startData.error === "string" ? startData.error : tr("Erro ao iniciar geração"));
      }

      const jobId = startData?.jobId;
      if (!jobId) throw new Error(tr("Sem ID de job devolvido"));

      // Step 2: Poll for completion
      onProgress?.("running");
      const maxPollTime = 10 * 60 * 1000; // 10 minutes
      const pollInterval = 8000; // 8 seconds
      const startTime = Date.now();

      while (true) {
        if (Date.now() - startTime > maxPollTime) {
          throw new Error(tr("A geração excedeu o tempo máximo de 10 minutos"));
        }

        await new Promise((r) => setTimeout(r, pollInterval));

        const { data: checkData, error: checkError } = await supabase.functions.invoke("check-prospect-job", {
          body: { jobId },
        });

        if (checkError) {
          throw new Error(getFunctionInvokeErrorMessage(checkError, tr("Erro ao verificar job")));
        }
        if (checkData?.error) {
          throw new Error(typeof checkData.error === "string" ? checkData.error : tr("Erro ao verificar job"));
        }

        if (checkData?.status === "running") {
          onProgress?.("running");
          continue;
        }

        if (checkData?.status === "failed") {
          throw new Error(checkData?.error || tr("A geração falhou"));
        }

        if (checkData?.status === "completed") {
          return checkData.result as { inserted: number; updated: number; skipped: number; total: number };
        }
      }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["prospects"] });
      toast.success(result.skipped ? tr("{{total}} encontrados • {{inserted}} novos • {{updated}} atualizados • {{skipped}} ignorados", { total: result.total, inserted: result.inserted, updated: result.updated, skipped: result.skipped }) : tr("{{total}} encontrados • {{inserted}} novos • {{updated}} atualizados", { total: result.total, inserted: result.inserted, updated: result.updated }));
    },
    onError: (error: Error) => {
      toast.error(error.message || tr("Erro ao gerar prospects"));
    },
  });
}

export function useDistributeProspects() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      prospectIds,
      quantity,
      salespersonIds,
    }: DistributeProspectsPayload) => {
      if (!organization?.id) throw new Error(tr("Sem organização ativa."));
      if (prospectIds.length === 0) {
        throw new Error(tr("Selecione pelo menos um prospect para distribuir."));
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(tr("Introduza uma quantidade válida para distribuir."));
      }
      if (quantity > prospectIds.length) {
        throw new Error(tr("A quantidade a distribuir não pode ser superior aos prospects selecionados."));
      }

      // Slice IDs client-side — the SQL overload with p_prospect_ids has no p_quantity param
      const idsToSend = prospectIds.slice(0, quantity);

      const { data, error } = await (supabase as any).rpc("distribute_prospects_round_robin", {
        p_organization_id: organization.id,
        p_prospect_ids: idsToSend,
        p_salesperson_ids: salespersonIds?.length ? salespersonIds : null,
      });

      if (error) throw new Error(mapProspectsError(error));

      const result = Array.isArray(data) ? data[0] : data;
      return {
        distributedCount: result?.distributed_count || 0,
        createdLeadsCount: result?.created_leads_count || 0,
      };
    },
    onSuccess: ({ distributedCount, createdLeadsCount }) => {
      queryClient.invalidateQueries({ queryKey: ["prospects"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success(tr("{{distributed}} prospects distribuídos • {{created}} leads criadas", { distributed: distributedCount, created: createdLeadsCount }));
    },
    onError: (error: Error) => {
      toast.error(mapProspectsError(error));
    },
  });
}
