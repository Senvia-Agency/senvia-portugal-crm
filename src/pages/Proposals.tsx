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
import { FileText, Search, Filter, Plus, Zap, Wrench } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/layout/PageHeader';
import { DateRangePicker } from '@/components/ui/date-range-picker';
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
import { pt } from 'date-fns/locale';

export default function Proposals() {
  // Subscribe to realtime updates
  useProposalsRealtime();
  const { profile, organization } = useAuth();
  const { data: proposals = [], isLoading } = useProposals();
  const isTelecom = organization?.niche === 'telecom';
  const isGenericNiche = !organization?.niche || organization.niche === 'generic';
  const { data: telecomMetrics } = useTelecomProposalMetrics();
  
  const [search, setSearch] = usePersistedState('proposals-search-v1', '');
  const [statusFilter, setStatusFilter] = usePersistedState<ProposalStatus | 'all'>('proposals-status-v1', 'all');
  const [typeFilter, setTypeFilter] = usePersistedState<'all' | 'energia' | 'servicos'>('proposals-type-v1', 'all');
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
    const matchesStatus = statusFilter === 'all' || proposal.status === statusFilter;
    const matchesType = typeFilter === 'all' || proposal.proposal_type === typeFilter;
    const proposalDate = new Date(proposal.proposal_date);
    const matchesDate = !dateRange?.from || (
      proposalDate >= dateRange.from &&
      (!dateRange.to || proposalDate <= dateRange.to)
    );
    return matchesSearchTerm && matchesStatus && matchesType && matchesDate;
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

  return (
    <>
      <div className={isGenericNiche ? 'space-y-6' : 'space-y-6 p-4 sm:p-6 lg:p-8'}>
        <PinnedPageBar
          icon={FileText}
          title="Propostas"
          storageKey="proposals-filters-open-v1"
          search={!isGenericNiche ? (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Pesquisar por cliente, empresa ou código..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 border-primary/35 bg-primary/[0.04] pl-9 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-primary/25"
              />
            </div>
          ) : undefined}
          summary={!isGenericNiche ? `${filteredProposals.length} proposta${filteredProposals.length === 1 ? '' : 's'} · ${formatCurrency(totalValue)}` : undefined}
          chips={[
            search.trim() ? `“${search.trim()}”` : null,
            dateRange?.from ? 'Período' : null,
            statusFilter !== 'all' ? PROPOSAL_STATUS_LABELS[statusFilter] : null,
            isTelecom && typeFilter !== 'all' ? (typeFilter === 'energia' ? 'Energia' : 'Outros Serviços') : null,
          ].filter((c): c is string => !!c)}
          actions={
            <Button onClick={() => setCreateModalOpen(true)} size="sm" className={isGenericNiche ? 'h-10 px-4' : 'h-8'}>
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Nova Proposta</span>
              <span className="sm:hidden">Nova</span>
            </Button>
          }
          panel={
            <div className={isGenericNiche ? 'flex flex-col gap-4' : 'flex flex-col gap-4 px-4 md:px-6 py-3'}>
        {/* Filters */}
        <div className={`order-1 grid grid-cols-1 gap-3 sm:grid-cols-2 ${isGenericNiche ? 'xl:grid-cols-4' : isTelecom ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} rounded-xl border border-border/70 bg-muted/20 p-3 md:p-4`}>
          {isGenericNiche && <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Pesquisar por cliente, empresa ou código..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 border-primary/35 bg-primary/[0.04] pl-10 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-primary/25"
            />
          </div>}
          <TeamMemberFilter className="w-full bg-card/50 border-border/50" />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ProposalStatus | 'all')}>
            <SelectTrigger className="w-full bg-card/50 border-border/50">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Todos os status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {PROPOSAL_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {PROPOSAL_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isTelecom && (
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as 'all' | 'energia' | 'servicos')}>
              <SelectTrigger className="w-full bg-card/50 border-border/50">
                <Zap className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Todos os tipos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                <SelectItem value="energia">Energia</SelectItem>
                <SelectItem value="servicos">Outros Serviços</SelectItem>
              </SelectContent>
            </Select>
          )}
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            placeholder="Período"
            className="w-full"
          />
        </div>
        {/* Summary Cards */}
        <div className="order-2 grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className={isGenericNiche ? 'rounded-xl border-border/70 shadow-sm' : undefined}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Total Propostas</p>
              <p className="text-2xl font-bold">{filteredProposals.length}</p>
            </CardContent>
          </Card>
          <Card className={isGenericNiche ? 'rounded-xl border-border/70 shadow-sm' : undefined}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Valor Total</p>
              <p className="text-2xl font-bold text-primary">{formatCurrency(totalValue)}</p>
              {isTelecom && (
                <p className="text-xs text-muted-foreground mt-1">
                  {(telecomMetrics?.totalMWh ?? 0).toFixed(1)} MWh · {(telecomMetrics?.totalKWp ?? 0).toFixed(1)} kWp
                </p>
              )}
            </CardContent>
          </Card>
          <Card className={isGenericNiche ? 'rounded-xl border-border/70 shadow-sm' : undefined}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Em Negociação</p>
              <p className="text-2xl font-bold text-amber-500">{formatCurrency(pendingValue)}</p>
              {isTelecom && (
                <p className="text-xs text-muted-foreground mt-1">
                  {(telecomMetrics?.pendingMWh ?? 0).toFixed(1)} MWh · {(telecomMetrics?.pendingKWp ?? 0).toFixed(1)} kWp
                </p>
              )}
            </CardContent>
          </Card>
          <Card className={isGenericNiche ? 'rounded-xl border-border/70 shadow-sm' : undefined}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Aceites</p>
              <p className="text-2xl font-bold text-green-500">{proposalsByStatus.accepted?.length || 0}</p>
            </CardContent>
          </Card>
        </div>

            </div>
          }
          layout={isGenericNiche ? 'dashboard' : 'pinned'}
          subtitle={isGenericNiche ? 'Crie, envie e acompanhe propostas comerciais num só lugar.' : undefined}
        />
        {/* Proposals List */}
        {isLoading ? (
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
                      {proposal.code && (
                        <span className="text-xs font-mono text-primary font-medium">
                          {proposal.code}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(proposal.proposal_date), "d MMM yyyy", { locale: pt })}
                      </span>
                    </div>
                    <p className="font-medium truncate">{proposal.client?.name || proposal.lead?.name || 'Proposta Avulsa'}</p>
                    {proposal.notes && (
                      <p className="text-sm text-muted-foreground truncate">{proposal.notes}</p>
                    )}
                  </div>
                  <div className="text-right ml-4">
                    <p className="text-lg font-bold text-primary">
                      {formatCurrency(proposal.total_value)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
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
