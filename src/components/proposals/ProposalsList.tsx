import { useState } from 'react';
import { Plus, FileText, ChevronRight, Zap, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useLeadProposals } from '@/hooks/useProposals';
import { CreateProposalModal } from './CreateProposalModal';
import { ProposalDetailsModal } from './ProposalDetailsModal';
import { PROPOSAL_TYPE_LABELS } from '@/types/proposals';
import { StatusBadge } from '@/components/ui/status-badge';
import { proposalStatusBadge } from '@/lib/status-badge-maps';
import type { Proposal } from '@/types/proposals';
import type { Lead } from '@/types';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useLanguage, dateLocale } from "@/i18n";

interface ProposalsListProps {
  lead: Lead;
}

export function ProposalsList({ lead }: ProposalsListProps) {
  const { t } = useLanguage();
  const { data: proposals = [], isLoading } = useLeadProposals(lead.id);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4" />
          {t("Propostas ({{n}})", { n: proposals.length })}
        </h3>
        <Button size="sm" onClick={() => setCreateModalOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          {t("Nova")}
        </Button>
      </div>

      {proposals.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground border rounded-lg bg-muted/30">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">{t("Sem propostas para este lead.")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {proposals.map((proposal) => (
            <button
              key={proposal.id}
              onClick={() => setSelectedProposal(proposal)}
              className="w-full flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <StatusBadge {...proposalStatusBadge(proposal.status)} label={t(proposalStatusBadge(proposal.status).label)} />
                  {proposal.proposal_type && (
                    <Badge className={cn('text-xs', proposal.proposal_type === 'energia' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-violet-500/20 text-violet-400')}>
                      {proposal.proposal_type === 'energia' ? <Zap className="h-3 w-3 mr-1" /> : <Wrench className="h-3 w-3 mr-1" />}
                      {t(PROPOSAL_TYPE_LABELS[proposal.proposal_type])}
                    </Badge>
                  )}
                  {proposal.code && (
                    <span className="text-xs font-mono text-primary font-medium">
                      {proposal.code}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(proposal.proposal_date), "d MMM yyyy", { locale: dateLocale() })}
                  </span>
                </div>
                <p className="font-semibold text-primary">
                  {formatCurrency(proposal.total_value)}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      <CreateProposalModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        leadId={lead.id}
      />

      {selectedProposal && (
        <ProposalDetailsModal
          proposal={selectedProposal}
          open={!!selectedProposal}
          onOpenChange={(open) => !open && setSelectedProposal(null)}
        />
      )}
    </div>
  );
}
