import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePersistedState } from "@/hooks/usePersistedState";

import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useProposals, useUpdateProposal } from '@/hooks/useProposals';
import { useProposalsRealtime } from '@/hooks/useRealtimeSubscription';
import { TeamMemberFilter } from '@/components/dashboard/TeamMemberFilter';
import { PinnedPageBar } from '@/components/layout/PinnedPageBar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { FileText, Search, Filter, Plus, Zap, Wrench } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/layout/PageHeader';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import type { DateRange } from 'react-day-picker';
import { ProposalDetailsModal } from '@/components/proposals/ProposalDetailsModal';
import { CreateProposalModal } from '@/components/proposals/CreateProposalModal';
import { CreateSaleModal } from '@/components/sales/CreateSaleModal';
import { 
  PROPOSAL_STATUS_LABELS, 
  PROPOSAL_STATUS_COLORS, 
  PROPOSAL_STATUSES,
  PROPOSAL_TYPE_LABELS,
} from '@/types/proposals';
import type { Proposal, ProposalStatus, ProposalType } from '@/types/proposals';
import { cn, matchesSearch } from '@/lib/utils';
import { format } from 'date-fns';
import { useTelecomProposalMetrics } from '@/hooks/useTelecomProposalMetrics';
import { useOperators } from '@/hooks/useOperators';
import { pt } from 'date-fns/locale';

export default function Proposals() {
  // Subscribe to realtime updates
  useProposalsRealtime();
  const { profile, organization } = useAuth();
  const { data: proposals = [], isLoading } = useProposals();
  const isTelecom = organization?.niche === 'telecom';
  const isGenericNiche = !organization?.niche || organization.niche === 'generic';
  const { data: telecomMetrics } = useTelecomProposalMetrics();
  const { data: operators = [] } = useOperators();
  
  const [search, setSearch] = usePersistedState('proposals-search-v1', '');
  const [excludedStatuses, setExcludedStatuses] = usePersistedState<ProposalStatus[]>('proposals-status-excluded-v1', []);
  const [excludedTypes, setExcludedTypes] = usePersistedState<ProposalType[]>('proposals-type-excluded-v1', []);
  const [excludedOperators, setExcludedOperators] = usePersistedState<string[]>('proposals-operators-v1', []);
  const [dateRange, setDateRange] = usePersistedState<DateRange | undefined>('proposals-date-range-v1', undefined);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  // "Criar Venda" from the list: open a fully prefilled sale for this proposal.
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

  const filteredProposals = proposals.filter((proposal) => {
    // Hide proposals that already have a sale created (telecom)
    if (isTelecom && (proposal as any).has_sale) return false;
    
    const matchesSearchTerm = matchesSearch(
      search,
      proposal.client?.name,
      proposal.lead?.name,
      proposal.code,
      proposal.notes,
    );
    const matchesStatus = !excludedStatuses.includes(proposal.status);
    const matchesType = !isTelecom || (!!proposal.proposal_type && !excludedTypes.includes(proposal.proposal_type));
    const operatorKeys = Object.values(proposal.servicos_details ?? {}).map((detail: any) => detail?.operator_id || '__none__');
    if (operatorKeys.length === 0) operatorKeys.push('__none__');
    const matchesOperator = excludedOperators.length === 0 || operatorKeys.some((key) => !excludedOperators.includes(key));
    const proposalDate = new Date(proposal.proposal_date);
    const matchesDate = !dateRange?.from || (
      proposalDate >= dateRange.from &&
      (!dateRange.to || proposalDate <= dateRange.to)
    );
    return matchesSearchTerm && matchesStatus && matchesType && matchesDate && matchesOperator;
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
  };

  // Group proposals by status for summary (use filtered)
  const proposalsByStatus = PROPOSAL_STATUSES.reduce((acc, status) => {
    acc[status] = filteredProposals.filter(p => p.status === status);
    return acc;
  }, {} as Record<ProposalStatus, Proposal[]>);

  const totalValue = filteredProposals.reduce((sum, p) => sum + Number(p.total_value), 0);
  const pendingValue = filteredProposals
    .filter(p => ['sent', 'negotiating'].includes(p.status))
    .reduce((sum, p) => sum + Number(p.total_value), 0);

  const filterControls = (
    <div className="space-y-3">
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Período</span>
        <DateRangePicker
          value={dateRange}
          onChange={setDateRange}
          placeholder="Todo o histórico"
          className="w-full"
        />
      </div>
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Vendedor</span>
        <TeamMemberFilter className="w-full bg-card/50 border-border/50" />
      </div>
      {isTelecom && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Operadoras</span>
          <div className="flex flex-wrap gap-1">
            {[...operators.map((operator) => ({ key: operator.id, label: operator.name })), { key: '__none__', label: 'Sem operadora' }].map((operator, index) => {
              const active = !excludedOperators.includes(operator.key);
              const tones = [
                'border-violet-500/40 bg-violet-500/15 text-violet-600 data-[state=on]:bg-violet-500/15 data-[state=on]:text-violet-600',
                'border-sky-500/40 bg-sky-500/15 text-sky-600 data-[state=on]:bg-sky-500/15 data-[state=on]:text-sky-600',
                'border-teal-500/40 bg-teal-500/15 text-teal-600 data-[state=on]:bg-teal-500/15 data-[state=on]:text-teal-600',
                'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-600 data-[state=on]:bg-fuchsia-500/15 data-[state=on]:text-fuchsia-600',
                'border-orange-500/40 bg-orange-500/15 text-orange-600 data-[state=on]:bg-orange-500/15 data-[state=on]:text-orange-600',
              ];
              return (
                <Toggle
                  key={operator.key}
                  size="sm"
                  variant="outline"
                  pressed={active}
                  onPressedChange={() => setExcludedOperators((current) => active ? [...current, operator.key] : current.filter((key) => key !== operator.key))}
                  className={cn('h-7 rounded-full px-2.5 text-[11px] font-medium', active ? tones[index % tones.length] : 'border-dashed border-border bg-transparent text-muted-foreground line-through opacity-55')}
                >
                  {operator.label}
                </Toggle>
              );
            })}
          </div>
        </div>
      )}
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Estado</span>
        <div className="flex flex-wrap gap-1">
          {PROPOSAL_STATUSES.map((status, index) => {
            const active = !excludedStatuses.includes(status);
            const tones = [
              'border-slate-400/40 bg-slate-400/15 text-slate-600 data-[state=on]:bg-slate-400/15 data-[state=on]:text-slate-600',
              'border-blue-500/40 bg-blue-500/15 text-blue-600 data-[state=on]:bg-blue-500/15 data-[state=on]:text-blue-600',
              'border-amber-500/40 bg-amber-500/15 text-amber-600 data-[state=on]:bg-amber-500/15 data-[state=on]:text-amber-600',
              'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-600',
              'border-red-500/40 bg-red-500/15 text-red-600 data-[state=on]:bg-red-500/15 data-[state=on]:text-red-600',
              'border-slate-500/40 bg-slate-500/15 text-slate-600 data-[state=on]:bg-slate-500/15 data-[state=on]:text-slate-600',
            ];
            return (
              <Toggle
                key={status}
                size="sm"
                variant="outline"
                pressed={active}
                onPressedChange={() => setExcludedStatuses((current) => active ? [...current, status] : current.filter((item) => item !== status))}
                className={cn('h-7 rounded-full px-2.5 text-[11px] font-medium', active ? tones[index % tones.length] : 'border-dashed border-border bg-transparent text-muted-foreground line-through opacity-55')}
              >
                {PROPOSAL_STATUS_LABELS[status]}
              </Toggle>
            );
          })}
        </div>
      </div>
      {isTelecom && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Tipo</span>
          <div className="flex flex-wrap gap-1">
            {(['energia', 'servicos'] as ProposalType[]).map((type, index) => {
              const active = !excludedTypes.includes(type);
              const tone = index === 0
                ? 'border-violet-500/40 bg-violet-500/15 text-violet-600 data-[state=on]:bg-violet-500/15 data-[state=on]:text-violet-600'
                : 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-600 data-[state=on]:bg-fuchsia-500/15 data-[state=on]:text-fuchsia-600';
              return (
                <Toggle
                  key={type}
                  size="sm"
                  variant="outline"
                  pressed={active}
                  onPressedChange={() => setExcludedTypes((current) => active ? [...current, type] : current.filter((item) => item !== type))}
                  className={cn('h-7 rounded-full px-2.5 text-[11px] font-medium', active ? tone : 'border-dashed border-border bg-transparent text-muted-foreground line-through opacity-55')}
                >
                  {PROPOSAL_TYPE_LABELS[type]}
                </Toggle>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  const proposalsList = isLoading ? (
    <div className="flex items-center justify-center py-12">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  ) : filteredProposals.length === 0 ? (
    proposals.length === 0 ? (
      <EmptyState
        icon={FileText}
        title="Ainda não tens propostas"
        description="Cria a tua primeira proposta para enviares aos teus clientes."
      >
        <Button onClick={() => setCreateModalOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Criar primeira proposta
        </Button>
      </EmptyState>
    ) : (
      <EmptyState icon={FileText} title="Nenhuma proposta encontrada" description="Nenhuma proposta corresponde aos filtros." />
    )
  ) : (
    <div className="space-y-3">
      {filteredProposals.map((proposal) => (
        <Card
          key={proposal.id}
          className={cn(
            'cursor-pointer relative transition-all',
            isGenericNiche
              ? 'rounded-xl border-border/70 bg-card shadow-sm hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md'
              : 'hover:bg-muted/50',
          )}
          onClick={() => setSelectedProposal(proposal)}
        >
          {proposal.status === 'accepted' && !(proposal as any).has_sale && (
            <Button
              variant="default"
              size="sm"
              className="absolute top-2 right-2 z-10 h-7 text-xs"
              onClick={(e) => { e.stopPropagation(); setSaleProposal(proposal); }}
            >
              Criar Venda
            </Button>
          )}
          <CardContent className={cn('flex items-center justify-between', isGenericNiche ? 'p-5' : 'p-4')}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Badge className={cn('text-xs', PROPOSAL_STATUS_COLORS[proposal.status])}>
                  {PROPOSAL_STATUS_LABELS[proposal.status]}
                </Badge>
                {isTelecom && proposal.proposal_type && (
                  <Badge className={cn('text-xs', proposal.proposal_type === 'energia' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-violet-500/20 text-violet-400')}>
                    {proposal.proposal_type === 'energia' ? <Zap className="h-3 w-3 mr-1" /> : <Wrench className="h-3 w-3 mr-1" />}
                    {PROPOSAL_TYPE_LABELS[proposal.proposal_type]}
                  </Badge>
                )}
                {proposal.code && <span className="text-xs font-mono text-primary font-medium">{proposal.code}</span>}
                <span className="text-xs text-muted-foreground">
                  {format(new Date(proposal.proposal_date), "d MMM yyyy", { locale: pt })}
                </span>
              </div>
              <p className="font-medium truncate">{proposal.client?.name || proposal.lead?.name || 'Proposta Avulsa'}</p>
              {proposal.notes && <p className="text-sm text-muted-foreground truncate">{proposal.notes}</p>}
            </div>
            <div className="ml-4 shrink-0 text-right">
              <p className="text-lg font-bold text-primary">{formatCurrency(proposal.total_value)}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );

  return (
    <>
      <div className={isGenericNiche || isTelecom ? 'space-y-6' : 'space-y-6 p-4 sm:p-6 lg:p-8'}>
        <PinnedPageBar
          icon={FileText}
          title="Propostas"
          storageKey="proposals-filters-open-v1"
          search={(
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Pesquisar por cliente, empresa ou código..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 border-primary/35 bg-primary/[0.04] pl-10 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-primary/25"
              />
            </div>
          )}
          chips={[
            search.trim() ? `“${search.trim()}”` : null,
            dateRange?.from ? 'Período' : null,
            excludedStatuses.length ? `${excludedStatuses.length} estados ocultos` : null,
            isTelecom && excludedTypes.length ? `${excludedTypes.length} tipos ocultos` : null,
          ].filter((c): c is string => !!c)}
          actions={
            <Button onClick={() => setCreateModalOpen(true)} size="sm" className={isGenericNiche ? 'h-10 px-4' : 'h-8'}>
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Nova Proposta</span>
              <span className="sm:hidden">Nova</span>
            </Button>
          }
          panel={
            <div className="mt-[30px] grid w-full min-w-0 max-w-full items-start gap-4 lg:grid-cols-[252px_minmax(0,1fr)]">
              <aside className="hidden rounded-xl border border-border/70 bg-card p-3 lg:sticky lg:top-4 lg:block lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Filter className="h-4 w-4 text-primary" />Filtros
                </h2>
                {filterControls}
              </aside>
              <div className="lg:hidden">
                <Accordion type="single" collapsible className="rounded-xl border border-border/70 bg-card px-3">
                  <AccordionItem value="proposal-filters" className="border-0">
                    <AccordionTrigger className="py-3 text-sm font-semibold hover:no-underline">
                      <span className="flex items-center gap-2"><Filter className="h-4 w-4 text-primary" />Filtros</span>
                    </AccordionTrigger>
                    <AccordionContent className="pb-3">{filterControls}</AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
              <div className="w-full min-w-0 max-w-full space-y-4">
                <div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
                  <Card className={isGenericNiche ? 'rounded-xl border-border/70 shadow-sm' : undefined}>
                    <CardContent className="p-3 sm:p-4">
                      <p className="text-xs text-muted-foreground sm:text-sm">Total Propostas</p>
                      <p className="text-xl font-bold sm:text-2xl">{filteredProposals.length}</p>
                    </CardContent>
                  </Card>
                  <Card className={isGenericNiche ? 'rounded-xl border-border/70 shadow-sm' : undefined}>
                    <CardContent className="p-3 sm:p-4">
                      <p className="text-xs text-muted-foreground sm:text-sm">Valor Total</p>
                      <p className="text-lg font-bold text-primary sm:text-2xl">{formatCurrency(totalValue)}</p>
                    </CardContent>
                  </Card>
                  <Card className={isGenericNiche ? 'rounded-xl border-border/70 shadow-sm' : undefined}>
                    <CardContent className="p-3 sm:p-4">
                      <p className="text-xs text-muted-foreground sm:text-sm">Em Negociação</p>
                      <p className="text-lg font-bold text-amber-500 sm:text-2xl">{formatCurrency(pendingValue)}</p>
                    </CardContent>
                  </Card>
                  <Card className={isGenericNiche ? 'rounded-xl border-border/70 shadow-sm' : undefined}>
                    <CardContent className="p-3 sm:p-4">
                      <p className="text-xs text-muted-foreground sm:text-sm">Aceites</p>
                      <p className="text-xl font-bold text-green-500 sm:text-2xl">{proposalsByStatus.accepted?.length || 0}</p>
                    </CardContent>
                  </Card>
                </div>
                {proposalsList}
              </div>
            </div>
          }
          layout={isGenericNiche || isTelecom ? 'dashboard' : 'pinned'}
          subtitle={isGenericNiche ? 'Crie, envie e acompanhe propostas comerciais num só lugar.' : undefined}
        />
        {!isGenericNiche && !isTelecom && proposalsList}
      </div>

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

      {/* "Criar Venda" from the list — a fully prefilled sale (client, items,
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
