import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MoreHorizontal, Eye, Pencil, Trash2, Mail, MessageCircle } from "lucide-react";
import type { CrmClient } from "@/types/clients";
import { useClientLabels } from "@/hooks/useClientLabels";
import { formatCurrency, formatDate, getInboxUrl } from "@/lib/format";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { useTeamMembers } from "@/hooks/useTeam";
import { initialsOf } from "@/components/leads/lead-display";
import { CLIENT_STATUS_PILLS } from "./client-display";
import { useLanguage } from "@/i18n";

interface ClientsTableProps {
  clients: CrmClient[];
  onEdit: (client: CrmClient) => void;
  onView: (client: CrmClient) => void;
  onDelete: (clientId: string) => void;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  isTelecom?: boolean;
}

/** The clients as a dense list: who, how to reach them, who looks after them, state, value and since when. */
export function ClientsTable({ clients, onEdit, onView, onDelete, selectedIds = [], onSelectionChange, isTelecom = false }: ClientsTableProps) {
  const { t } = useLanguage();
  const [deleteClientId, setDeleteClientId] = useState<string | null>(null);
  const { canDeleteLeads } = usePermissions();
  const { data: teamMembers = [] } = useTeamMembers();
  const memberNames = useMemo(() => new Map(teamMembers.map(member => [member.user_id, member.full_name])), [teamMembers]);
  const labels = useClientLabels();

  const allSelected = clients.length > 0 && selectedIds.length === clients.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < clients.length;
  const toggleAll = (checked: boolean) => onSelectionChange?.(checked ? clients.map(client => client.id) : []);
  const toggleOne = (clientId: string, checked: boolean) =>
    onSelectionChange?.(checked ? [...selectedIds, clientId] : selectedIds.filter(id => id !== clientId));

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="overflow-x-auto">
          <Table className="[&_td]:py-2 [&_th]:h-10 [&_th]:whitespace-nowrap">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {onSelectionChange && (
                  <TableHead className="w-[44px]">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={(checked) => toggleAll(checked === true)}
                      aria-label={t("Selecionar todos")}
                    />
                  </TableHead>
                )}
                <TableHead>{t(labels.singular)}</TableHead>
                <TableHead className="hidden md:table-cell">{t("Contacto")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("Responsável")}</TableHead>
                <TableHead>{t(labels.statusFieldLabel)}</TableHead>
                <TableHead className="hidden text-right xl:table-cell">{isTelecom ? t("Comissão") : t("Valor")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t(labels.since)}</TableHead>
                <TableHead className="w-[84px]" aria-label={t("Ações")} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => {
                const isSelected = selectedIds.includes(client.id);
                // Telecom works with companies first; elsewhere the person comes first.
                const title = isTelecom ? (client.company || client.name) : client.name;
                const subtitle = [
                  isTelecom ? (client.company && client.name !== client.company ? client.name : null) : client.company,
                  client.nif || client.company_nif ? `NIF ${client.nif || client.company_nif}` : null,
                  client.code ? `#${client.code}` : null,
                ].filter(Boolean).join(" · ");
                const owner = client.assigned_to ? memberNames.get(client.assigned_to) : null;
                const amount = isTelecom ? client.total_comissao || 0 : client.total_value || 0;
                return (
                  <TableRow
                    key={client.id}
                    className={cn("group cursor-pointer hover:bg-muted/50", isSelected && "bg-primary/5")}
                    onClick={() => onView(client)}
                  >
                    {onSelectionChange && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => toggleOne(client.id, checked === true)}
                          aria-label={t("Selecionar {{name}}", { name: client.name })}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary" aria-hidden="true">
                          {initialsOf(title)}
                        </span>
                        <div className="min-w-0">
                          <p className="max-w-[13rem] truncate font-medium">{title}</p>
                          {subtitle && <p className="max-w-[13rem] truncate text-xs text-muted-foreground">{subtitle}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="min-w-0 text-sm">
                        {client.phone && <p className="truncate">{client.phone}</p>}
                        {client.email && <p className="max-w-[12rem] truncate text-xs text-muted-foreground">{client.email}</p>}
                        {!client.phone && !client.email && <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {owner ? (
                        <span className="flex items-center gap-2 text-sm">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">{initialsOf(owner)}</span>
                          <span className="max-w-[8rem] truncate">{owner}</span>
                        </span>
                      ) : <span className="text-xs text-muted-foreground">{t("Sem responsável")}</span>}
                    </TableCell>
                    <TableCell>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", CLIENT_STATUS_PILLS[client.status] ?? CLIENT_STATUS_PILLS.active)}>
                        {client.status === "inactive" ? t(labels.statusInactive) : t(labels.statusActive)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-right text-sm tabular-nums xl:table-cell">
                      {amount ? formatCurrency(amount) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground sm:table-cell">
                      {formatDate(client.created_at)}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        {client.phone && (
                          <Button variant="ghost" size="icon" asChild
                            className="h-8 w-8 rounded-full text-emerald-600 opacity-0 transition-opacity hover:bg-emerald-500/10 focus-visible:opacity-100 group-hover:opacity-100 dark:text-emerald-400">
                            <Link to={getInboxUrl(client.phone)} aria-label={t("WhatsApp a {{name}}", { name: client.name })} title={t("WhatsApp")}><MessageCircle className="h-4 w-4" /></Link>
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label={t("Mais ações de {{name}}", { name: client.name })}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onView(client)}>
                              <Eye className="h-4 w-4 mr-2" />
                              {t("Ver ficha")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onEdit(client)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              {t("Editar")}
                            </DropdownMenuItem>
                            {client.email && (
                              <DropdownMenuItem asChild>
                                <a href={`mailto:${client.email}`}><Mail className="h-4 w-4 mr-2" />{t("Enviar email")}</a>
                              </DropdownMenuItem>
                            )}
                            {canDeleteLeads && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => setDeleteClientId(client.id)}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  {t("Eliminar")}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <AlertDialog open={!!deleteClientId} onOpenChange={() => setDeleteClientId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Eliminar cliente?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Esta ação não pode ser revertida. O cliente será permanentemente removido.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteClientId) onDelete(deleteClientId); setDeleteClientId(null); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("Eliminar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
