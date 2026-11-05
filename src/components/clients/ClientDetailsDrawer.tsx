import { AutomationRecordActions } from "@/components/automations/AutomationRecordActions";
import { useState } from "react";
import { useModules } from "@/hooks/useModules";
import { COUNTRIES } from "@/lib/countries";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RecordTasks } from "@/components/inbox/RecordTasks";
import { ContactNotes } from "@/components/contacts/ContactNotes";
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  MapPin,
  FileText,
  ShoppingCart,
  Pencil,
  MessageCircle,
  Plus,
  Calendar as CalendarIcon,
  User,
  Router,
  Zap,
  Hash,
  Layers,
  Globe,
  Receipt,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { formatDate, formatCurrency, getInboxUrl } from "@/lib/format";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { type ProposalStatus, type Proposal } from "@/types/proposals";
import { type SaleStatus, type TelecomStatus, TELECOM_STATUS_LABELS, TELECOM_STATUS_COLORS } from "@/types/sales";
import { StatusBadge } from "@/components/ui/status-badge";
import { saleStatusBadge, proposalStatusBadge } from "@/lib/status-badge-maps";
import { ProposalDetailsModal } from "@/components/proposals/ProposalDetailsModal";
import { useClientLabels } from "@/hooks/useClientLabels";
import { useClientHistory } from "@/hooks/useClientHistory";
import { useTeamMembers } from "@/hooks/useTeam";
import { useCpes } from "@/hooks/useCpes";
import { useAuth } from "@/contexts/AuthContext";
import { ClientTimeline } from "./ClientTimeline";
import { AddCommunicationModal } from "./AddCommunicationModal";
import { CpeList } from "./CpeList";
import { CLIENT_STATUS_PILLS } from "./client-display";
import { initialsOf } from "@/components/leads/lead-display";
import { CLIENT_SOURCE_LABELS, type CrmClient } from "@/types/clients";
import { formatOperationalUnits, sumOperationalSaleUnits } from "@/lib/sale-units";
import { useLanguage } from "@/i18n";

interface ClientDetailsDrawerProps {
  client: CrmClient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (client: CrmClient) => void;
  onNewProposal?: (client: CrmClient) => void;
  onNewSale?: (client: CrmClient) => void;
  onScheduleMeeting?: (client: CrmClient) => void;
}

const sectionTitle = "flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

/** One label/value line of the details column. */
function DetailRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-2 py-2 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground"><Icon className="h-4 w-4 shrink-0" />{label}</span>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

/** One figure of the strip under the header. */
function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-[7rem] flex-1 rounded-xl border border-border/70 bg-card px-3.5 py-2">
      <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={cn("truncate text-base font-semibold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

/** The client record, in full screen: who, how to reach them, the figures, what happened, and the details. */
export function ClientDetailsDrawer({
  client,
  open,
  onOpenChange,
  onEdit,
  onNewProposal,
  onNewSale,
  onScheduleMeeting
}: ClientDetailsDrawerProps) {
  const { t } = useLanguage();
  const labels = useClientLabels();
  const { timeline, proposals, sales, isLoading: loadingHistory } = useClientHistory(client?.id || null);
  const { data: teamMembers = [] } = useTeamMembers();
  const { organization } = useAuth();

  const isTelecom = organization?.niche === 'telecom';
  const { modules } = useModules();
  const showEnergy = isTelecom && modules.energy;
  const { data: cpes = [] } = useCpes(isTelecom ? client?.id : null);
  const CpeIcon = isTelecom ? Zap : Router;

  const [showAddCommunication, setShowAddCommunication] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);

  if (!client) return null;

  const owner = client.assigned_to ? teamMembers.find(m => m.user_id === client.assigned_to)?.full_name ?? null : null;
  const title = isTelecom ? (client.company || client.name) : client.name;
  const subtitle = [
    isTelecom ? (client.company && client.company !== client.name ? client.name : null) : client.company,
    client.nif ? `NIF ${client.nif}` : client.company_nif ? `NIF ${client.company_nif}` : null,
    `${t(labels.since).toLowerCase()} ${formatDate(client.created_at)}`,
  ].filter(Boolean).join(" · ");
  const sourceLabel = client.source ? (CLIENT_SOURCE_LABELS[client.source] ? t(CLIENT_SOURCE_LABELS[client.source]) : client.source) : null;

  const companyAddress = client.company_address_same_as_client
    ? { line1: client.address_line1, line2: client.address_line2, city: client.city, postalCode: client.postal_code, country: client.country }
    : { line1: client.company_address_line1, line2: client.company_address_line2, city: client.company_city, postalCode: client.company_postal_code, country: client.company_country };
  const hasCompanyAddress = companyAddress.line1 || companyAddress.city || companyAddress.postalCode;
  const countryName = (code: string | null | undefined) => (code ? COUNTRIES.find(item => item.code === code)?.name || code : null);
  const billsCompany = client.billing_target === 'company';

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("Ficha do {{entity}} {{name}}", { entity: t(labels.singular).toLowerCase(), name: client.name })}</DialogTitle>
          <DialogDescription>{t("Contactos, números, histórico e detalhes do {{entity}}", { entity: t(labels.singular).toLowerCase() })}</DialogDescription>
        </DialogHeader>

        {/* Header: who it is, how to reach them, and what to do next. */}
        <header className="shrink-0 border-b bg-background py-3 pl-4 pr-14 sm:pl-6">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-3">
            <Button variant="back" size="icon" onClick={() => onOpenChange(false)} className="h-9 w-9 shrink-0 rounded-full" aria-label={t("Voltar")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">
              {initialsOf(title)}
            </span>
            <div className="min-w-0 flex-1 basis-48">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-xl font-semibold tracking-tight">{title}</h2>
                {client.code && <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary">#{client.code}</span>}
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", CLIENT_STATUS_PILLS[client.status] ?? CLIENT_STATUS_PILLS.active)}>
                  {client.status === 'inactive' ? t(labels.statusInactive) : t(labels.statusActive)}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <AutomationRecordActions subjectType="client" subjectIds={[client.id]} />
              {client.phone && (
                <>
                  <Button variant="outline" size="sm" asChild className="h-9 rounded-full border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-800 dark:text-emerald-400">
                    <Link to={getInboxUrl(client.phone)}><MessageCircle className="h-4 w-4" />{t("WhatsApp")}</Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild className="h-9 rounded-full">
                    <a href={`tel:${client.phone}`}><Phone className="h-4 w-4" />{t("Ligar")}</a>
                  </Button>
                </>
              )}
              {client.email && (
                <Button variant="outline" size="sm" asChild className="h-9 rounded-full">
                  <a href={`mailto:${client.email}`}><Mail className="h-4 w-4" />{t("Email")}</a>
                </Button>
              )}
              {onNewProposal && (
                <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={() => onNewProposal(client)}>
                  <FileText className="h-4 w-4" />{t("Nova proposta")}
                </Button>
              )}
              {onNewSale && (
                <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={() => onNewSale(client)}>
                  <ShoppingCart className="h-4 w-4" />{t("Nova venda")}
                </Button>
              )}
              {onScheduleMeeting && (
                <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={() => onScheduleMeeting(client)}>
                  <CalendarIcon className="h-4 w-4" />{t("Agendar")}
                </Button>
              )}
              <Button size="sm" className="h-9 rounded-full" onClick={() => onEdit(client)}>
                <Pencil className="h-4 w-4" />{t("Editar")}
              </Button>
            </div>
          </div>

          {/* The client's numbers, always in view. */}
          <div className="mx-auto mt-3 flex w-full max-w-7xl flex-wrap gap-2">
            <Figure label={t("Propostas")} value={String(client.total_proposals ?? 0)} />
            <Figure label={t("Vendas")} value={formatOperationalUnits(client.total_sales)} tone="text-emerald-600 dark:text-emerald-400" />
            <Figure label={t("Valor total")} value={formatCurrency(client.total_value)} />
            {isTelecom && <Figure label={t("Comissão")} value={formatCurrency(client.total_comissao || 0)} />}
            {isTelecom && <Figure label={t("Cartões")} value={String(client.total_cartoes || 0)} />}
            {showEnergy && <Figure label={t("MWh")} value={(client.total_mwh || 0).toFixed(2)} />}
            {showEnergy && <Figure label={t("kWp")} value={(client.total_kwp || 0).toFixed(2)} />}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-2">

            {/* Activity on the right: notes shared with the inbox, open tasks and the client's history. */}
            <div className="min-w-0 space-y-6 lg:col-start-2 lg:row-start-1">
              <ContactNotes phone={client.phone} source="crm" />

              <RecordTasks phone={client.phone} />

              <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <h3 className={sectionTitle}>{t("Histórico")}</h3>
                  <Button variant="outline" size="sm" className="h-8 rounded-full" onClick={() => setShowAddCommunication(true)}>
                    <Plus className="h-4 w-4" />{t("Registar contacto")}
                  </Button>
                </div>
                <ClientTimeline events={timeline} isLoading={loadingHistory} />
              </div>

              {showEnergy && (
                <div className="space-y-3">
                  <h3 className={sectionTitle}><CpeIcon className="h-3.5 w-3.5" />{t("CPE/CUI ({{n}})", { n: cpes.length })}</h3>
                  <div className="rounded-xl border p-3">
                    <CpeList clientId={client.id} />
                  </div>
                </div>
              )}
            </div>

            {/* Data on the left: details, company and the client's proposals and sales, each in its card. */}
            <aside className="order-first min-w-0 lg:col-start-1 lg:row-start-1">
              <div className="space-y-4 lg:sticky lg:top-0">
                <div className="rounded-xl border bg-card p-4 shadow-sm">
                  <h3 className={cn(sectionTitle, "mb-1")}>{t("Detalhes")}</h3>
                  <div className="divide-y divide-border/60">
                    {client.code && <DetailRow icon={Hash} label={t("Código")}><span className="font-mono">#{client.code}</span></DetailRow>}
                    {client.nif && <DetailRow icon={FileText} label="NIF">{client.nif}</DetailRow>}
                    <DetailRow icon={Phone} label={t("Telefone")}>
                      {client.phone
                        ? <span className="flex flex-wrap items-center gap-x-2">{client.phone}<Link to={getInboxUrl(client.phone)} className="text-xs text-emerald-600 hover:underline dark:text-emerald-400">{t("WhatsApp")}</Link></span>
                        : <span className="text-muted-foreground">—</span>}
                    </DetailRow>
                    <DetailRow icon={Mail} label={t("Email")}>
                      {client.email ? <a href={`mailto:${client.email}`} className="text-primary hover:underline">{client.email}</a> : <span className="text-muted-foreground">—</span>}
                    </DetailRow>
                    <DetailRow icon={Layers} label={t(labels.statusFieldLabel)}>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", CLIENT_STATUS_PILLS[client.status] ?? CLIENT_STATUS_PILLS.active)}>
                        {client.status === 'inactive' ? t(labels.statusInactive) : t(labels.statusActive)}
                      </span>
                    </DetailRow>
                    {sourceLabel && <DetailRow icon={Globe} label={t("Origem")}>{sourceLabel}</DetailRow>}
                    <DetailRow icon={User} label={t("Responsável")}>{owner ?? <span className="text-muted-foreground">{t("Sem responsável")}</span>}</DetailRow>
                    <DetailRow icon={Receipt} label={t("Faturação")}>{billsCompany ? t("À empresa") : t("Ao {{entity}}", { entity: t(labels.singular).toLowerCase() })}</DetailRow>
                  </div>
                </div>

                <div className="rounded-xl border bg-card p-4 shadow-sm">
                  <h3 className={cn(sectionTitle, "mb-1")}><Building2 className="h-3.5 w-3.5" />{t("Empresa")}</h3>
                  {client.company || client.company_nif || hasCompanyAddress ? (
                    <div className="divide-y divide-border/60">
                      {client.company && <DetailRow icon={Building2} label={t("Nome")}>{client.company}</DetailRow>}
                      {client.company_nif && <DetailRow icon={FileText} label={t("Contribuinte")}>{client.company_nif}</DetailRow>}
                      {hasCompanyAddress && (
                        <DetailRow icon={MapPin} label={t("Morada")}>
                          {client.company_address_same_as_client && <p className="text-xs text-muted-foreground">{t("Mesma morada do {{entity}}", { entity: t(labels.singular).toLowerCase() })}</p>}
                          {companyAddress.line1 && <p>{companyAddress.line1}</p>}
                          {companyAddress.line2 && <p>{companyAddress.line2}</p>}
                          {(companyAddress.postalCode || companyAddress.city) && <p>{companyAddress.postalCode && `${companyAddress.postalCode} `}{companyAddress.city}</p>}
                          {countryName(companyAddress.country) && <p>{countryName(companyAddress.country)}</p>}
                        </DetailRow>
                      )}
                    </div>
                  ) : <p className="py-2 text-sm text-muted-foreground">{t("Sem empresa associada")}</p>}
                </div>

                {proposals.length > 0 && (
                  <div className="rounded-xl border bg-card p-4 shadow-sm">
                    <h3 className={cn(sectionTitle, "mb-2")}>{t("Propostas recentes")}</h3>
                    <div className="space-y-1.5">
                      {proposals.slice(0, 3).map((proposal) => (
                        <button key={proposal.id} type="button"
                          className="flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
                          onClick={() => setSelectedProposal(proposal as unknown as Proposal)}>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{proposal.code || `#${proposal.id.slice(0, 8)}`}</span>
                            <span className="block text-xs text-muted-foreground">{formatDate(proposal.created_at || '')}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="text-right">
                              <span className="block font-semibold tabular-nums">{formatCurrency(proposal.total_value)}</span>
                              <StatusBadge {...proposalStatusBadge(proposal.status as ProposalStatus)} label={t(proposalStatusBadge(proposal.status as ProposalStatus).label)} />
                            </span>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Every sale of this client, active and cancelled alike —
                    the point is the full history, so it is never truncated. */}
                {sales.length > 0 && (
                  <div className="rounded-xl border bg-card p-4 shadow-sm">
                    <h3 className={cn(sectionTitle, "mb-2 justify-between")}>
                      <span>{t("Vendas")}</span>
                      <span className="font-normal normal-case tracking-normal">{t("{{units}} no total · todos os estados", { units: formatOperationalUnits(sumOperationalSaleUnits(sales)) })}</span>
                    </h3>
                    <div className="max-h-[420px] space-y-1.5 overflow-y-auto">
                      {sales.map((sale) => (
                        <div key={sale.id} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{sale.code || `#${sale.id.slice(0, 8)}`}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(sale.created_at || '')}
                              {isTelecom && !!sale.total_cartoes && ` · ${t(sale.total_cartoes === 1 ? "{{n}} cartão" : "{{n}} cartões", { n: sale.total_cartoes })}`}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-semibold tabular-nums">{formatCurrency(sale.total_value)}</p>
                            {isTelecom && sale.telecom_status ? (
                              <Badge variant="outline" className={cn('text-[10px]', TELECOM_STATUS_COLORS[sale.telecom_status as TelecomStatus])}>
                                {t(TELECOM_STATUS_LABELS[sale.telecom_status as TelecomStatus])}
                              </Badge>
                            ) : (
                              <StatusBadge {...saleStatusBadge(sale.status as SaleStatus)} label={t(saleStatusBadge(sale.status as SaleStatus).label)} />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>

        <AddCommunicationModal
          open={showAddCommunication}
          onOpenChange={setShowAddCommunication}
          clientId={client.id}
          clientName={client.name}
          defaultType="note"
          defaultDirection="outbound"
        />
      </DialogContent>
    </Dialog>

    {/* Proposal Details Modal - fora do Dialog principal para evitar nested dialogs */}
    <ProposalDetailsModal
      proposal={selectedProposal}
      open={!!selectedProposal}
      onOpenChange={(open) => { if (!open) setSelectedProposal(null); }}
    />
  </>
  );
}
