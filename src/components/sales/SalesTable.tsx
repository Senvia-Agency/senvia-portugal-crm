import { format } from "date-fns";
import { AlertTriangle, CalendarClock, Eye, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { initialsOf } from "@/components/leads/lead-display";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TELECOM_TECHNOLOGY_LABELS, type TelecomTechnology } from "@/types/proposals";
import {
  BILLING_PROVIDER_LABELS, BILLING_STATUS_LABELS, SALE_STATUS_LABELS, SERVICE_STATUS_LABELS, TELECOM_STATUS_LABELS,
  type SaleWithDetails, type TelecomStatus,
} from "@/types/sales";
import { SALE_STATUS_PILLS, TELECOM_STATUS_PILLS } from "./sale-display";
import { useLanguage, dateLocale } from "@/i18n";

interface SalesTableProps {
  sales: SaleWithDetails[];
  isTelecom: boolean;
  /** Telecom with the energy module: show Energia / Serviços. */
  showEnergy: boolean;
  isAdmin: boolean;
  /** Telecom: what the sale is worth in commission (the sale's own screen shows the same). */
  commissionOf: (sale: SaleWithDetails) => number;
  operatorNamesOf: (sale: SaleWithDetails) => string[];
  technologiesOf: (sale: SaleWithDetails) => TelecomTechnology[];
  installSlotOf: (sale: SaleWithDetails) => { day: string; hours: string } | null;
  onOpen: (sale: SaleWithDetails) => void;
  onEdit: (sale: SaleWithDetails) => void;
  onDelete: (sale: SaleWithDetails) => void;
}

/** The sales as a dense list: client, number and date, state, the telecom install slot, and what it is worth. */
export function SalesTable(props: SalesTableProps) {
  const { t } = useLanguage();
  const { sales, isTelecom, showEnergy, isAdmin } = props;
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
      <div className="overflow-x-auto">
        <Table className="[&_td]:py-2 [&_th]:h-10 [&_th]:whitespace-nowrap">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("Cliente")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("Venda")}</TableHead>
              <TableHead>{t("Estado")}</TableHead>
              {isTelecom
                ? <TableHead className="hidden md:table-cell">{t("Instalação")}</TableHead>
                : <TableHead className="hidden lg:table-cell">{t("Recorrência")}</TableHead>}
              <TableHead className="text-right">{isTelecom ? t("Comissão") : t("Valor")}</TableHead>
              <TableHead className="w-[52px]" aria-label={t("Ações")} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.map((sale) => {
              const who = sale.client?.name || sale.lead?.name || t("Sem identificação");
              const operators = props.operatorNamesOf(sale);
              const technologies = isTelecom ? props.technologiesOf(sale) : [];
              const tags = [
                ...operators,
                ...technologies.map((tech) => t(TELECOM_TECHNOLOGY_LABELS[tech])),
                showEnergy && (sale as { proposal_type?: string | null }).proposal_type ? ((sale as { proposal_type?: string | null }).proposal_type === "energia" ? t("Energia") : t("Serviços")) : null,
              ].filter(Boolean) as string[];
              const slot = isTelecom ? props.installSlotOf(sale) : null;
              const needsSeller = sale.recurrence?.billing_provider === "stripe" && !sale.seller_id && !sale.created_by;
              return (
                <TableRow key={sale.id} className="group cursor-pointer hover:bg-muted/50" onClick={() => props.onOpen(sale)}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary" aria-hidden="true">
                        {initialsOf(who)}
                      </span>
                      <div className="min-w-0">
                        <p className="max-w-[17rem] truncate font-medium">{who}</p>
                        {tags.length > 0 ? (
                          <div className="mt-0.5 flex max-w-[17rem] flex-wrap gap-1">
                            {tags.map((tag) => <span key={tag} className="rounded-full bg-primary/10 px-1.5 text-[11px] font-medium text-primary">{tag}</span>)}
                          </div>
                        ) : sale.notes ? <p className="max-w-[17rem] truncate text-xs text-muted-foreground">{sale.notes}</p> : null}
                        {needsSeller && (
                          <button type="button" title={t("Esta venda Stripe ainda não tem vendedor associado")}
                            className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300"
                            onClick={(event) => { event.stopPropagation(); if (isAdmin) props.onEdit(sale); else props.onOpen(sale); }}>
                            <AlertTriangle className="h-3 w-3" />{t("Associar vendedor")}
                          </button>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">
                    {sale.code && <p className="font-mono text-xs font-semibold text-primary">#{sale.code}</p>}
                    <p className="text-xs text-muted-foreground">{format(new Date(sale.created_at), "d MMM yyyy", { locale: dateLocale() })}</p>
                    {sale.proposal && <p className="text-[11px] text-muted-foreground">{t("via proposta")}</p>}
                  </TableCell>
                  <TableCell>
                    {isTelecom ? (
                      sale.telecom_status
                        ? <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TELECOM_STATUS_PILLS[sale.telecom_status as TelecomStatus])}>{t(TELECOM_STATUS_LABELS[sale.telecom_status as TelecomStatus])}</span>
                        : <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{t("Sem estado")}</span>
                    ) : (
                      <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", SALE_STATUS_PILLS[sale.status])}>{t(SALE_STATUS_LABELS[sale.status])}</span>
                    )}
                  </TableCell>
                  {isTelecom ? (
                    <TableCell className="hidden whitespace-nowrap md:table-cell">
                      <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", slot ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
                        <CalendarClock className="h-3.5 w-3.5" />
                        {slot ? <>{slot.day}{slot.hours && <span className="tabular-nums">· {slot.hours}</span>}</> : t("Sem data marcada")}
                      </span>
                    </TableCell>
                  ) : (
                    <TableCell className="hidden lg:table-cell">
                      {sale.recurrence ? (
                        <div className="text-xs leading-5">
                          <p>{t("Serviço:")} <span className="font-medium">{t(SERVICE_STATUS_LABELS[sale.recurrence.service_status])}</span></p>
                          <p className="text-muted-foreground">{t("Cobrança:")} {t(BILLING_STATUS_LABELS[sale.recurrence.billing_status])} · {t(BILLING_PROVIDER_LABELS[sale.recurrence.billing_provider])}</p>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                  )}
                  <TableCell className="whitespace-nowrap text-right">
                    <p className="font-semibold tabular-nums">{formatCurrency(isTelecom ? props.commissionOf(sale) : sale.total_value)}</p>
                    {sale.recurrence && <p className="text-[11px] text-muted-foreground">{formatCurrency(sale.recurrence.amount)}{t("/mês")}</p>}
                  </TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    {isAdmin && <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label={t("Mais ações da venda de {{name}}", { name: who })}><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => props.onOpen(sale)}><Eye className="mr-2 h-4 w-4" />{t("Ver venda")}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => props.onEdit(sale)}><Pencil className="mr-2 h-4 w-4" />{t("Editar")}</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => props.onDelete(sale)}><Trash2 className="mr-2 h-4 w-4" />{t("Eliminar venda")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>}
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
