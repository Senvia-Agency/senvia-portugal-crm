import { useState, useEffect } from "react";
import { useModules } from "@/hooks/useModules";
import { COUNTRIES } from "@/lib/countries";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RecordTasks } from "@/components/inbox/RecordTasks";
import { ContactNotes } from "@/components/contacts/ContactNotes";
import {
  Mail,
  Phone,
  Building2,
  MapPin,
  FileText,
  ShoppingCart,
  Edit,
  MessageSquare,
  Plus,
  Calendar as CalendarIcon,
  Save,
  X,
  User,
  Router,
  Zap,
  Euro,
  ChevronRight,
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
import { useUpdateClient } from "@/hooks/useClients";
import { useTeamMembers } from "@/hooks/useTeam";
import { useCpes } from "@/hooks/useCpes";
import { useAuth } from "@/contexts/AuthContext";
import { ClientTimeline } from "./ClientTimeline";
import { AddCommunicationModal } from "./AddCommunicationModal";
import { CpeList } from "./CpeList";
import type { CrmClient } from "@/types/clients";
import type { CommunicationType, CommunicationDirection } from "@/types/communications";
import { formatOperationalUnits, sumOperationalSaleUnits } from "@/lib/sale-units";

interface ClientDetailsDrawerProps {
  client: CrmClient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (client: CrmClient) => void;
  onNewProposal?: (client: CrmClient) => void;
  onNewSale?: (client: CrmClient) => void;
  onScheduleMeeting?: (client: CrmClient) => void;
}

export function ClientDetailsDrawer({ 
  client, 
  open, 
  onOpenChange, 
  onEdit,
  onNewProposal,
  onNewSale,
  onScheduleMeeting
}: ClientDetailsDrawerProps) {
  const labels = useClientLabels();
  const { timeline, proposals, sales, events, isLoading: loadingHistory } = useClientHistory(client?.id || null);
  const updateClient = useUpdateClient();
  const { data: teamMembers = [] } = useTeamMembers();
  const { organization } = useAuth();
  
  const isTelecom = organization?.niche === 'telecom';
  const { modules } = useModules();
  const showEnergy = isTelecom && modules.energy;
  const { data: cpes = [] } = useCpes(isTelecom ? client?.id : null);
  const CpeIcon = isTelecom ? Zap : Router;

  const [showAddCommunication, setShowAddCommunication] = useState(false);
  const [defaultCommType, setDefaultCommType] = useState<CommunicationType>('note');
  const [defaultCommDirection, setDefaultCommDirection] = useState<CommunicationDirection>('outbound');
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);

  const getTeamMemberName = (userId: string | null | undefined) => {
    if (!userId) return null;
    const member = teamMembers.find(m => m.user_id === userId);
    return member?.full_name || null;
  };

  const handleOpenCommunicationModal = (type: CommunicationType = 'note', direction: CommunicationDirection = 'outbound') => {
    setDefaultCommType(type);
    setDefaultCommDirection(direction);
    setShowAddCommunication(true);
  };

  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [editedNotes, setEditedNotes] = useState("");

  useEffect(() => {
    if (client && !isEditingNotes) {
      setEditedNotes(client.notes || "");
    }
  }, [client, isEditingNotes]);

  if (!client) return null;

  const handleSaveNotes = () => {
    if (editedNotes !== (client.notes || "")) {
      updateClient.mutate({ id: client.id, notes: editedNotes || null });
    }
    setIsEditingNotes(false);
  };

  const handleCancelNotes = () => {
    setEditedNotes(client.notes || "");
    setIsEditingNotes(false);
  };

  const statusStyle = {
    active: { bg: 'bg-success/10', text: 'text-success', border: 'border-success/20' },
    inactive: { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-muted' },
    vip: { bg: 'bg-warning/10', text: 'text-warning', border: 'border-warning/20' },
  }[client.status] || { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-muted' };

  const statusLabel = {
    active: labels.statusActive,
    inactive: labels.statusInactive,
    vip: labels.statusVip,
  }[client.status] || client.status;

  const sourceLabel = {
    lead: 'Lead Convertido',
    referral: 'Indicação',
    direct: 'Contacto Direto',
    website: 'Website',
    other: 'Outro',
  }[client.source || ''] || client.source;

  const companyAddress = client.company_address_same_as_client
    ? { line1: client.address_line1, line2: client.address_line2, city: client.city, postalCode: client.postal_code, country: client.country }
    : { line1: client.company_address_line1, line2: client.company_address_line2, city: client.company_city, postalCode: client.company_postal_code, country: client.company_country };
  const hasCompanyAddress = companyAddress.line1 || companyAddress.city || companyAddress.postalCode;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-4 sm:px-6 py-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Detalhes do {labels.singular} #{client.code}
          </DialogTitle>
          <DialogDescription className="sr-only">Detalhes do cliente {client.name}</DialogDescription>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto p-4 sm:p-6">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Left Column */}
              <div className="lg:col-span-3 space-y-4">
                {/* Dados do Cliente */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      Dados do {labels.singular}
                      {(!client.billing_target || client.billing_target === 'client') && (
                        <Badge variant="outline" className="text-xs ml-auto border-primary/30 text-primary bg-primary/5">
                          Faturação
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {client.code && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Código</span>
                        <span className="font-mono text-primary bg-primary/10 px-2 py-0.5 rounded text-xs font-semibold">#{client.code}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Nome</span>
                      <span className="font-medium">{client.name}</span>
                    </div>
                    {client.nif && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">NIF</span>
                        <span>{client.nif}</span>
                      </div>
                    )}
                    {client.email && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Email</span>
                        <a href={`mailto:${client.email}`} className="text-primary hover:underline">{client.email}</a>
                      </div>
                    )}
                    {client.phone && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Telefone</span>
                        <div className="flex items-center gap-2">
                          <span>{client.phone}</span>
                          <Link
                            to={getInboxUrl(client.phone)}
                            className="text-success hover:underline text-xs"
                          >
                            WhatsApp
                          </Link>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{labels.statusFieldLabel}</span>
                      <Badge variant="outline" className={cn('text-xs', statusStyle.bg, statusStyle.text, statusStyle.border)}>
                        {statusLabel}
                      </Badge>
                    </div>
                    {client.source && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Origem</span>
                        <Badge variant="secondary" className="text-xs">{sourceLabel}</Badge>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Empresa */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      Empresa
                      {client.billing_target === 'company' && (
                        <Badge variant="outline" className="text-xs ml-auto border-primary/30 text-primary bg-primary/5">
                          Faturação
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {client.company ? (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Nome</span>
                        <span className="font-medium">{client.company}</span>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Sem empresa associada</p>
                    )}
                    {client.company_nif && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Contribuinte</span>
                        <span>{client.company_nif}</span>
                      </div>
                    )}
                    {hasCompanyAddress && (
                      <div className="flex items-start gap-3 text-sm pt-1">
                        <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <div>
                          {client.company_address_same_as_client && <p className="text-muted-foreground">Mesma morada do cliente</p>}
                          {companyAddress.line1 && <p>{companyAddress.line1}</p>}
                          {companyAddress.line2 && <p>{companyAddress.line2}</p>}
                          {(companyAddress.postalCode || companyAddress.city) && (
                            <p>{companyAddress.postalCode && `${companyAddress.postalCode} `}{companyAddress.city}</p>
                          )}
                          {companyAddress.country && <p>{COUNTRIES.find((item) => item.code === companyAddress.country)?.name || companyAddress.country}</p>}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* CPEs - Telecom only */}
                {showEnergy && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <CpeIcon className="h-4 w-4" />
                        CPE/CUI ({cpes.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CpeList clientId={client.id} />
                    </CardContent>
                  </Card>
                )}

                {/* Tarefas da conversa (Caixa de Entrada) */}
                <RecordTasks phone={client.phone} />

                {/* Unified contact notes (shared with the inbox & lead record) */}
                <ContactNotes phone={client.phone} source="crm" />

                {/* Histórico / Timeline */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Histórico</CardTitle>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleOpenCommunicationModal('note', 'outbound')}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Registar Contacto
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ClientTimeline events={timeline} isLoading={loadingHistory} />
                  </CardContent>
                </Card>
              </div>

              {/* Right Column - Sticky */}
              <div className="lg:col-span-2">
                <div className="lg:sticky lg:top-0 space-y-4">
                  {/* Métricas */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Métricas</CardTitle>
                    </CardHeader>
                    <CardContent>
                    <div className={cn("grid gap-3", showEnergy ? "grid-cols-2 sm:grid-cols-3" : isTelecom ? "grid-cols-3" : "grid-cols-3")}>
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <p className="text-xl font-bold text-primary">{client.total_proposals}</p>
                          <p className="text-xs text-muted-foreground">Propostas</p>
                        </div>
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <p className="text-xl font-bold text-success">{formatOperationalUnits(client.total_sales)}</p>
                          <p className="text-xs text-muted-foreground">Vendas</p>
                        </div>
                        {isTelecom && (
                          <div className="text-center p-3 bg-muted/50 rounded-lg">
                            <p className="text-xl font-bold">{formatCurrency(client.total_comissao || 0)}</p>
                            <p className="text-xs text-muted-foreground">Comissão</p>
                          </div>
                        )}
                        {isTelecom && (
                          <div className="text-center p-3 bg-muted/50 rounded-lg">
                            <p className="text-xl font-bold">{client.total_cartoes || 0}</p>
                            <p className="text-xs text-muted-foreground">Cartões</p>
                          </div>
                        )}
                        {isTelecom && (
                          <div className="text-center p-3 bg-muted/50 rounded-lg">
                            <p className="text-xl font-bold">{formatCurrency(client.total_value)}</p>
                            <p className="text-xs text-muted-foreground">Valor Total</p>
                          </div>
                        )}
                        {showEnergy && (
                          <>
                            <div className="text-center p-3 bg-muted/50 rounded-lg">
                              <p className="text-xl font-bold">{(client.total_mwh || 0).toFixed(2)}</p>
                              <p className="text-xs text-muted-foreground">MWh</p>
                            </div>
                            <div className="text-center p-3 bg-muted/50 rounded-lg">
                              <p className="text-xl font-bold">{(client.total_kwp || 0).toFixed(2)}</p>
                              <p className="text-xs text-muted-foreground">kWp</p>
                            </div>
                          </>
                        )}
                        {!isTelecom && (
                          <div className="text-center p-3 bg-muted/50 rounded-lg">
                            <p className="text-xl font-bold">{formatCurrency(client.total_value)}</p>
                            <p className="text-xs text-muted-foreground">Valor Total</p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Ações Rápidas */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Ações Rápidas</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => onEdit(client)}>
                        <Edit className="h-4 w-4 mr-1" />
                        Editar
                      </Button>
                      <Separator />
                      {client.phone && (
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="flex-1" asChild>
                            <a href={`tel:${client.phone}`}>
                              <Phone className="h-4 w-4 mr-1" />
                              Ligar
                            </a>
                          </Button>
                          <Button variant="outline" size="sm" className="flex-1 text-success border-success/20 hover:bg-success/10" asChild>
                            <Link to={getInboxUrl(client.phone)}>
                              <MessageSquare className="h-4 w-4 mr-1" />
                              WhatsApp
                            </Link>
                          </Button>
                        </div>
                      )}
                      {client.email && (
                        <Button variant="outline" size="sm" className="w-full" asChild>
                          <a href={`mailto:${client.email}`}>
                            <Mail className="h-4 w-4 mr-1" />
                            Email
                          </a>
                        </Button>
                      )}
                      <Separator />
                      {onNewProposal && (
                        <Button variant="outline" size="sm" className="w-full" onClick={() => onNewProposal(client)}>
                          <FileText className="h-4 w-4 mr-1" />
                          Nova Proposta
                        </Button>
                      )}
                      {onNewSale && (
                        <Button variant="outline" size="sm" className="w-full" onClick={() => onNewSale(client)}>
                          <ShoppingCart className="h-4 w-4 mr-1" />
                          Nova Venda
                        </Button>
                      )}
                      {onScheduleMeeting && (
                        <Button variant="outline" size="sm" className="w-full" onClick={() => onScheduleMeeting(client)}>
                          <CalendarIcon className="h-4 w-4 mr-1" />
                          Agendar
                        </Button>
                      )}
                    </CardContent>
                  </Card>

                  {/* Comercial Responsável */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Comercial Responsável</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {getTeamMemberName(client.assigned_to) ? (
                        <div className="flex items-center gap-2 text-sm">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span>{getTeamMemberName(client.assigned_to)}</span>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">Sem responsável atribuído</p>
                      )}
                    </CardContent>
                  </Card>

                  {/* Propostas Recentes */}
                  {proposals.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">Propostas Recentes</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {proposals.slice(0, 3).map((proposal) => (
                          <div 
                            key={proposal.id} 
                            className="flex items-center justify-between p-2 border rounded-lg text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => setSelectedProposal(proposal as unknown as Proposal)}
                          >
                            <div>
                              <p className="font-medium">{proposal.code || `#${proposal.id.slice(0, 8)}`}</p>
                              <p className="text-xs text-muted-foreground">{formatDate(proposal.created_at || '')}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-right">
                                <p className="font-semibold text-success">{formatCurrency(proposal.total_value)}</p>
                                <StatusBadge {...proposalStatusBadge(proposal.status as ProposalStatus)} />
                              </div>
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Every sale of this client, active and cancelled alike —
                      the point is the full history, so it is never truncated. */}
                  {sales.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center justify-between gap-2">
                          <span>Vendas</span>
                          <span className="text-xs font-normal text-muted-foreground">
                            {formatOperationalUnits(sumOperationalSaleUnits(sales))} no total · todos os estados
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 max-h-[420px] overflow-y-auto">
                        {sales.map((sale) => (
                          <div key={sale.id} className="flex items-center justify-between p-2 border rounded-lg text-sm">
                            <div className="min-w-0">
                              <p className="font-medium truncate">{sale.code || `#${sale.id.slice(0, 8)}`}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatDate(sale.created_at || '')}
                                {isTelecom && !!sale.total_cartoes && ` · ${sale.total_cartoes} cartõe${sale.total_cartoes === 1 ? '' : 's'}`}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-semibold text-success">{formatCurrency(sale.total_value)}</p>
                              {isTelecom && sale.telecom_status ? (
                                <Badge variant="outline" className={cn('text-[10px]', TELECOM_STATUS_COLORS[sale.telecom_status as TelecomStatus])}>
                                  {TELECOM_STATUS_LABELS[sale.telecom_status as TelecomStatus]}
                                </Badge>
                              ) : (
                                <StatusBadge {...saleStatusBadge(sale.status as SaleStatus)} />
                              )}
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Botão Voltar */}
                  <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
                    Voltar
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Add Communication Modal */}
        <AddCommunicationModal
          open={showAddCommunication}
          onOpenChange={setShowAddCommunication}
          clientId={client.id}
          clientName={client.name}
          defaultType={defaultCommType}
          defaultDirection={defaultCommDirection}
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
