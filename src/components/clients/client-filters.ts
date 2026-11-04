import type { ClientStatus } from "@/types/clients";

export type ProposalTypeFilter = "energia" | "servicos";

/** Several values per filter can be ticked; an empty list means "all". */
export interface ClientFiltersState {
  statuses: ClientStatus[];
  sources: string[];
  proposalTypes: ProposalTypeFilter[];
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
}

export const defaultFilters: ClientFiltersState = {
  statuses: [],
  sources: [],
  proposalTypes: [],
  dateFrom: undefined,
  dateTo: undefined,
};

export const hasClientFilters = (filters: ClientFiltersState) =>
  filters.statuses.length > 0 || filters.sources.length > 0 || filters.proposalTypes.length > 0 || !!filters.dateFrom || !!filters.dateTo;
