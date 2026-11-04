import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLiveCommissions, type CpeDetail } from "@/hooks/useLiveCommissions";
import { useTeamMembers } from "@/hooks/useTeam";
import { tr } from "@/i18n";

interface ChargebackImportRecord {
  id: string;
  created_at: string;
  file_name: string;
  total_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  chargeback_count: number;
  total_chargeback_amount: number;
  reference_month: string | null;
}

interface ChargebackItemRecord {
  id: string;
  import_id: string;
  matched_user_id: string | null;
  chargeback_amount: number;
  matched: boolean;
  cpe: string;
  unmatched_reason: string | null;
  raw_row: Record<string, unknown> | null;
  matched_proposal_cpe_id: string | null;
}

interface ChargebackDataset {
  imports: ChargebackImportRecord[];
  items: ChargebackItemRecord[];
}

export interface FileDataRow {
  tipoComissao: string;
  nomeEmpresa: string;
  tipo: string;
  cpe: string;
  consumoAnual: string;
  duracaoContrato: string;
  dataInicio: string;
  dataFim: string;
  dbl: string;
  valorReceber: string;
}

export interface ComparisonRow {
  file: FileDataRow;
  systemConsumoAnual: number | null;
  systemDbl: number | null;
  systemDuracao: number | null;
  systemClientName: string | null;
  systemCpe: string | null;
  systemDataInicio: string | null;
  systemDataFim: string | null;
  systemNegotiationType: string | null;
  matchedProposalCpeId: string | null;
  hasConsumoDiscrepancy: boolean;
  hasDblDiscrepancy: boolean;
  hasDuracaoDiscrepancy: boolean;
  hasAnyDiscrepancy: boolean;
}

export interface CommissionAnalysisCommercial {
  userId: string;
  name: string;
  commissionAmount: number;
  commissionBaseCount: number;
  chargebackAmount: number;
  chargebackCount: number;
  differentialAmount: number;
  differentialCount: number;
  cpes: CpeDetail[];
  fileData: FileDataRow[];
  comparisonData: ComparisonRow[];
}

export interface CommissionAnalysisSummary {
  totalCommissionAmount: number;
  totalCommissionBaseCount: number;
  totalChargebackAmount: number;
  totalChargebackCount: number;
  totalDifferentialAmount: number;
  totalDifferentialCount: number;
  totalImports: number;
  unmatchedCount: number;
  unmatchedAmount: number;
  lastImportAt: string | null;
  cbFileCount: number;
  cbFileTotal: number;
  comFileCount: number;
  comFileTotal: number;
  cbFileDiscrepancies: number;
  cbFileItems: FileDataRow[];
  comFileItems: FileDataRow[];
}

export interface UnmatchedChargebackItem {
  cpe: string;
  chargebackAmount: number;
  unmatchedReason: string | null;
  fileData: FileDataRow | null;
}

export interface CommissionAnalysisData {
  commercials: CommissionAnalysisCommercial[];
  imports: ChargebackImportRecord[];
  unmatchedItems: UnmatchedChargebackItem[];
  summary: CommissionAnalysisSummary;
}

export interface ImportChargebackSummary {
  import_id: string;
  total_rows: number;
  chargeback_count: number;
  matched_rows: number;
  unmatched_rows: number;
  total_chargeback_amount: number;
}

export interface ImportChargebackRow {
  cpe: string;
  chargeback_amount: string;
  [key: string]: string;
}

const EMPTY_ANALYSIS: CommissionAnalysisData = {
  commercials: [],
  imports: [],
  unmatchedItems: [],
  summary: {
    totalCommissionAmount: 0,
    totalCommissionBaseCount: 0,
    totalChargebackAmount: 0,
    totalChargebackCount: 0,
    totalDifferentialAmount: 0,
    totalDifferentialCount: 0,
    totalImports: 0,
    unmatchedCount: 0,
    unmatchedAmount: 0,
    lastImportAt: null,
    cbFileCount: 0,
    cbFileTotal: 0,
    comFileCount: 0,
    comFileTotal: 0,
    cbFileDiscrepancies: 0,
    cbFileItems: [],
    comFileItems: [],
  },
};

function normalizeKey(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function excelSerialToDate(serial: number): Date {
  const epoch = new Date(Date.UTC(1899, 11, 30));
  return new Date(epoch.getTime() + serial * 86400000);
}

function parseDateValue(raw: string): Date | null {
  const trimmed = raw.trim();
  const asNum = Number(trimmed);
  if (!isNaN(asNum) && asNum > 1 && asNum < 100000) {
    return excelSerialToDate(asNum);
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [dd, mm, yyyy] = trimmed.split("/");
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return new Date(trimmed);
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
    const [dd, mm, yyyy] = trimmed.split("-");
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  }
  return null;
}

function formatDateForDisplay(raw: string): string {
  const d = parseDateValue(raw);
  if (!d || isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function parseRawRow(raw: Record<string, unknown> | null): FileDataRow | null {
  if (!raw) return null;

  const normalizedMap = new Map<string, string>();
  for (const key of Object.keys(raw)) {
    const nk = normalizeKey(key);
    if (!normalizedMap.has(nk)) {
      const val = raw[key];
      if (val != null && String(val).trim()) {
        normalizedMap.set(nk, String(val).trim());
      }
    }
  }

  const get = (patterns: string[]) => {
    for (const p of patterns) {
      const np = normalizeKey(p);
      const exact = normalizedMap.get(np);
      if (exact) return exact;
      for (const [nk, v] of normalizedMap) {
        if (nk.includes(np) || np.includes(nk)) return v;
      }
    }
    return "";
  };

  const rawDataInicio = get(["Linha de Contrato: Data de inicio", "Data de inicio"]);
  const rawDataFim = get(["Linha de Contrato: Data Fim de Contrato", "Data Fim"]);

  return {
    tipoComissao: get(["Tipo de Comissão", "Tipo de comissao"]),
    nomeEmpresa: get(["Nome da Empresa"]),
    tipo: get(["Tipo"]),
    cpe: get(["Linha de Contrato: Local de Consumo", "Local de Consumo", "CPE"]),
    consumoAnual: get(["Linha de Contrato: Consumo anual", "Consumo anual"]),
    duracaoContrato: get(["Duração contrato (anos)", "Duracao contrato"]),
    dataInicio: rawDataInicio ? formatDateForDisplay(rawDataInicio) : "",
    dataFim: rawDataFim ? formatDateForDisplay(rawDataFim) : "",
    dbl: get(["DBL"]),
    valorReceber: get(["Valor a receber", "Comissao Total"]),
  };
}

export function useCommissionAnalysis(selectedMonth: string, effectiveUserIds?: string[] | null) {
  const { organization } = useAuth();
  const { data: members = [] } = useTeamMembers();
  const liveCommissions = useLiveCommissions(selectedMonth, effectiveUserIds);
  const organizationId = organization?.id;

  const chargebackData = useQuery<ChargebackDataset>({
    queryKey: ["commission-chargeback-data", organizationId, selectedMonth],
    queryFn: async () => {
      if (!organizationId) {
        return { imports: [], items: [] } satisfies ChargebackDataset;
      }

      // Fetch imports for this org
      const importsResult = await (supabase as any)
        .from("commission_chargeback_imports")
        .select("id, created_at, file_name, total_rows, matched_rows, unmatched_rows, chargeback_count, total_chargeback_amount, reference_month")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      if (importsResult.error) throw importsResult.error;
      const imports = (importsResult.data || []) as ChargebackImportRecord[];

      // Find the import matching the selected month by reference_month
      const selectedDate = new Date(selectedMonth);
      const selectedYear = selectedDate.getFullYear();
      const selectedMonthNum = selectedDate.getMonth();

      const matchingImport = imports.find((imp) => {
        if (!imp.reference_month) return false;
        const refDate = new Date(imp.reference_month + "T00:00:00");
        return refDate.getFullYear() === selectedYear && refDate.getMonth() === selectedMonthNum;
      }) || imports[0] || null; // Fallback to latest if no month match

      let items: ChargebackItemRecord[] = [];
      if (matchingImport) {
        // Fetch items only for the active import — no range limit needed
        const itemsResult = await (supabase as any)
          .from("commission_chargeback_items")
          .select("id, import_id, matched_user_id, chargeback_amount, matched, cpe, unmatched_reason, raw_row, matched_proposal_cpe_id")
          .eq("organization_id", organizationId)
          .eq("import_id", matchingImport.id)
          .order("created_at", { ascending: false });

        if (itemsResult.error) throw itemsResult.error;
        items = (itemsResult.data || []) as ChargebackItemRecord[];
      }

      return {
        imports,
        items,
      } satisfies ChargebackDataset;
    },
    enabled: !!organizationId,
  });

  const data = useMemo<CommissionAnalysisData>(() => {
    const liveData = liveCommissions.data;
    const imports = chargebackData.data?.imports || [];
    const allItems = chargebackData.data?.items || [];

    if (!liveData && imports.length === 0 && allItems.length === 0) {
      return EMPTY_ANALYSIS;
    }

    // Find import matching selected month (already done in query, but resolve activeImportId)
    const selectedMonthStart = new Date(selectedMonth);
    const selectedYear = selectedMonthStart.getFullYear();
    const selectedMonthNum = selectedMonthStart.getMonth();

    const matchingImport = imports.find((imp) => {
      if (!imp.reference_month) return false;
      const refDate = new Date(imp.reference_month + "T00:00:00");
      return refDate.getFullYear() === selectedYear && refDate.getMonth() === selectedMonthNum;
    }) || imports[0] || null;

    const activeImportId = matchingImport?.id ?? null;
    const itemsFromActiveImportRaw = activeImportId
      ? allItems.filter((item) => item.import_id === activeImportId)
      : [];

    // Filter imported items by reference_month of the active import
    const activeImportRefMonth = matchingImport?.reference_month ?? null;
    let itemsFromActiveImport: ChargebackItemRecord[];
    if (activeImportRefMonth) {
      // Compare reference_month (YYYY-MM-DD) with selected month
      const refDate = new Date(activeImportRefMonth + "T00:00:00");
      const refMatches = refDate.getFullYear() === selectedYear && refDate.getMonth() === selectedMonthNum;
      itemsFromActiveImport = refMatches ? itemsFromActiveImportRaw : [];
    } else {
      // Fallback for old imports without reference_month: use dataInicio
      itemsFromActiveImport = itemsFromActiveImportRaw.filter((item) => {
        const parsed = parseRawRow(item.raw_row as Record<string, unknown> | null);
        if (!parsed) return false;
        if (!parsed.dataInicio) return true;
        const d = parseDateValue(parsed.dataInicio);
        if (!d || isNaN(d.getTime())) return true;
        return d.getFullYear() === selectedYear && d.getMonth() === selectedMonthNum;
      });
    }

    const memberNameMap = new Map(
      members.map((member) => [member.user_id, member.full_name || member.email || "Comercial"])
    );

    const filteredItems = itemsFromActiveImport.filter((item) => {
      if (!effectiveUserIds || effectiveUserIds.length === 0) return true;
      if (!item.matched_user_id) return false;
      return effectiveUserIds.includes(item.matched_user_id);
    });

    const byUser = new Map<string, CommissionAnalysisCommercial>();

    // Build file data map: matched_user_id -> { parsed, matchedProposalCpeId }[]
    const userFileData = new Map<string, { parsed: FileDataRow; matchedProposalCpeId: string | null }[]>();
    for (const item of filteredItems) {
      if (!item.matched_user_id) continue;
      const parsed = parseRawRow(item.raw_row);
      if (parsed) {
        const arr = userFileData.get(item.matched_user_id) || [];
        arr.push({ parsed, matchedProposalCpeId: item.matched_proposal_cpe_id ?? null });
        userFileData.set(item.matched_user_id, arr);
      }
    }

    // Helper to normalize CPE for matching
    const normCpe = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

    // Helper: calculate canonical duration from dates
    const calcDurationFromDates = (startStr: string, endStr: string): number | null => {
      const s = parseDateValue(startStr);
      const e = parseDateValue(endStr);
      if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) return null;
      const diffMs = e.getTime() - s.getTime();
      return diffMs / (365 * 86400000);
    };

    // Build comparison data for a commercial
    const buildComparison = (fileEntries: { parsed: FileDataRow; matchedProposalCpeId: string | null }[], cpes: CpeDetail[]): ComparisonRow[] => {
      return fileEntries.map(({ parsed: file, matchedProposalCpeId }) => {
        const fileCpeNorm = normCpe(file.cpe);
        const match = fileCpeNorm ? cpes.find((c) => c.serial_number && normCpe(c.serial_number) === fileCpeNorm) : undefined;

        const fileConsumo = parseFloat(file.consumoAnual.replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
        const fileDbl = parseFloat(file.dbl.replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
        
        // Canonical duration: prefer calculation from dates, fallback to raw field
        const fileDuracaoFromDates = file.dataInicio && file.dataFim ? calcDurationFromDates(file.dataInicio, file.dataFim) : null;
        const fileDuracaoRaw = parseFloat(file.duracaoContrato.replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
        const fileDuracao = fileDuracaoFromDates ?? fileDuracaoRaw;

        const systemConsumo = match ? match.consumo_anual : null;
        const systemDbl = match ? match.dbl : null;
        const systemDuracao = match ? match.duracao_contrato : null;

        const hasConsumoDiscrepancy = systemConsumo !== null && Math.abs(systemConsumo - fileConsumo) > 0.01;
        const hasDblDiscrepancy = systemDbl !== null && Math.abs(systemDbl - fileDbl) > 0.01;
        // Compare with tolerance for duration (dates can produce fractional values)
        const hasDuracaoDiscrepancy = systemDuracao !== null && Math.abs(systemDuracao - fileDuracao) > 0.02;

        return {
          file,
          systemConsumoAnual: systemConsumo,
          systemDbl: systemDbl,
          systemDuracao: systemDuracao,
          systemClientName: match ? (match.client_name ?? null) : null,
          systemCpe: match ? (match.serial_number ?? null) : null,
          systemDataInicio: match ? (match.contrato_inicio ?? null) : null,
          systemDataFim: match ? (match.contrato_fim ?? null) : null,
          systemNegotiationType: match ? (match.negotiation_type ?? null) : null,
          matchedProposalCpeId: (match ? match.proposal_cpe_id : null) || matchedProposalCpeId,
          hasConsumoDiscrepancy,
          hasDblDiscrepancy,
          hasDuracaoDiscrepancy,
          hasAnyDiscrepancy: hasConsumoDiscrepancy || hasDblDiscrepancy || hasDuracaoDiscrepancy,
        };
      });
    };

    for (const commercial of liveData?.commercials || []) {
      const fileEntries = userFileData.get(commercial.userId) || [];
      byUser.set(commercial.userId, {
        userId: commercial.userId,
        name: commercial.name,
        commissionAmount: commercial.totalIndicativa,
        commissionBaseCount: commercial.cpes.length,
        chargebackAmount: 0,
        chargebackCount: 0,
        differentialAmount: commercial.totalIndicativa,
        differentialCount: commercial.cpes.length,
        cpes: commercial.cpes,
        fileData: fileEntries.map((e) => e.parsed),
        comparisonData: buildComparison(fileEntries, commercial.cpes),
      });
    }

    for (const item of filteredItems) {
      if (!item.matched_user_id) continue;

      const fileEntries = userFileData.get(item.matched_user_id) || [];
      const existing = byUser.get(item.matched_user_id) || {
        userId: item.matched_user_id,
        name: memberNameMap.get(item.matched_user_id) || "Comercial",
        commissionAmount: 0,
        commissionBaseCount: 0,
        chargebackAmount: 0,
        chargebackCount: 0,
        differentialAmount: 0,
        differentialCount: 0,
        cpes: [],
        fileData: fileEntries.map((e) => e.parsed),
        comparisonData: buildComparison(fileEntries, []),
      };

      existing.chargebackAmount += Number(item.chargeback_amount || 0);
      existing.chargebackCount += 1;
      existing.differentialAmount = existing.commissionAmount - existing.chargebackAmount;
      existing.differentialCount = existing.commissionBaseCount - existing.chargebackCount;

      byUser.set(item.matched_user_id, existing);
    }

    const commercials = Array.from(byUser.values()).filter((c) => c.fileData.length > 0).sort((a, b) => {
      if (b.chargebackAmount !== a.chargebackAmount) return b.chargebackAmount - a.chargebackAmount;
      if (b.commissionAmount !== a.commissionAmount) return b.commissionAmount - a.commissionAmount;
      return a.name.localeCompare(b.name, "pt-PT");
    });

    const totalCommissionAmount = commercials.reduce((sum, item) => sum + item.commissionAmount, 0);
    const totalCommissionBaseCount = commercials.reduce((sum, item) => sum + item.commissionBaseCount, 0);
    const totalChargebackAmount = commercials.reduce((sum, item) => sum + item.chargebackAmount, 0);
    const totalChargebackCount = commercials.reduce((sum, item) => sum + item.chargebackCount, 0);
    const unmatchedItems = effectiveUserIds && effectiveUserIds.length > 0
      ? []
      : itemsFromActiveImport.filter((item) => !item.matched);
    const unmatchedCount = unmatchedItems.length;
    const unmatchedAmount = unmatchedItems.reduce((sum, item) => sum + Number(item.chargeback_amount || 0), 0);

    // Calculate CB summary from ALL items in active import (matched + unmatched)
    const parseNumVal = (s: string) => {
      const cleaned = s.replace(/[^\d.,-]/g, "").replace(",", ".");
      return parseFloat(cleaned) || 0;
    };
    const normStr = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    let cbFileCount = 0, cbFileTotal = 0, cbFileDiscrepancies = 0;
    let comFileCount = 0, comFileTotal = 0;
    const cbFileItems: FileDataRow[] = [];
    const comFileItems: FileDataRow[] = [];
    for (const item of itemsFromActiveImport) {
      const parsed = parseRawRow(item.raw_row as Record<string, unknown> | null);
      if (!parsed) continue;
      const isCb = normStr(parsed.tipoComissao).includes("cb");
      const val = parseNumVal(parsed.valorReceber);
      if (isCb) {
        cbFileCount++;
        cbFileTotal += val;
        cbFileItems.push(parsed);
      } else {
        comFileCount++;
        comFileTotal += val;
        comFileItems.push(parsed);
      }
    }
    // Count CB discrepancies from commercials (only matched ones have comparison data)
    for (const commercial of commercials) {
      for (const row of commercial.comparisonData) {
        const isCb = normStr(row.file.tipoComissao).includes("cb");
        if (isCb && row.hasAnyDiscrepancy) cbFileDiscrepancies++;
      }
    }

    const unmatchedItemsList: UnmatchedChargebackItem[] = unmatchedItems.map((item) => ({
      cpe: item.cpe,
      chargebackAmount: Number(item.chargeback_amount || 0),
      unmatchedReason: item.unmatched_reason,
      fileData: parseRawRow(item.raw_row),
    }));

    return {
      commercials,
      imports,
      unmatchedItems: unmatchedItemsList,
      summary: {
        totalCommissionAmount,
        totalCommissionBaseCount,
        totalChargebackAmount,
        totalChargebackCount,
        totalDifferentialAmount: totalCommissionAmount - totalChargebackAmount,
        totalDifferentialCount: totalCommissionBaseCount - totalChargebackCount,
        totalImports: imports.length,
        unmatchedCount,
        unmatchedAmount,
        lastImportAt: imports[0]?.created_at || null,
        cbFileCount,
        cbFileTotal,
        comFileCount,
        comFileTotal,
        cbFileDiscrepancies,
        cbFileItems,
        comFileItems,
      },
    } satisfies CommissionAnalysisData;
  }, [chargebackData.data?.imports, chargebackData.data?.items, effectiveUserIds, liveCommissions.data, members, selectedMonth]);

  return {
    data,
    isLoading: liveCommissions.isLoading || chargebackData.isLoading,
    isError: liveCommissions.isError || chargebackData.isError,
    refetch: async () => {
      await Promise.all([liveCommissions.refetch(), chargebackData.refetch()]);
    },
  };
}

export function useImportCommissionChargebacks() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      fileName: string;
      cpeColumnName: string;
      rows: ImportChargebackRow[];
      referenceMonth?: string;
    }): Promise<ImportChargebackSummary> => {
      if (!organization?.id) {
        throw new Error(tr("Organização não encontrada"));
      }

      const rpcParams: Record<string, unknown> = {
        p_organization_id: organization.id,
        p_file_name: params.fileName,
        p_cpe_column_name: params.cpeColumnName,
        p_rows: params.rows,
      };
      if (params.referenceMonth) {
        rpcParams.p_reference_month = params.referenceMonth;
      }

      const { data, error } = await (supabase as any).rpc("import_commission_chargebacks", rpcParams);

      if (error) throw error;

      const summary = Array.isArray(data) ? data[0] : data;
      if (!summary) {
        throw new Error(tr("Não foi possível concluir a importação"));
      }

      return summary as ImportChargebackSummary;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["commission-chargeback-data", organization?.id] }),
        queryClient.invalidateQueries({ queryKey: ["commissions-live"] }),
      ]);
    },
  });
}

export interface SyncFileToSystemItem {
  proposalCpeId: string;
  // null = invalid/empty in the file → do NOT overwrite the system value.
  dbl: number | null;
  consumoAnual: number | null;
  duracaoContrato: number | null;
  contratoInicio: string | null;
  contratoFim: string | null;
}

export function useSyncFileToSystem() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();

  return useMutation({
    mutationFn: async (items: SyncFileToSystemItem[]) => {
      if (!items.length) return;

      let updatedCount = 0;

      for (const item of items) {
        // Only overwrite fields that have a valid value in the file. Invalid /
        // empty values arrive as null and are skipped, so good system data is
        // never clobbered with 0.
        const updatePayload: Record<string, unknown> = {};
        if (item.dbl != null) updatePayload.dbl = item.dbl;
        if (item.consumoAnual != null) updatePayload.consumo_anual = item.consumoAnual;
        if (item.duracaoContrato != null) updatePayload.duracao_contrato = item.duracaoContrato;
        if (item.contratoInicio) updatePayload.contrato_inicio = item.contratoInicio;
        if (item.contratoFim) updatePayload.contrato_fim = item.contratoFim;
        if (Object.keys(updatePayload).length === 0) continue;

        const { data, error } = await (supabase as any)
          .from("proposal_cpes")
          .update(updatePayload)
          .eq("id", item.proposalCpeId)
          .select("id");

        if (error) throw error;
        if (data && data.length > 0) updatedCount++;
        else console.warn(`[Sync] CPE ${item.proposalCpeId} — 0 rows affected`);
      }

      if (updatedCount === 0) {
        throw new Error(tr("Nenhum CPE foi atualizado. Os IDs podem estar obsoletos."));
      }

      console.log(`[Sync] ${updatedCount}/${items.length} CPEs atualizados com sucesso`);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["commissions-live"] }),
        queryClient.invalidateQueries({ queryKey: ["commission-chargeback-data", organization?.id] }),
      ]);
    },
  });
}
