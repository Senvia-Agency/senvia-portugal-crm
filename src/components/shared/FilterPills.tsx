import type { ReactNode } from "react";
import { ChevronDown, Search, X, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { filterChipClass, pickedLabel } from "./filter-pills";
import { useLanguage } from "@/i18n";

export interface PillOption {
  readonly value: string;
  readonly label: string;
  readonly count?: number;
  /** A colour dot before the label (pipeline stages). */
  readonly color?: string;
}

/** One filter where several values can be ticked; the menu stays open while ticking. */
export function MultiFilterPill({ icon: Icon, empty, plural, options, picked, onToggle, onClear, clearLabel, width = "w-56" }: {
  icon: LucideIcon;
  /** Shown while nothing is picked, e.g. "Origem". */
  empty: string;
  /** "origens", for "3 origens". */
  plural: string;
  options: readonly PillOption[];
  picked: readonly string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  clearLabel: string;
  width?: string;
}) {
  const nameOf = (value: string) => options.find(option => option.value === value)?.label ?? value;
  return <DropdownMenu>
    <DropdownMenuTrigger className={filterChipClass(picked.length > 0)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="max-w-[10rem] truncate">{pickedLabel(picked, empty, plural, nameOf)}</span>
      <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className={`max-h-80 overflow-y-auto ${width}`}>
      {options.map(option => <DropdownMenuCheckboxItem key={option.value} checked={picked.includes(option.value)}
        onCheckedChange={() => onToggle(option.value)} onSelect={event => event.preventDefault()}>
        {option.color && <span className="mr-2 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: option.color }} aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        {option.count !== undefined && <span className="ml-2 text-xs text-muted-foreground">{option.count}</span>}
      </DropdownMenuCheckboxItem>)}
      {picked.length > 0 && <>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={false} onCheckedChange={onClear}>{clearLabel}</DropdownMenuCheckboxItem>
      </>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

/**
 * The row that narrows a list: the search first, then the pills, as in Gmail.
 * Wide pages keep it on one line; narrow ones put the pills under the search, scrolling sideways.
 */
export function FilterRow({ search, onSearch, placeholder, hasActive, onClear, children }: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  hasActive: boolean;
  onClear: () => void;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  return <div className="crm-find">
    <div className="crm-search relative min-w-0">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" aria-hidden="true" />
      <Input type="search" aria-label={placeholder} placeholder={placeholder} value={search} onChange={event => onSearch(event.target.value)}
        className="h-9 w-full rounded-full border-border bg-card pl-10 text-[13px] shadow-sm md:text-[13px]" />
    </div>
    <div className="crm-filters -mx-1 flex min-w-0 items-center gap-2 overflow-x-auto px-1 py-1" role="toolbar" aria-label={t("Filtros")}>
      {children}
      {hasActive && <button type="button" onClick={onClear}
        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-primary hover:bg-primary/5">
        <X className="h-3.5 w-3.5" aria-hidden="true" />{t("Limpar")}
      </button>}
    </div>
  </div>;
}
