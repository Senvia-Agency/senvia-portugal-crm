import { ChevronDown, Globe, Layers, Thermometer, Zap } from 'lucide-react';
import { TeamMemberFilter } from '@/components/dashboard/TeamMemberFilter';
import { FilterRow, MultiFilterPill } from '@/components/shared/FilterPills';
import { filterChipClass } from '@/components/shared/filter-pills';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { PipelineStage } from '@/hooks/usePipelineStages';
import { useTeamFilter } from '@/hooks/useTeamFilter';
import { cn } from '@/lib/utils';
import { TEMPERATURE_LABELS, TIPOLOGIA_LABELS, type LeadTemperature, type LeadTipologia } from '@/types';
import { useLanguage } from '@/i18n';

/** Several values of one filter can be ticked. */
interface MultiFilter<T extends string> {
  readonly picked: readonly T[];
  readonly onToggle: (value: T) => void;
  readonly onClear: () => void;
}

interface LeadsFilterBarProps {
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly dateRange: { from?: Date; to?: Date };
  readonly onDateRange: (range: { from?: Date; to?: Date }) => void;
  readonly temperatures: MultiFilter<LeadTemperature>;
  readonly sources: MultiFilter<string> & { readonly options: readonly { value: string; count: number }[] };
  readonly statuses: MultiFilter<string> & { readonly stages: readonly PipelineStage[] };
  /** Telecom with the energy module: the "Tipologia" filter. */
  readonly tipologia?: { value: 'all' | LeadTipologia; onChange: (value: 'all' | LeadTipologia) => void };
  readonly hasActive: boolean;
  readonly onClear: () => void;
}

/** Everything that narrows the leads, in one row above the board: the search, then the filter pills. */
export function LeadsFilterBar(props: LeadsFilterBarProps) {
  const { selectedMemberId } = useTeamFilter();
  const { t } = useLanguage();
  const { temperatures, sources, statuses } = props;
  return <FilterRow search={props.search} onSearch={props.onSearch} placeholder={t("Pesquisar nome, email ou telefone")} hasActive={props.hasActive} onClear={props.onClear}>
    <DateRangePicker
      value={props.dateRange.from ? { from: props.dateRange.from, to: props.dateRange.to } : undefined}
      onChange={range => props.onDateRange({ from: range?.from, to: range?.to })}
      placeholder={t("Todo o histórico")}
      className={cn(filterChipClass(!!props.dateRange.from), 'w-auto justify-start [&_svg]:mr-0')}
    />
    <TeamMemberFilter className={cn(filterChipClass(!!selectedMemberId), 'w-auto gap-1 [&>svg:first-child]:mr-0')} />
    <MultiFilterPill icon={Thermometer} empty={t("Temperatura")} plural={t("temperaturas")} width="w-44"
      options={(Object.keys(TEMPERATURE_LABELS) as LeadTemperature[]).map(key => ({ value: key, label: t(TEMPERATURE_LABELS[key]) }))}
      picked={temperatures.picked} onToggle={value => temperatures.onToggle(value as LeadTemperature)} onClear={temperatures.onClear} clearLabel={t("Todas as temperaturas")} />
    {sources.options.length > 0 && <MultiFilterPill icon={Globe} empty={t("Origem")} plural={t("origens")} width="w-60"
      options={sources.options.map(source => ({ value: source.value, label: source.value, count: source.count }))}
      picked={sources.picked} onToggle={sources.onToggle} onClear={sources.onClear} clearLabel={t("Todas as origens")} />}
    <MultiFilterPill icon={Layers} empty={t("Estado")} plural={t("estados")} width="w-52"
      options={statuses.stages.map(stage => ({ value: stage.key, label: stage.name, color: stage.color }))}
      picked={statuses.picked} onToggle={statuses.onToggle} onClear={statuses.onClear} clearLabel={t("Todos os estados")} />
    {props.tipologia && <DropdownMenu>
      <DropdownMenuTrigger className={filterChipClass(props.tipologia.value !== 'all')}>
        <Zap className="h-3.5 w-3.5" aria-hidden="true" />
        {props.tipologia.value === 'all' ? t('Tipologia') : t(TIPOLOGIA_LABELS[props.tipologia.value])}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup value={props.tipologia.value} onValueChange={value => props.tipologia?.onChange(value as 'all' | LeadTipologia)}>
          <DropdownMenuRadioItem value="all">{t("Todas")}</DropdownMenuRadioItem>
          {(Object.entries(TIPOLOGIA_LABELS) as [LeadTipologia, string][]).map(([key, label]) => <DropdownMenuRadioItem key={key} value={key}>{t(label)}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>}
  </FilterRow>;
}
