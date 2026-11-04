import { format } from "date-fns";
import { ShoppingCart, Wrench, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { initialsOf } from "@/components/leads/lead-display";
import { cn } from "@/lib/utils";
import { PROPOSAL_STATUS_LABELS, PROPOSAL_TYPE_LABELS, type Proposal } from "@/types/proposals";
import { PROPOSAL_STATUS_PILLS, formatEuro } from "./proposal-display";
import { useLanguage, dateLocale } from "@/i18n";

interface ProposalsTableProps {
  proposals: Proposal[];
  isTelecom: boolean;
  onOpen: (proposal: Proposal) => void;
  /** "Criar venda" on an accepted proposal that has no sale yet. */
  onCreateSale: (proposal: Proposal) => void;
}

/** The proposals as a dense list: who it is for, its number and date, state, value and the next step. */
export function ProposalsTable({ proposals, isTelecom, onOpen, onCreateSale }: ProposalsTableProps) {
  const { t } = useLanguage();
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
      <div className="overflow-x-auto">
        <Table className="[&_td]:py-2 [&_th]:h-10 [&_th]:whitespace-nowrap">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("Cliente")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("Proposta")}</TableHead>
              <TableHead>{t("Estado")}</TableHead>
              {isTelecom && <TableHead className="hidden md:table-cell">{t("Tipo")}</TableHead>}
              <TableHead className="text-right">{t("Valor")}</TableHead>
              <TableHead className="w-[120px]" aria-label={t("Ações")} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {proposals.map((proposal) => {
              const who = proposal.client?.name || proposal.lead?.name || t("Proposta avulsa");
              const canSell = proposal.status === "accepted" && !(proposal as { has_sale?: boolean }).has_sale;
              return (
                <TableRow key={proposal.id} className="group cursor-pointer hover:bg-muted/50" onClick={() => onOpen(proposal)}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary" aria-hidden="true">
                        {initialsOf(who)}
                      </span>
                      <div className="min-w-0">
                        <p className="max-w-[18rem] truncate font-medium">{who}</p>
                        {proposal.notes && <p className="max-w-[18rem] truncate text-xs text-muted-foreground">{proposal.notes}</p>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">
                    {proposal.code && <p className="font-mono text-xs font-semibold text-primary">#{proposal.code}</p>}
                    <p className="text-xs text-muted-foreground">{format(new Date(proposal.proposal_date), "d MMM yyyy", { locale: dateLocale() })}</p>
                  </TableCell>
                  <TableCell>
                    <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", PROPOSAL_STATUS_PILLS[proposal.status])}>
                      {t(PROPOSAL_STATUS_LABELS[proposal.status])}
                    </span>
                  </TableCell>
                  {isTelecom && (
                    <TableCell className="hidden md:table-cell">
                      {proposal.proposal_type && (
                        <span className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
                          {proposal.proposal_type === "energia" ? <Zap className="h-3.5 w-3.5 text-amber-500" /> : <Wrench className="h-3.5 w-3.5 text-violet-500" />}
                          {t(PROPOSAL_TYPE_LABELS[proposal.proposal_type])}
                        </span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatEuro(Number(proposal.total_value))}</TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    {canSell && (
                      <Button size="sm" className="h-8 rounded-full px-3" onClick={() => onCreateSale(proposal)}>
                        <ShoppingCart className="h-3.5 w-3.5" />{t("Criar venda")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
