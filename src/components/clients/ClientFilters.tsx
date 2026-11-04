import { Globe, Layers, Zap } from "lucide-react";
import { TeamMemberFilter } from "@/components/dashboard/TeamMemberFilter";
import { FilterRow, MultiFilterPill } from "@/components/shared/FilterPills";
import { filterChipClass, toggled } from "@/components/shared/filter-pills";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { useClientLabels } from "@/hooks/useClientLabels";
import { useTeamFilter } from "@/hooks/useTeamFilter";
import { cn } from "@/lib/utils";
import { CLIENT_SOURCE_LABELS, type ClientStatus } from "@/types/clients";
import type { ClientFiltersState, ProposalTypeFilter } from "./client-filters";
import { useLanguage } from "@/i18n";

interface ClientFiltersProps {
  filters: ClientFiltersState;
  onFiltersChange: (filters: ClientFiltersState) => void;
  search: string;
  onSearch: (value: string) => void;
  /** The sources these clients have, most used first. */
  sourceCounts: readonly { value: string; count: number }[];
  /** Telecom with the energy module: filter by the kind of proposal. */
  isTelecom?: boolean;
  hasActive: boolean;
  onClear: () => void;
}

/** The search and filter pills of the clients page (same row as the leads). */
export function ClientFilters({ filters, onFiltersChange, search, onSearch, sourceCounts, isTelecom, hasActive, onClear }: ClientFiltersProps) {
  const { t } = useLanguage();
  const labels = useClientLabels();
  const { selectedMemberId } = useTeamFilter();
  const set = (patch: Partial<ClientFiltersState>) => onFiltersChange({ ...filters, ...patch });
  return <FilterRow search={search} onSearch={onSearch} placeholder={t("Pesquisar nome, email, telefone, empresa ou NIF")}
    hasActive={hasActive} onClear={onClear}>
    <DateRangePicker
      value={filters.dateFrom || filters.dateTo ? { from: filters.dateFrom, to: filters.dateTo } : undefined}
      onChange={range => set({ dateFrom: range?.from, dateTo: range?.to })}
      placeholder={t("Todo o histórico")}
      className={cn(filterChipClass(!!filters.dateFrom), "w-auto justify-start [&_svg]:mr-0")}
    />
    <TeamMemberFilter className={cn(filterChipClass(!!selectedMemberId), "w-auto gap-1 [&>svg:first-child]:mr-0")} />
    <MultiFilterPill icon={Layers} empty={t(labels.statusFieldLabel)} plural={t("estados")} width="w-48"
      options={[{ value: "active", label: t(labels.statusActive) }, { value: "inactive", label: t(labels.statusInactive) }]}
      picked={filters.statuses} onToggle={value => set({ statuses: toggled(filters.statuses, value as ClientStatus) })}
      onClear={() => set({ statuses: [] })} clearLabel={t("Todos os estados")} />
    {sourceCounts.length > 0 && <MultiFilterPill icon={Globe} empty={t("Origem")} plural={t("origens")} width="w-56"
      options={sourceCounts.map(source => ({ value: source.value, label: CLIENT_SOURCE_LABELS[source.value] ? t(CLIENT_SOURCE_LABELS[source.value]) : source.value, count: source.count }))}
      picked={filters.sources} onToggle={value => set({ sources: toggled(filters.sources, value) })}
      onClear={() => set({ sources: [] })} clearLabel={t("Todas as origens")} />}
    {isTelecom && <MultiFilterPill icon={Zap} empty={t("Tipo")} plural={t("tipos")} width="w-48"
      options={[{ value: "energia", label: t("Energia") }, { value: "servicos", label: t("Outros serviços") }]}
      picked={filters.proposalTypes} onToggle={value => set({ proposalTypes: toggled(filters.proposalTypes, value as ProposalTypeFilter) })}
      onClear={() => set({ proposalTypes: [] })} clearLabel={t("Todos os tipos")} />}
  </FilterRow>;
}
