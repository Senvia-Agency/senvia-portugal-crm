import { AutomationRecordActions } from "@/components/automations/AutomationRecordActions";
import { useState, useMemo, useEffect, useRef } from "react";

import { useSearchParams, useLocation } from "react-router-dom";
import { usePersistedState } from "@/hooks/usePersistedState";
import { cn, matchesSearch } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Search, Users, Upload, Download, ChevronDown, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { useClients, useClientStats, useDeleteClient } from "@/hooks/useClients";
import { useClientLabels } from "@/hooks/useClientLabels";
import { useTeamMembers } from "@/hooks/useTeam";
import { ClientsTable } from "@/components/clients/ClientsTable";
import { CreateClientModal } from "@/components/clients/CreateClientModal";
import { EditClientModal } from "@/components/clients/EditClientModal";
import { ClientDetailsDrawer } from "@/components/clients/ClientDetailsDrawer";
import { ClientFilters } from "@/components/clients/ClientFilters";
import { defaultFilters, hasClientFilters, type ClientFiltersState } from "@/components/clients/client-filters";
import { BulkActionsBar } from "@/components/shared/BulkActionsBar";
import { AssignTeamMemberModal } from "@/components/shared/AssignTeamMemberModal";
import type { CrmClient } from "@/types/clients";
import { formatCurrency } from "@/lib/format";
import { mapClientsForExport, exportToCsv, exportToExcel } from "@/lib/export";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { ImportClientsDialog } from "@/components/clients/ImportClientsDialog";
import { useClientProposalTypes } from "@/hooks/useClientProposalTypes";
import { CreateProposalModal } from "@/components/proposals/CreateProposalModal";
import { importClients } from "@/lib/clients/import";
import { toast } from "sonner";
import { useModules } from "@/hooks/useModules";
import { format, isWithinInterval, startOfDay, endOfDay, parseISO } from "date-fns";
import * as XLSX from "xlsx";
import { PageModuleIcon } from "@/components/layout/ModuleNavIcon";
import { useLanguage } from "@/i18n";

/** One figure of the summary line under the filters. */
function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card px-4 py-2.5 shadow-sm">
      <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      <p className="truncate text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function Clients() {
  const { t } = useLanguage();
  const { profile, organization } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = usePersistedState("clients-search-v1", "");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedClient, setSelectedClient] = useState<CrmClient | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDetailsDrawer, setShowDetailsDrawer] = useState(false);
  // v2: several states, sources and types can be picked at once (and there is no VIP any more).
  const [filters, setFilters] = usePersistedState<ClientFiltersState>("clients-filters-v2", defaultFilters);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showCreateProposal, setShowCreateProposal] = useState(false);
  const [proposalClientId, setProposalClientId] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: clients, isLoading } = useClients();
  const { stats } = useClientStats();
  const deleteClient = useDeleteClient();
  const labels = useClientLabels();
  const { clientTypesMap, isTelecom } = useClientProposalTypes();
  const { data: teamMembers } = useTeamMembers();
  const { modules } = useModules();
  const showEnergy = isTelecom && modules.energy;
  const [isImporting, setIsImporting] = useState(false);

  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const client of clients ?? []) if (client.source) counts.set(client.source, (counts.get(client.source) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  }, [clients]);

  const filteredClients = useMemo(() => {
    if (!clients) return [];

    return clients.filter((client) => {
      if (search.trim()) {
        const matchesSearchTerm = matchesSearch(
          search,
          client.name,
          client.email,
          client.phone,
          client.company,
          client.code,
          client.nif,
        );

        if (!matchesSearchTerm) return false;
      }

      if (filters.statuses.length > 0 && !filters.statuses.includes(client.status)) {
        return false;
      }

      if (filters.sources.length > 0 && !(client.source && filters.sources.includes(client.source))) {
        return false;
      }

      if (filters.dateFrom || filters.dateTo) {
        const clientDate = parseISO(client.created_at);
        const from = filters.dateFrom ? startOfDay(new Date(filters.dateFrom)) : new Date(0);
        const to = filters.dateTo ? endOfDay(new Date(filters.dateTo)) : new Date(2100, 11, 31);

        if (!isWithinInterval(clientDate, { start: from, end: to })) {
          return false;
        }
      }

      // Proposal type filter (telecom)
      if (filters.proposalTypes.length > 0) {
        const types = clientTypesMap[client.id];
        if (!types || !filters.proposalTypes.some(type => types.includes(type))) {
          return false;
        }
      }

      return true;
    });
  }, [clients, search, filters, clientTypesMap]);

  const filtering = !!search.trim() || hasClientFilters(filters);

  // Editing from the record goes back to the record when the edit closes.
  const [editFromDetails, setEditFromDetails] = useState(false);
  const handleEdit = (client: CrmClient) => {
    setSelectedClient(client);
    setEditFromDetails(showDetailsDrawer);
    setShowDetailsDrawer(false);
    setShowEditModal(true);
  };
  const handleEditOpenChange = (open: boolean) => {
    setShowEditModal(open);
    if (!open && editFromDetails) {
      setEditFromDetails(false);
      setShowDetailsDrawer(true);
    }
  };
  // The record shows the client as saved, not as it was when it was opened.
  const shownClient = (selectedClient && clients?.find((client) => client.id === selectedClient.id)) || selectedClient;

  const handleView = (client: CrmClient) => {
    setSelectedClient(client);
    setShowDetailsDrawer(true);
  };

  const handleDelete = (clientId: string) => {
    deleteClient.mutate(clientId);
  };

  const handleClearFilters = () => {
    setSearch("");
    setFilters(defaultFilters);
  };

  useEffect(() => {
    setSelectedIds([]);
  }, [search, filters]);

  // Auto-open client drawer from URL param (e.g. from dashboard widget)
  useEffect(() => {
    const highlightId = searchParams.get('highlight');
    if (highlightId && clients && clients.length > 0) {
      const client = clients.find(c => c.id === highlightId);
      if (client) {
        handleView(client);
      }
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, clients]);

  // Auto-open client drawer from location state (e.g. from Lead → Won flow)
  useEffect(() => {
    const openClientId = (location.state as { openClientId?: string } | null)?.openClientId;
    if (openClientId && clients && clients.length > 0) {
      const client = clients.find(c => c.id === openClientId);
      if (client) {
        handleView(client);
      }
      // Clear state to prevent re-opening on re-render
      window.history.replaceState({}, document.title);
    }
  }, [location.state, clients]);

  const handleAssignSuccess = () => {
    setSelectedIds([]);
    setShowAssignModal(false);
  };

  const exportClients = (list: CrmClient[], kind: 'csv' | 'excel') => {
    const data = mapClientsForExport(list, organization?.niche === 'telecom');
    const name = `clientes_${format(new Date(), 'yyyy-MM-dd')}`;
    if (kind === 'csv') exportToCsv(data, name); else exportToExcel(data, name);
    toast.success(t("{{n}} clientes exportados para {{format}}", { n: list.length, format: kind === 'csv' ? 'CSV' : 'Excel' }));
  };
  const selectedClients = () => filteredClients.filter(c => selectedIds.includes(c.id));

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !organization || !profile) return;
    e.target.value = "";

    setIsImporting(true);
    const toastId = toast.loading(t("A ler ficheiro..."));

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

      if (!data.length) {
        toast.dismiss(toastId);
        toast.error(t("Ficheiro vazio ou sem dados."));
        setIsImporting(false);
        return;
      }

      const result = await importClients(
        data,
        organization.id,
        profile.id,
        teamMembers || [],
        (current, total) => toast.loading(t("A importar: {{current}}/{{total}}...", { current, total }), { id: toastId })
      );

      toast.dismiss(toastId);

      if (result.inserted > 0) {
        toast.success(t("{{n}} clientes importados com sucesso!", { n: result.inserted }));
      }
      if (result.failed > 0) {
        toast.error(`${t("{{n}} linhas falharam.", { n: result.failed })} ${result.errors[0] || ""}`);
      }

      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["cpes"] });
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(t("Erro ao processar ficheiro."));
      console.error("[importClients] error:", err);
    } finally {
      setIsImporting(false);
    }
  };

  const total = clients?.length ?? 0;

  return (
    <>
      <SEO
        title={`${t(labels.plural)} | Senvia OS`}
        description={t("Gestão de {{entities}} CRM", { entities: t(labels.plural).toLowerCase() })}
      />

      <div className="crm-page">
        <div className="space-y-4 p-4 sm:p-6 lg:px-8 lg:py-7">
          {/* One line: title and count, the rarely used actions behind ⋯, and the one main action. */}
          <header className="flex flex-wrap items-center gap-x-3 gap-y-3">
            <PageModuleIcon to="/clients" />
            <div className="flex items-baseline gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{t(labels.plural)}</h1>
              <span className="text-sm tabular-nums text-muted-foreground">{filtering ? `${filteredClients.length} de ${total}` : total}</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {isTelecom && <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportFile} />}
              {/* Any organization imports from a plain spreadsheet; telecom keeps its file with CPEs. */}
              {isTelecom ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="h-9 rounded-full px-3" disabled={isImporting} aria-label={t("Importar {{entities}}", { entities: t(labels.plural).toLowerCase() })}>
                      {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      <span className="hidden sm:inline">{isImporting ? t("A importar…") : t("Importar")}</span><ChevronDown className="h-3.5 w-3.5 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuItem onSelect={() => setShowImport(true)}><Upload className="mr-2 h-4 w-4" />{t("Importar {{entities}}", { entities: t(labels.plural).toLowerCase() })}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}><Upload className="mr-2 h-4 w-4" />{t("Ficheiro com CPEs (Perfect2Gether)")}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button variant="outline" className="h-9 rounded-full px-3" onClick={() => setShowImport(true)} aria-label={t("Importar {{entities}}", { entities: t(labels.plural).toLowerCase() })}>
                  <Upload className="h-4 w-4" /><span className="hidden sm:inline">{t("Importar")}</span>
                </Button>
              )}
              <ExportMenu count={filteredClients.length} noun={labels.plural.toLowerCase()} onExport={(kind) => exportClients(filteredClients, kind)} />
              <Button onClick={() => setShowCreateModal(true)} className="h-9 rounded-full px-4">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{t(labels.new)}</span>
              </Button>
            </div>
          </header>

          <ClientFilters
            filters={filters}
            onFiltersChange={setFilters}
            search={search}
            onSearch={setSearch}
            sourceCounts={sourceCounts}
            isTelecom={showEnergy}
            hasActive={filtering}
            onClear={handleClearFilters}
          />

          {/* The figures that matter, in one compact row instead of five big cards. */}
          <div className={cn("grid grid-cols-2 gap-2", organization?.niche === 'telecom' ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
            <Figure label={t(labels.total)} value={String(stats.total)} />
            <Figure label={t(labels.active)} value={String(stats.active)} />
            <Figure label={t(labels.inactive)} value={String(stats.inactive)} />
            {organization?.niche === 'telecom' && (
              <Figure label={t("Comissão total")} value={formatCurrency(stats.totalComissao)}
                hint={showEnergy ? `${stats.totalMwh.toFixed(1)} MWh · ${stats.totalKwp.toFixed(1)} kWp` : undefined} />
            )}
          </div>

          {selectedIds.length > 0 && <AutomationRecordActions subjectType="client" subjectIds={selectedIds} />}

          <BulkActionsBar
            selectedCount={selectedIds.length}
            onAssignTeamMember={() => setShowAssignModal(true)}
            onExportCsv={() => exportClients(selectedClients(), 'csv')}
            onExportExcel={() => exportClients(selectedClients(), 'excel')}
            onClearSelection={() => setSelectedIds([])}
            entityLabel="clientes selecionados"
          />

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredClients.length === 0 && filtering ? (
            <div className="flex h-56 flex-col items-center justify-center gap-3 text-muted-foreground">
              <Search className="h-10 w-10 opacity-50" />
              <p className="text-base font-medium">{t("Nenhum {{entity}} corresponde aos filtros", { entity: t(labels.singular).toLowerCase() })}</p>
              <Button variant="outline" size="sm" className="rounded-full" onClick={handleClearFilters}>{t("Limpar filtros")}</Button>
            </div>
          ) : filteredClients.length === 0 ? (
            <EmptyState
              icon={Users}
              title={t("Ainda não tens clientes")}
              description={t("Cria o teu primeiro cliente ou converte uma lead ganha. O Otto pode ajudar.")}
            >
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="h-4 w-4 mr-2" />
                {t("Criar primeiro cliente")}
              </Button>
            </EmptyState>
          ) : (
            <ClientsTable
              clients={filteredClients}
              onEdit={handleEdit}
              onView={handleView}
              onDelete={handleDelete}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              isTelecom={showEnergy}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      <ImportClientsDialog open={showImport} onOpenChange={setShowImport} />
      <CreateClientModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
      />

      <EditClientModal
        client={shownClient}
        open={showEditModal}
        onOpenChange={handleEditOpenChange}
      />

      <ClientDetailsDrawer
        client={shownClient}
        open={showDetailsDrawer}
        onOpenChange={setShowDetailsDrawer}
        onEdit={handleEdit}
        onNewProposal={(client) => {
          setProposalClientId(client.id);
          setShowCreateProposal(true);
        }}
      />

      <CreateProposalModal
        open={showCreateProposal}
        onOpenChange={setShowCreateProposal}
        preselectedClientId={proposalClientId ?? undefined}
      />

      <AssignTeamMemberModal
        open={showAssignModal}
        onOpenChange={setShowAssignModal}
        selectedIds={selectedIds}
        entityType="clients"
        onSuccess={handleAssignSuccess}
      />
    </>
  );
}
