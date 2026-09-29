import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { X } from "lucide-react";
import { useClientLabels } from "@/hooks/useClientLabels";
import type { ClientStatus, ClientSource } from "@/types/clients";
import type { DateRange } from "react-day-picker";
import type { ReactNode } from "react";

export interface ClientFiltersState {
  status: ClientStatus | 'all';
  source: ClientSource | 'all';
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  proposalType: 'all' | 'energia' | 'servicos';
}

interface ClientFiltersProps {
  filters: ClientFiltersState;
  onFiltersChange: (filters: ClientFiltersState) => void;
  onClearFilters: () => void;
  isTelecom?: boolean;
  search?: ReactNode;
}

export const defaultFilters: ClientFiltersState = {
  status: 'all',
  source: 'all',
  dateFrom: undefined,
  dateTo: undefined,
  proposalType: 'all',
};

export function ClientFilters({ filters, onFiltersChange, onClearFilters, isTelecom, search }: ClientFiltersProps) {
  const labels = useClientLabels();

  const hasActiveFilters = 
    filters.status !== 'all' || 
    filters.source !== 'all' || 
    filters.dateFrom !== undefined || 
    filters.dateTo !== undefined ||
    filters.proposalType !== 'all';

  const statusOptions: { value: ClientStatus | 'all'; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'active', label: labels.active },
    { value: 'vip', label: labels.vip },
    { value: 'inactive', label: labels.inactive },
  ];

  const sourceOptions: { value: ClientSource | 'all'; label: string }[] = [
    { value: 'all', label: 'Todas' },
    { value: 'lead', label: 'Lead Convertido' },
    { value: 'referral', label: 'Indicação' },
    { value: 'direct', label: 'Contacto Direto' },
    { value: 'website', label: 'Website' },
    { value: 'other', label: 'Outro' },
  ];

  const dateRange: DateRange | undefined = (filters.dateFrom || filters.dateTo)
    ? { from: filters.dateFrom, to: filters.dateTo }
    : undefined;

  const handleDateChange = (range: DateRange | undefined) => {
    onFiltersChange({ ...filters, dateFrom: range?.from, dateTo: range?.to });
  };

  return (
    <div className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${isTelecom
      ? 'lg:grid-cols-[minmax(220px,1.8fr)_130px_150px_160px_minmax(190px,1.2fr)_auto]'
      : 'lg:grid-cols-[minmax(260px,2fr)_130px_150px_minmax(190px,1.2fr)_auto]'} items-center`}>
      {search}
      
      {/* Status Filter */}
      <Select
        value={filters.status}
        onValueChange={(value) => onFiltersChange({ ...filters, status: value as ClientStatus | 'all' })}
      >
        <SelectTrigger className="w-full h-9">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Source Filter */}
      <Select
        value={filters.source}
        onValueChange={(value) => onFiltersChange({ ...filters, source: value as ClientSource | 'all' })}
      >
        <SelectTrigger className="w-full h-9">
          <SelectValue placeholder="Origem" />
        </SelectTrigger>
        <SelectContent>
          {sourceOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Proposal Type Filter (Telecom only) */}
      {isTelecom && (
        <Select
          value={filters.proposalType}
          onValueChange={(value) => onFiltersChange({ ...filters, proposalType: value as 'all' | 'energia' | 'servicos' })}
        >
          <SelectTrigger className="w-full h-9">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="energia">Energia</SelectItem>
            <SelectItem value="servicos">Outros Serviços</SelectItem>
          </SelectContent>
        </Select>
      )}

      {/* Date Range Filter */}
      <DateRangePicker
        value={dateRange}
        onChange={handleDateChange}
        placeholder="Período"
        className="h-9 w-full"
      />

      {/* Clear Filters */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearFilters}
          className="h-9 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4 mr-1" />
          Limpar
        </Button>
      )}
    </div>
  );
}
