import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePersistedState } from "@/hooks/usePersistedState";

import { useAuth } from "@/contexts/AuthContext";
import { useProposals } from '@/hooks/useProposals';
import { useProposalsRealtime } from '@/hooks/useRealtimeSubscription';
import { TeamMemberFilter } from '@/components/dashboard/TeamMemberFilter';
import { FilterRow, MultiFilterPill } from '@/components/shared/FilterPills';
import { filterChipClass, toggled } from '@/components/shared/filter-pills';
import { Button } from '@/components/ui/button';
import { FileText, Plus, Search, Layers, Wrench, RadioTower, Upload } from 'lucide-react';
import { ImportProposalsDialog } from '@/components/proposals/ImportProposalsDialog';
import { EmptyState } from '@/components/ui/empty-state';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import type { DateRange } from 'react-day-picker';
import { ProposalDetailsModal } from '@/components/proposals/ProposalDetailsModal';
import { CreateProposalModal } from '@/components/proposals/CreateProposalModal';
import { ProposalsTable } from '@/components/proposals/ProposalsTable';
import { formatEuro } from '@/components/proposals/proposal-display';
import { CreateSaleModal } from '@/components/sales/CreateSaleModal';
import { PROPOSAL_STATUS_LABELS, PROPOSAL_STATUSES, PROPOSAL_TYPE_LABELS } from '@/types/proposals';
import type { Proposal, ProposalStatus, ProposalType } from '@/types/proposals';
import { cn, matchesSearch } from '@/lib/utils';
import { useTeamFilter } from '@/hooks/useTeamFilter';
import { useOperators } from '@/hooks/useOperators';
import { PageModuleIcon } from '@/components/layout/ModuleNavIcon';
import { ExportMenu, type ExportKind } from '@/components/shared/ExportMenu';
import { exportToCsv, exportToExcel, mapProposalsForExport } from '@/lib/export';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useLanguage } from "@/i18n";

const NO_OPERATOR = '__none__';

/** One figure of the summary line under the filters; with onClick it filters the list down to what it counts. */
function Figure({ label, value, tone, hint, onClick }: { label: string; value: string; tone?: string; hint?: string; onClick?: () => void }) {
  const body = (
    <>
      <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("truncate text-lg font-semibold tabular-nums", tone)}>{value}</p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </>
  );
  const box = "min-w-0 rounded-xl border border-border/70 bg-card px-4 py-2.5 text-left shadow-sm";
  return onClick
    ? <button type="button" onClick={onClick} className={cn(box, "transition-colors hover:border-primary/40 hover:bg-primary/[0.03]")}>{body}</button>
    : <div className={box}>{body}</div>;
}

export default function Proposals() {
  const { t } = useLanguage();
  // Subscribe to realtime updates
  useProposalsRealtime();
  const navigate = useNavigate();
  const { organization } = useAuth();
  const { data: proposals = [], isLoading } = useProposals();
  const isTelecom = organization?.niche === 'telecom';
  const { data: operators = [] } = useOperators();
  const { selectedMemberId } = useTeamFilter();

  const [search, setSearch] = usePersistedState('proposals-search-v1', '');
  // v2: the filters list what is shown (empty = everything), like leads and clients.
  const [statuses, setStatuses] = usePersistedState<ProposalStatus[]>('proposals-status-v2', []);
  const [types, setTypes] = usePersistedState<ProposalType[]>('proposals-type-v2', []);
  const [operatorIds, setOperatorIds] = usePersistedState<string[]>('proposals-operators-v2', []);
  const [dateRange, setDateRange] = usePersistedState<DateRange | undefined>('proposals-date-range-v1', undefined);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // "Criar venda" from the list: open a fully prefilled sale for this proposal.
  const [saleProposal, setSaleProposal] = useState<Proposal | null>(null);
  const [searchParams] = useSearchParams();

  // Deep-link: ?proposal=<id> opens the proposal modal directly
  useEffect(() => {
    const id = searchParams.get("proposal");
    if (id && proposals.length > 0) {
      const found = proposals.find((p) => p.id === id);
      if (found) setSelectedProposal(found);
    }
  }, [searchParams, proposals]);

  const filteredProposals = useMemo(() => proposals.filter((proposal) => {
    // Hide proposals that already have a sale created (telecom)
    if (isTelecom && (proposal as { has_sale?: boolean }).has_sale) return false;

    const matchesSearchTerm = matchesSearch(
      search,
      proposal.client?.name,
      proposal.lead?.name,
      proposal.code,
      proposal.notes,
    );
    const matchesStatus = statuses.length === 0 || statuses.includes(proposal.status);
    const matchesType = !isTelecom || types.length === 0 || (!!proposal.proposal_type && types.includes(proposal.proposal_type));
    const operatorKeys = Object.values(proposal.servicos_details ?? {}).map((detail) => (detail as { operator_id?: string } | null)?.operator_id || NO_OPERATOR);
    if (operatorKeys.length === 0) operatorKeys.push(NO_OPERATOR);
    const matchesOperator = operatorIds.length === 0 || operatorKeys.some((key) => operatorIds.includes(key));
    const proposalDate = new Date(proposal.proposal_date);
    const from = dateRange?.from ? new Date(dateRange.from) : null;
    const to = dateRange?.to ? new Date(dateRange.to) : null;
    const matchesDate = !from || (proposalDate >= from && (!to || proposalDate <= to));
    return matchesSearchTerm && matchesStatus && matchesType && matchesDate && matchesOperator;
  }), [proposals, isTelecom, search, statuses, types, operatorIds, dateRange]);

  const filtering = !!search.trim() || statuses.length > 0 || types.length > 0 || operatorIds.length > 0 || !!dateRange?.from;
  const clearFilters = () => {
    setSearch('');
    setStatuses([]);
    setTypes([]);
    setOperatorIds([]);
    setDateRange(undefined);
  };

  const totalValue = filteredProposals.reduce((sum, p) => sum + Number(p.total_value), 0);
  // Still open: sent and not answered yet, or being negotiated.
  const OPEN_STATUSES: ProposalStatus[] = ['sent', 'negotiating'];
  const openProposals = filteredProposals.filter(p => OPEN_STATUSES.includes(p.status));
  const pendingValue = openProposals.reduce((sum, p) => sum + Number(p.total_value), 0);
  const acceptedCount = filteredProposals.filter(p => p.status === 'accepted').length;

  const handleExport = (kind: ExportKind) => {
    const data = mapProposalsForExport(filteredProposals, isTelecom);
    const name = `propostas_${format(new Date(), 'yyyy-MM-dd')}`;
    if (kind === 'excel') exportToExcel(data, name); else exportToCsv(data, name);
    toast.success(t("{{n}} propostas exportadas", { n: data.length }));
  };

  return (
    <>
      <div className="crm-page">
        <div className="space-y-4 p-4 sm:p-6 lg:px-8 lg:py-7">
          {/* One line: title and count, and the one main action. */}
          <header className="flex flex-wrap items-center gap-x-3 gap-y-3">
            <PageModuleIcon to="/proposals" />
            <div className="flex items-baseline gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{t("Propostas")}</h1>
              <span className="text-sm tabular-nums text-muted-foreground">
                {filtering ? t("{{n}} de {{total}}", { n: filteredProposals.length, total: proposals.length }) : filteredProposals.length}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" className="h-9 shrink-0 rounded-full px-3" onClick={() => setImportOpen(true)} aria-label={t("Importar propostas")}>
                <Upload className="h-4 w-4" /><span className="hidden sm:inline">{t("Importar")}</span>
              </Button>
              <ExportMenu count={filteredProposals.length} noun="propostas" onExport={handleExport} />
              <Button onClick={() => setCreateModalOpen(true)} className="h-9 rounded-full px-4">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{t("Nova proposta")}</span>
              </Button>
            </div>
          </header>

          <FilterRow search={search} onSearch={setSearch} placeholder={t("Pesquisar cliente, lead, código ou notas")}
            hasActive={filtering} onClear={clearFilters}>
            <DateRangePicker
              value={dateRange}
              onChange={setDateRange}
              placeholder={t("Todo o histórico")}
              className={cn(filterChipClass(!!dateRange?.from), 'w-auto justify-start [&_svg]:mr-0')}
            />
            <TeamMemberFilter className={cn(filterChipClass(!!selectedMemberId), 'w-auto gap-1 [&>svg:first-child]:mr-0')} />
            <MultiFilterPill icon={Layers} empty={t("Estado")} plural={t("estados")} width="w-52"
              options={PROPOSAL_STATUSES.map(status => ({ value: status, label: t(PROPOSAL_STATUS_LABELS[status]) }))}
              picked={statuses} onToggle={value => setStatuses(current => toggled(current, value as ProposalStatus))}
              onClear={() => setStatuses([])} clearLabel={t("Todos os estados")} />
            {isTelecom && <MultiFilterPill icon={Wrench} empty={t("Tipo")} plural={t("tipos")} width="w-48"
              options={(['energia', 'servicos'] as ProposalType[]).map(type => ({ value: type, label: t(PROPOSAL_TYPE_LABELS[type]) }))}
              picked={types} onToggle={value => setTypes(current => toggled(current, value as ProposalType))}
              onClear={() => setTypes([])} clearLabel={t("Todos os tipos")} />}
            {isTelecom && <MultiFilterPill icon={RadioTower} empty={t("Operadora")} plural={t("operadoras")} width="w-56"
              options={[...operators.map(operator => ({ value: operator.id, label: operator.name })), { value: NO_OPERATOR, label: t("Sem operadora") }]}
              picked={operatorIds} onToggle={value => setOperatorIds(current => toggled(current, value))}
              onClear={() => setOperatorIds([])} clearLabel={t("Todas as operadoras")} />}
          </FilterRow>

          {/* The figures that matter, in one compact row. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Figure label={t("Propostas")} value={String(filteredProposals.length)} />
            <Figure label={t("Valor total")} value={formatEuro(totalValue)} />
            <Figure label={t("Em aberto")} value={formatEuro(pendingValue)} tone="text-amber-600 dark:text-amber-400"
              hint={t(openProposals.length === 1 ? "{{n}} enviada ou em negociação" : "{{n}} enviadas ou em negociação", { n: openProposals.length })} onClick={() => setStatuses(OPEN_STATUSES)} />
            <Figure label={t("Aceites")} value={String(acceptedCount)} tone="text-emerald-600 dark:text-emerald-400" onClick={() => setStatuses(['accepted'])} />
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
            </div>
          ) : filteredProposals.length === 0 && filtering ? (
            <div className="flex h-56 flex-col items-center justify-center gap-3 text-muted-foreground">
              <Search className="h-10 w-10 opacity-50" />
              <p className="text-base font-medium">{t("Nenhuma proposta corresponde aos filtros")}</p>
              <Button variant="outline" size="sm" className="rounded-full" onClick={clearFilters}>{t("Limpar filtros")}</Button>
            </div>
          ) : filteredProposals.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={t("Ainda não tens propostas")}
              description={t("Cria a tua primeira proposta para enviares aos teus clientes.")}
            >
              <Button onClick={() => setCreateModalOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                {t("Criar primeira proposta")}
              </Button>
            </EmptyState>
          ) : (
            <ProposalsTable proposals={filteredProposals} isTelecom={isTelecom} onOpen={setSelectedProposal} onCreateSale={setSaleProposal} />
          )}
        </div>
      </div>

      <ImportProposalsDialog open={importOpen} onOpenChange={setImportOpen} />
      <CreateProposalModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        onSuccess={(proposal) => setSelectedProposal(proposal)}
      />

      {selectedProposal && (
        <ProposalDetailsModal
          proposal={selectedProposal}
          open={!!selectedProposal}
          onOpenChange={(open) => !open && setSelectedProposal(null)}
        />
      )}

      {/* "Criar venda" from the list — a fully prefilled sale (client, items,
          values, commission, energy/CPEs, notes) via the proposal object. */}
      {saleProposal && (
        <CreateSaleModal
          open={!!saleProposal}
          onOpenChange={(open) => !open && setSaleProposal(null)}
          prefillProposal={saleProposal}
          prefillClientId={saleProposal.client_id}
          prefillClient={saleProposal.client ? {
            id: saleProposal.client.id,
            name: saleProposal.client.name,
            email: saleProposal.client.email,
          } : null}
          onSaleCreated={(saleId) => {
            setSaleProposal(null);
            navigate(`/sales?sale=${saleId}`);
          }}
        />
      )}
    </>
  );
}
