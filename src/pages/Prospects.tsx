import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useProspects, useProspectSalespeople } from "@/hooks/useProspects";
import { useModules } from "@/hooks/useModules";
import { usePersistedState } from "@/hooks/usePersistedState";
import { mapProspectsForExport, exportToCsv, exportToExcel } from "@/lib/export";
import { getProspectCom, getProspectSegment } from "@/lib/prospects/segment";
import { cn, matchesSearch } from "@/lib/utils";
import { isPerfect2GetherOrg } from "@/lib/perfect2gether";
import { ImportProspectsDialog } from "@/components/prospects/ImportProspectsDialog";
import { DistributeProspectsDialog } from "@/components/prospects/DistributeProspectsDialog";
import { GenerateProspectsDialog } from "@/components/prospects/GenerateProspectsDialog";
import { ProspectDetailsModal } from "@/components/prospects/ProspectDetailsModal";
import { FilterRow, MultiFilterPill } from "@/components/shared/FilterPills";
import { filterChipClass, toggled } from "@/components/shared/filter-pills";
import { PageModuleIcon } from "@/components/layout/ModuleNavIcon";
import { PageHeader } from "@/components/layout/PageHeader";
import { initialsOf } from "@/components/leads/lead-display";
import {
  ChevronDown, CircleDot, Download, Facebook, Globe, Instagram, Building2, Search, Sparkles,
  Twitter, Upload, UserRound, Users, X, Youtube,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useLanguage, intlLocale } from "@/i18n";

const formatConsumption = (value: number | null) => {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 0 }).format(value);
};

const isProspectEligibleForDistribution = (prospect: { assigned_to: string | null; converted_to_lead: boolean }) =>
  !prospect.assigned_to && !prospect.converted_to_lead;

type ProspectState = "open" | "assigned" | "converted";
const stateOf = (prospect: { assigned_to: string | null; converted_to_lead: boolean }): ProspectState =>
  prospect.converted_to_lead ? "converted" : prospect.assigned_to ? "assigned" : "open";
const STATE_LABELS: Record<ProspectState, string> = { open: "Por distribuir", assigned: "Atribuído", converted: "Convertido" };
const STATE_PILLS: Record<ProspectState, string> = {
  open: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  assigned: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  converted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

const socialIcons = [
  { key: "facebook", icon: Facebook, label: "Facebook" },
  { key: "instagram", icon: Instagram, label: "Instagram" },
  { key: "twitter", icon: Twitter, label: "X/Twitter" },
  { key: "youtube", icon: Youtube, label: "YouTube" },
  { key: "tiktok", icon: Globe, label: "TikTok" },
] as const;

const SocialMediaLinks = ({ metadata }: { metadata: Record<string, unknown> | null }) => {
  const links = metadata ? socialIcons.filter(({ key }) => metadata[key]) : [];
  if (links.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-1.5">
      {links.map(({ key, icon: Icon, label }) => (
        <a key={key} href={metadata![key] as string} target="_blank" rel="noopener noreferrer" title={label}
          onClick={(event) => event.stopPropagation()} className="text-muted-foreground transition-colors hover:text-primary">
          <Icon className="h-3.5 w-3.5" />
        </a>
      ))}
    </div>
  );
};

/** One figure of the summary line under the filters. */
function Figure({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card px-4 py-2.5 shadow-sm">
      <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("truncate text-lg font-semibold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

export default function Prospects() {
  const { t } = useLanguage();
  const { organization } = useAuth();
  const { modules } = useModules();
  const { data: prospects = [], isLoading } = useProspects();
  const { data: salespeople = [], isLoading: salespeopleLoading } = useProspectSalespeople();
  const [searchQuery, setSearchQuery] = useState("");
  const [salespersonFilter, setSalespersonFilter] = usePersistedState("prospects-salesperson-v2", "all");
  const [stateFilter, setStateFilter] = usePersistedState<ProspectState[]>("prospects-state-v1", []);
  const [comFilter, setComFilter] = usePersistedState<string[]>("prospects-com-v2", []);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openProspectId, setOpenProspectId] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [isDistributeOpen, setIsDistributeOpen] = useState(false);
  const isP2G = isPerfect2GetherOrg(organization?.id);
  const salespersonMap = useMemo(
    () => new Map(salespeople.map((salesperson) => [salesperson.user_id, salesperson.full_name])),
    [salespeople]
  );
  const comOptions = useMemo(() => {
    const values = Array.from(new Set(prospects.map((prospect) => getProspectCom(prospect)).filter((value): value is string => Boolean(value))));
    return values.sort((a, b) => a.localeCompare(b, "pt-PT"));
  }, [prospects]);

  const filteredProspects = useMemo(() => prospects.filter((prospect) => {
    const matchesSearchTerm = matchesSearch(searchQuery, prospect.company_name, prospect.nif, prospect.cpe, prospect.email, prospect.phone);
    const matchesSalesperson =
      salespersonFilter === "all" ||
      (salespersonFilter === "unassigned" && !prospect.assigned_to) ||
      prospect.assigned_to === salespersonFilter;
    const matchesState = stateFilter.length === 0 || stateFilter.includes(stateOf(prospect));
    const prospectCom = getProspectCom(prospect);
    const matchesCom = comFilter.length === 0 || (!!prospectCom && comFilter.includes(prospectCom));
    return matchesSearchTerm && matchesSalesperson && matchesState && matchesCom;
  }), [comFilter, prospects, salespersonFilter, searchQuery, stateFilter]);

  const eligibleFilteredIds = useMemo(
    () => filteredProspects.filter(isProspectEligibleForDistribution).map((prospect) => prospect.id),
    [filteredProspects]
  );
  const selectedEligibleIds = useMemo(
    () => selectedIds.filter((id) => eligibleFilteredIds.includes(id)),
    [eligibleFilteredIds, selectedIds]
  );
  const allEligibleFilteredSelected = eligibleFilteredIds.length > 0 && selectedEligibleIds.length === eligibleFilteredIds.length;

  useEffect(() => {
    setSelectedIds([]);
  }, [searchQuery, salespersonFilter, stateFilter, comFilter]);

  const totals = useMemo(() => ({
    total: prospects.length,
    open: prospects.filter((prospect) => stateOf(prospect) === "open").length,
    assigned: prospects.filter((prospect) => stateOf(prospect) === "assigned").length,
    converted: prospects.filter((prospect) => stateOf(prospect) === "converted").length,
  }), [prospects]);

  const handleToggleProspect = (prospectId: string, checked: boolean) => {
    setSelectedIds((current) => checked
      ? (current.includes(prospectId) ? current : [...current, prospectId])
      : current.filter((id) => id !== prospectId));
  };
  const handleToggleAllEligible = (checked: boolean) => {
    setSelectedIds((current) => checked
      ? Array.from(new Set([...current, ...eligibleFilteredIds]))
      : current.filter((id) => !eligibleFilteredIds.includes(id)));
  };

  const handleExportCsv = () => {
    exportToCsv(mapProspectsForExport(filteredProspects, salespersonMap), `prospects_${format(new Date(), "yyyy-MM-dd")}`);
    toast.success(t("{{n}} prospects exportados para CSV", { n: filteredProspects.length }));
  };
  const handleExportExcel = () => {
    exportToExcel(mapProspectsForExport(filteredProspects, salespersonMap), `prospects_${format(new Date(), "yyyy-MM-dd")}`);
    toast.success(t("{{n}} prospects exportados para Excel", { n: filteredProspects.length }));
  };

  const filtering = searchQuery.trim() !== "" || salespersonFilter !== "all" || stateFilter.length > 0 || comFilter.length > 0;
  const clearFilters = () => { setSearchQuery(""); setSalespersonFilter("all"); setStateFilter([]); setComFilter([]); };
  const salespersonLabel = salespersonFilter === "all" ? t("Comercial")
    : salespersonFilter === "unassigned" ? t("Não atribuídos")
    : salespersonMap.get(salespersonFilter) || t("Comercial");

  if (!modules.prospects) {
    return (
      <div className="space-y-6 p-4 pb-24 md:p-6 md:pb-6">
        <PageHeader icon={Search} title="Prospects" subtitle={t("Ative o módulo Prospects nas Definições → Módulos para utilizar esta funcionalidade.")} />
      </div>
    );
  }

  return (
    <div className="crm-page">
      <div className="space-y-4 p-4 pb-24 sm:p-6 lg:px-8 lg:py-7">
        {/* One line: title and count, Exportar, and the one main action. */}
        <header className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <PageModuleIcon to="/prospects" />
          <div className="flex items-baseline gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Prospects</h1>
            <span className="text-sm tabular-nums text-muted-foreground">{filtering ? t("{{n}} de {{total}}", { n: filteredProspects.length, total: totals.total }) : totals.total}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-9 rounded-full px-3" aria-label={t("Exportar prospects")}>
                  <Download className="h-4 w-4" /><span className="hidden sm:inline">{t("Exportar")}</span><ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem disabled={filteredProspects.length === 0} onClick={handleExportExcel}><Download className="mr-2 h-4 w-4" />{t("Exportar Excel")}</DropdownMenuItem>
                <DropdownMenuItem disabled={filteredProspects.length === 0} onClick={handleExportCsv}><Download className="mr-2 h-4 w-4" />{t("Exportar CSV")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {isP2G ? (
              <Button className="h-9 rounded-full" onClick={() => setIsImportOpen(true)}><Upload className="mr-1.5 h-4 w-4" />{t("Importar")}</Button>
            ) : (
              <Button className="h-9 rounded-full" onClick={() => setIsGenerateOpen(true)}><Sparkles className="mr-1.5 h-4 w-4" />{t("Gerar prospects")}</Button>
            )}
          </div>
        </header>

        <FilterRow search={searchQuery} onSearch={setSearchQuery}
          placeholder={isP2G ? t("Pesquisar empresa, NIF, CPE, email ou telefone") : t("Pesquisar empresa, email ou telefone")}
          hasActive={filtering} onClear={clearFilters}>
          <DropdownMenu>
            <DropdownMenuTrigger className={filterChipClass(salespersonFilter !== "all")}>
              <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="max-w-[10rem] truncate">{salespersonLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
              <DropdownMenuRadioGroup value={salespersonFilter} onValueChange={setSalespersonFilter}>
                <DropdownMenuRadioItem value="all">{t("Todos os comerciais")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="unassigned">{t("Não atribuídos")}</DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                {salespeople.map((salesperson) => (
                  <DropdownMenuRadioItem key={salesperson.user_id} value={salesperson.user_id}>{salesperson.full_name}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <MultiFilterPill icon={CircleDot} empty={t("Estado")} plural={t("estados")} width="w-48"
            options={(Object.keys(STATE_LABELS) as ProspectState[]).map((state) => ({ value: state, label: t(STATE_LABELS[state]), count: totals[state] }))}
            picked={stateFilter} onToggle={(value) => setStateFilter(toggled(stateFilter, value as ProspectState))}
            onClear={() => setStateFilter([])} clearLabel={t("Todos os estados")} />
          {isP2G && comOptions.length > 0 && (
            <MultiFilterPill icon={Building2} empty="COM" plural="COM"
              options={comOptions.map((com) => ({ value: com, label: com }))}
              picked={comFilter} onToggle={(value) => setComFilter(toggled(comFilter, value))}
              onClear={() => setComFilter([])} clearLabel={t("Todos os COM")} />
          )}
        </FilterRow>

        {/* The figures that matter, in one compact row. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Figure label={t("Total")} value={totals.total} />
          <Figure label={t("Por distribuir")} value={totals.open} tone="text-amber-600 dark:text-amber-400" />
          <Figure label={t("Atribuídos")} value={totals.assigned} tone="text-blue-600 dark:text-blue-400" />
          <Figure label={t("Convertidos em lead")} value={totals.converted} tone="text-emerald-600 dark:text-emerald-400" />
        </div>

        {/* Ticking prospects brings up the one thing to do with them. */}
        {selectedEligibleIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-2.5">
            <span className="text-sm font-medium">{t(selectedEligibleIds.length === 1 ? "{{n}} prospect selecionado" : "{{n}} prospects selecionados", { n: selectedEligibleIds.length })}</span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-8 rounded-full" onClick={() => setSelectedIds([])}><X className="mr-1 h-3.5 w-3.5" />{t("Limpar")}</Button>
              <Button size="sm" className="h-8 rounded-full" disabled={salespeople.length === 0} onClick={() => setIsDistributeOpen(true)}>
                <Users className="mr-1.5 h-3.5 w-3.5" />{t("Distribuir pelos comerciais")}
              </Button>
            </div>
          </div>
        )}

        {isLoading || salespeopleLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : filteredProspects.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center">
            <Search className="h-8 w-8 text-primary/60" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {filtering ? t("Nenhum prospect com estes filtros.") : isP2G ? t("Ainda não há prospects. Importe uma lista para começar.") : t("Ainda não há prospects. Gere a primeira lista para começar.")}
            </p>
            {filtering
              ? <Button variant="outline" className="rounded-full" onClick={clearFilters}>{t("Limpar filtros")}</Button>
              : <Button className="rounded-full" onClick={() => (isP2G ? setIsImportOpen(true) : setIsGenerateOpen(true))}>
                  {isP2G ? <><Upload className="mr-1.5 h-4 w-4" />{t("Importar")}</> : <><Sparkles className="mr-1.5 h-4 w-4" />{t("Gerar prospects")}</>}
                </Button>}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
            <div className="overflow-x-auto">
              <Table className="[&_td]:py-2 [&_th]:h-10 [&_th]:whitespace-nowrap">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10">
                      <Checkbox checked={allEligibleFilteredSelected} disabled={eligibleFilteredIds.length === 0}
                        onCheckedChange={(checked) => handleToggleAllEligible(checked === true)}
                        aria-label={t("Selecionar todos os prospects por distribuir")} />
                    </TableHead>
                    <TableHead>{t("Empresa")}</TableHead>
                    {isP2G && <TableHead className="hidden lg:table-cell">CPE</TableHead>}
                    <TableHead className="hidden md:table-cell">{t("Contacto")}</TableHead>
                    {isP2G
                      ? <TableHead className="hidden xl:table-cell text-right">{t("kWh/ano")}</TableHead>
                      : <TableHead className="hidden xl:table-cell">Online</TableHead>}
                    <TableHead className="hidden sm:table-cell">{t("Comercial")}</TableHead>
                    <TableHead>{t("Estado")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProspects.map((prospect) => {
                    const isEligible = isProspectEligibleForDistribution(prospect);
                    const isSelected = selectedIds.includes(prospect.id);
                    const state = stateOf(prospect);
                    const metadata = prospect.metadata as Record<string, unknown> | null;
                    const website = typeof metadata?.website === "string" ? metadata.website : null;
                    const address = typeof metadata?.address === "string" ? metadata.address : null;
                    const segment = isP2G ? getProspectSegment(prospect) : prospect.segment;
                    const com = isP2G ? getProspectCom(prospect) : null;
                    const salesperson = prospect.assigned_to ? salespersonMap.get(prospect.assigned_to) : null;
                    return (
                      <TableRow key={prospect.id} data-state={isSelected ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() => setOpenProspectId(prospect.id)}>
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <Checkbox checked={isSelected} disabled={!isEligible}
                            onCheckedChange={(checked) => handleToggleProspect(prospect.id, checked === true)}
                            aria-label={t("Selecionar prospect {{name}}", { name: prospect.company_name })} />
                        </TableCell>
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary" aria-hidden="true">
                              {initialsOf(prospect.company_name || "?")}
                            </span>
                            <div className="min-w-0">
                              <p className="max-w-[18rem] truncate font-medium">{prospect.company_name}</p>
                              <p className="max-w-[18rem] truncate text-xs text-muted-foreground">
                                {[isP2G ? prospect.nif : null, segment, com, !isP2G ? address : null].filter(Boolean).join(" · ") || "—"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        {isP2G && <TableCell className="hidden max-w-[14rem] truncate font-mono text-xs lg:table-cell">{prospect.cpe || "—"}</TableCell>}
                        <TableCell className="hidden md:table-cell">
                          <p className="max-w-[14rem] truncate text-sm">{prospect.phone || "—"}</p>
                          {prospect.email && <p className="max-w-[14rem] truncate text-xs text-muted-foreground">{prospect.email}</p>}
                        </TableCell>
                        {isP2G ? (
                          <TableCell className="hidden whitespace-nowrap text-right tabular-nums xl:table-cell">{formatConsumption(prospect.annual_consumption_kwh)}</TableCell>
                        ) : (
                          <TableCell className="hidden xl:table-cell" onClick={(event) => event.stopPropagation()}>
                            {website && (
                              <a href={website.startsWith("http") ? website : `https://${website}`} target="_blank" rel="noopener noreferrer"
                                className="block max-w-[12rem] truncate text-xs text-primary hover:underline">
                                {website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                              </a>
                            )}
                            <div className={cn(website && "mt-1")}><SocialMediaLinks metadata={metadata} /></div>
                          </TableCell>
                        )}
                        <TableCell className="hidden whitespace-nowrap text-sm sm:table-cell">
                          {salesperson || <span className="text-muted-foreground">{t("Não atribuído")}</span>}
                        </TableCell>
                        <TableCell>
                          <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", STATE_PILLS[state])}>{t(STATE_LABELS[state])}</span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      {/* Clicking a line opens its record; the checkbox picks it for distribution. */}
      {(() => {
        const open = openProspectId ? prospects.find((prospect) => prospect.id === openProspectId) ?? null : null;
        const state = open ? stateOf(open) : null;
        return (
          <ProspectDetailsModal
            prospect={open}
            onOpenChange={(next) => { if (!next) setOpenProspectId(null); }}
            stateLabel={state ? t(STATE_LABELS[state]) : ''}
            statePill={state ? STATE_PILLS[state] : ''}
            salesperson={open?.assigned_to ? salespersonMap.get(open.assigned_to) ?? null : null}
            isEnergy={isP2G}
          />
        );
      })()}
      {isP2G && <ImportProspectsDialog open={isImportOpen} onOpenChange={setIsImportOpen} />}
      {!isP2G && organization?.id && (
        <GenerateProspectsDialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen} organizationId={organization.id} />
      )}
      <DistributeProspectsDialog
        open={isDistributeOpen}
        onOpenChange={setIsDistributeOpen}
        selectedCount={selectedEligibleIds.length}
        selectedIds={selectedEligibleIds}
        salespeople={salespeople}
        onDistributed={() => setSelectedIds([])}
      />
    </div>
  );
}
