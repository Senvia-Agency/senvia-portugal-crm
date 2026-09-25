import { useState, useEffect, useMemo } from "react";
import { isPerfect2GetherOrg } from "@/lib/perfect2gether";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePersistedState } from "@/hooks/usePersistedState";
import { usePermissions } from "@/hooks/usePermissions";

import { ResponsiveKanban } from "@/components/leads/ResponsiveKanban";
import { LeadsTableView } from "@/components/leads/LeadsTableView";
import { LeadDetailsModal } from "@/components/leads/LeadDetailsModal";
import { AddLeadModal } from "@/components/leads/AddLeadModal";
import { ImportLeadsDialog } from "@/components/leads/ImportLeadsDialog";
import { ImportsHistoryDialog } from "@/components/leads/ImportsHistoryDialog";
import { CreateEventModal } from "@/components/calendar/CreateEventModal";
import { EventDetailsModal } from "@/components/calendar/EventDetailsModal";
import { CreateProposalModal } from "@/components/proposals/CreateProposalModal";
import { ProposalDetailsModal } from "@/components/proposals/ProposalDetailsModal";
import { CreateClientModal } from "@/components/clients/CreateClientModal";
import { CreateSaleModal } from "@/components/sales/CreateSaleModal";
import { LostLeadDialog } from "@/components/leads/LostLeadDialog";

import { TeamMemberFilter } from "@/components/dashboard/TeamMemberFilter";
import { SlidersHorizontal } from "lucide-react";
import { BulkActionsBar } from "@/components/shared/BulkActionsBar";
import { AssignTeamMemberModal } from "@/components/shared/AssignTeamMemberModal";
import { useAuth } from "@/contexts/AuthContext";
import { useProposals } from "@/hooks/useProposals";
import { useCalendarEvents } from "@/hooks/useCalendarEvents";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import type { Proposal } from "@/types/proposals";
import type { CalendarEvent } from "@/types/calendar";
import { useLeads, useUpdateLeadStatus, useDeleteLead, useUpdateLead, useArchivedLeads, useArchiveLeads, useUnarchiveLeads, useArchiveLeadsByStage } from "@/hooks/useLeads";
import { ArchiveByStageDialog } from "@/components/leads/ArchiveByStageDialog";
import { useClients, useConvertLeadToClient } from "@/hooks/useClients";
import { useLeadsRealtime, useProposalsRealtime } from "@/hooks/useRealtimeSubscription";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Users, Loader2, X, Plus, LayoutGrid, List, Zap, BarChart3, Upload, History, Archive, Layers, CheckSquare } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format, endOfDay, startOfDay } from "date-fns";
import { matchesSearch } from "@/lib/utils";
import { mapLeadsForExport, exportToCsv, exportToExcel } from "@/lib/export";
import { toast } from "sonner";
import type { Lead, LeadTemperature, LeadTipologia } from "@/types";
import { TIPOLOGIA_LABELS } from "@/types";
import { LeadsReportPanel } from "@/components/leads/LeadsReportPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useModules } from "@/hooks/useModules";

export default function Leads() {
  // Subscribe to realtime updates
  useLeadsRealtime();
  useProposalsRealtime();
  const { user, profile, organization } = useAuth();
  const { isAdmin } = usePermissions();
  const { data: leads = [], isLoading } = useLeads();
  const { data: proposals = [] } = useProposals();
  const { data: clients = [] } = useClients();
  const { data: calendarEvents = [] } = useCalendarEvents();
  const { data: stages = [] } = usePipelineStages();
  const updateStatus = useUpdateLeadStatus();
  const deleteLead = useDeleteLead();
  const updateLead = useUpdateLead();
  const convertLeadToClient = useConvertLeadToClient();
  const archiveLeads = useArchiveLeads();
  const unarchiveLeads = useUnarchiveLeads();
  const archiveByStage = useArchiveLeadsByStage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isImportsHistoryOpen, setIsImportsHistoryOpen] = useState(false);
  const [isCreateEventModalOpen, setIsCreateEventModalOpen] = useState(false);
  // Etapa para onde a lead vai QUANDO o evento for mesmo criado. Guardada aqui
  // porque a confirmacao acontece no modal, noutro momento do que o arrasto.
  const [pendingScheduleStatus, setPendingScheduleStatus] = useState<string | null>(null);
  const [isCreateProposalModalOpen, setIsCreateProposalModalOpen] = useState(false);
  const [isProposalDetailsModalOpen, setIsProposalDetailsModalOpen] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [isEventDetailsModalOpen, setIsEventDetailsModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [pendingLead, setPendingLead] = useState<Lead | null>(null);
  
  // Auto-open lead details from URL param (e.g. "Ver ficha completa" na Inbox).
  useEffect(() => {
    const leadId = searchParams.get("lead");
    if (leadId && leads.length > 0) {
      const lead = leads.find((l) => l.id === leadId);
      if (lead) {
        setSelectedLead(lead);
        setIsModalOpen(true);
      }
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, leads]);

  // Lost lead dialog state
  const [isLostDialogOpen, setIsLostDialogOpen] = useState(false);
  const [pendingLostStatus, setPendingLostStatus] = useState<{ leadId: string; status: string } | null>(null);
  const queryClient = useQueryClient();
  
  // New states for the chained client -> proposal flow
  const [isCreateClientModalOpen, setIsCreateClientModalOpen] = useState(false);
  const [newlyCreatedClientId, setNewlyCreatedClientId] = useState<string | null>(null);
  const [isChainedFlow, setIsChainedFlow] = useState(false);
  const [isCreateSaleModalOpen, setIsCreateSaleModalOpen] = useState(false);
  const [prefillSaleClientId, setPrefillSaleClientId] = useState<string | null>(null);
  const [prefillProposalClientId, setPrefillProposalClientId] = useState<string | null>(null);
  const [prefillSaleClient, setPrefillSaleClient] = useState<{
    id: string;
    name: string;
    code?: string | null;
    email?: string | null;
    nif?: string | null;
    address_line1?: string | null;
    city?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null>(null);
  const [pendingWonData, setPendingWonData] = useState<{ leadId: string; status: string } | null>(null);
  const [searchQuery, setSearchQuery] = usePersistedState("leads-search-v1", "");
  const [statusFilter, setStatusFilter] = usePersistedState<string[]>("leads-status-v1", []);
  const [dateRange, setDateRange] = usePersistedState<{ from?: Date; to?: Date }>("leads-daterange-v1", { from: undefined, to: undefined });
  const isTelecom = organization?.niche === 'telecom';
  const { modules } = useModules();
  const showEnergy = isTelecom && modules.energy;
  const [tipologiaFilter, setTipologiaFilter] = usePersistedState<'all' | LeadTipologia>('leads-tipologia-v1', 'all');
  // The filter block opens under the pinned title row on demand; remembered.
  const [leadsFiltersOpen, setLeadsFiltersOpen] = usePersistedState<boolean>('leads-filters-open-v1', false);
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>(() => {
    const saved = localStorage.getItem('leads-view-mode');
    return (saved === 'table' || saved === 'kanban') ? saved : 'kanban';
  });
  const [activeTab, setActiveTab] = useState<'pipeline' | 'report'>('pipeline');

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);

  // Archiving
  const [showArchived, setShowArchived] = useState(false);
  const [isArchiveByStageOpen, setIsArchiveByStageOpen] = useState(false);
  const { data: archivedLeads = [], isLoading: archivedLoading } = useArchivedLeads(showArchived);
  const baseLeads = showArchived ? archivedLeads : leads;
  // Archived view forces the table layout (Kanban doesn't apply to archived).
  const effectiveViewMode = showArchived ? 'table' : viewMode;

  // Persist view mode preference
  useEffect(() => {
    localStorage.setItem('leads-view-mode', viewMode);
  }, [viewMode]);

  // Keep selectedLead synchronized with updated data from query
  useEffect(() => {
    if (selectedLead && leads.length > 0) {
      const updatedLead = leads.find(l => l.id === selectedLead.id);
      if (updatedLead) {
        setSelectedLead(updatedLead);
      }
    }
  }, [leads]);

  const toggleStatus = (status: string) => {
    setStatusFilter(prev => 
      prev.includes(status) 
        ? prev.filter(s => s !== status) 
        : [...prev, status]
    );
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter([]);
    setDateRange({ from: undefined, to: undefined });
  };

  // Clear selection when filters change or when switching active/archived view
  useEffect(() => {
    setSelectedIds([]);
  }, [searchQuery, statusFilter, dateRange, showArchived]);

  // Count of ACTIVE leads per stage (for the "Archive by stage" dialog)
  const activeCountsByStage = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of leads) m[l.status || ''] = (m[l.status || ''] || 0) + 1;
    return m;
  }, [leads]);

  const hasActiveFilters = searchQuery || statusFilter.length > 0 || dateRange.from || dateRange.to;

  const filteredLeads = useMemo(() => {
    const fromDate = dateRange.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange.to ? endOfDay(dateRange.to) : null;

    return baseLeads.filter(lead => {
      // 1. Pesquisa accent-insensitive e por tokens fora de ordem
      const matchesSearchTerm = matchesSearch(searchQuery, lead.name, lead.email, lead.phone);

      // 2. Filtro de status
      const matchesStatus = statusFilter.length === 0 ||
        statusFilter.includes(lead.status || '');

      // 3. Filtro de data
      const leadDate = lead.created_at ? new Date(lead.created_at) : null;
      const matchesDate =
        (!fromDate || (leadDate && leadDate >= fromDate)) &&
        (!toDate || (leadDate && leadDate <= toDate));

      const matchesTipologia = tipologiaFilter === 'all' || lead.tipologia === tipologiaFilter;

      return matchesSearchTerm && matchesStatus && matchesDate && matchesTipologia;
    });
  }, [baseLeads, searchQuery, statusFilter, dateRange, tipologiaFilter]);

  // Check if a stage is of a special type (scheduled or proposal-like)
  const isScheduledStage = (stageKey: string) => {
    const stage = stages.find(s => s.key === stageKey);
    // Check if the stage name contains keywords that indicate it's a scheduling stage
    const scheduledKeywords = ['agendado', 'scheduled', 'reunião', 'meeting', 'consulta'];
    return stage && scheduledKeywords.some(kw => stage.name.toLowerCase().includes(kw));
  };

  const isProposalStage = (stageKey: string) => {
    const stage = stages.find(s => s.key === stageKey);
    const proposalKeywords = ['proposta', 'proposal', 'orçamento', 'quote'];
    return stage && proposalKeywords.some(kw => stage.name.toLowerCase().includes(kw));
  };

  // Check if a status is final (won/lost)
  const isFinalStatus = (status: string) => {
    const stage = stages.find(s => s.key === status);
    return stage?.is_final_positive || stage?.is_final_negative || false;
  };

  const isLostStage = (stageKey: string) => {
    const stage = stages.find(s => s.key === stageKey);
    if (stage?.is_final_negative) return true;
    const lostKeywords = ['perdido', 'lost', 'cancelado', 'cancelled'];
    return stage && lostKeywords.some(kw => stage.name.toLowerCase().includes(kw));
  };

  const isWonStage = (stageKey: string) => {
    const stage = stages.find(s => s.key === stageKey);
    if (stage?.is_final_positive) return true;
    const wonKeywords = ['ganho', 'won', 'fechado', 'closed'];
    return stage && wonKeywords.some(kw => stage.name.toLowerCase().includes(kw));
  };

  const handleStatusChange = (leadId: string, newStatus: string) => {
    const lead = leads.find(l => l.id === leadId);
    
    // Block status change on final leads for non-admins
    if (lead && isFinalStatus(lead.status || '')) {
      if (!isAdmin) {
        toast.error('Apenas administradores podem alterar o estado de leads finalizadas.');
        return;
      }
    }
    
    // Intercept drops on scheduling stages -> open event modal (create or view existing)
    if (isScheduledStage(newStatus)) {
      // Check if lead already has a pending/active event
      const existingEvent = calendarEvents.find(
        e => e.lead_id === leadId && e.status !== 'cancelled' && e.status !== 'completed'
      );

      if (existingEvent) {
        // If the lead already has an event, we still want the drop action
        // to actually move the lead to the chosen stage.
        if (!lead || lead.status !== newStatus) {
          updateStatus.mutate({ leadId, status: newStatus });
        }

        // Open event details modal
        setSelectedEvent(existingEvent);
        setIsEventDetailsModalOpen(true);
      } else {
        // Open create event modal. The status only moves once the event really
        // exists — see handleEventCreated. Moving it here would leave the lead
        // in "Agendado" without a meeting if the agent closes the modal.
        setPendingLead(lead || null);
        setPendingScheduleStatus(newStatus);
        setIsCreateEventModalOpen(true);
      }
      return;
    }
    
    // Intercept drops on proposal stages -> open client modal first (then proposal)
    if (isProposalStage(newStatus)) {
      // Check if lead already has a proposal (by lead_id)
      const existingProposal = proposals.find(p => p.lead_id === leadId);
      
      if (existingProposal) {
        // Open edit modal
        setSelectedProposal(existingProposal);
        setIsProposalDetailsModalOpen(true);
        // Also update status
        updateStatus.mutate({ leadId, status: newStatus });
        return;
      }
      
      // Check if lead already has a client
      const existingClient = clients.find(c => c.lead_id === leadId);
      
      if (existingClient) {
        // Check for proposals linked to this client (fallback)
        const clientProposal = proposals.find(p => p.client_id === existingClient.id);
        
        if (clientProposal) {
          // Open existing proposal details
          setSelectedProposal(clientProposal);
          setIsProposalDetailsModalOpen(true);
          updateStatus.mutate({ leadId, status: newStatus });
        } else {
          // Client exists but no proposal - go directly to create proposal
          setPendingLead(lead || null);
          setNewlyCreatedClientId(existingClient.id);
          setIsCreateProposalModalOpen(true);
        }
        return;
      }
      
      // No client exists - open create client modal first
      setPendingLead(lead || null);
      setIsCreateClientModalOpen(true);
      return;
    }
    
    // Intercept drops on lost stages -> open lost lead dialog
    if (isLostStage(newStatus)) {
      setPendingLostStatus({ leadId, status: newStatus });
      setPendingLead(lead || null);
      setIsLostDialogOpen(true);
      return;
    }

    // Intercept drops on won stages -> auto-create client + open sale modal
    if (isWonStage(newStatus) && lead) {
      const isPerfect2Gether = isPerfect2GetherOrg(organization?.id);
      setPendingWonData({ leadId, status: newStatus });
      const existingClient = clients.find(c => c.lead_id === leadId || (lead.company_nif && c.company_nif === lead.company_nif));

      if (isPerfect2Gether) {
        // Perfect2Gether custom flow
        if (existingClient) {
          // Already a client → mark won immediately + open proposal modal
          updateStatus.mutate({ leadId, status: newStatus });
          setPendingWonData(null);
          toast.success('Lead ganha! Cliente já existente — criar proposta.');
          setPrefillProposalClientId(existingClient.id);
          setNewlyCreatedClientId(existingClient.id);
          setIsCreateProposalModalOpen(true);
        } else {
          // Not a client → create client → navigate to client page
          convertLeadToClient.mutate({
            lead_id: leadId,
            name: (lead.name && lead.name !== lead.company_name)
              ? lead.name
              : (lead.company_name || lead.name || 'Sem nome'),
            email: lead.email,
            phone: lead.phone,
            company: lead.company_name || undefined,
            company_nif: lead.company_nif || undefined,
            notes: lead.notes || undefined,
          }, {
            onSuccess: (newClient) => {
              updateStatus.mutate({ leadId, status: newStatus });
              setPendingWonData(null);
              toast.success('Lead ganha! Novo cliente criado.');
              if (newClient?.id) {
                navigate('/clients', { state: { openClientId: newClient.id } });
              }
            },
          });
        }
        return;
      }

      // Default flow for all other orgs
      if (existingClient) {
        toast.success('Lead ganha! Cliente já existente.');
        setPrefillSaleClientId(existingClient.id);
        setPrefillSaleClient({
          id: existingClient.id,
          name: existingClient.name,
          code: existingClient.code,
          email: existingClient.email,
          nif: existingClient.nif,
          address_line1: existingClient.address_line1,
          city: existingClient.city,
          postal_code: existingClient.postal_code,
          country: existingClient.country,
        });
        setIsCreateSaleModalOpen(true);
      } else {
        convertLeadToClient.mutate({
          lead_id: leadId,
          name: (lead.name && lead.name !== lead.company_name) 
            ? lead.name 
            : (lead.company_name || lead.name || 'Sem nome'),
          email: lead.email,
          phone: lead.phone,
          company: lead.company_name || undefined,
          company_nif: lead.company_nif || undefined,
          notes: lead.notes || undefined,
        }, {
          onSuccess: (newClient) => {
            toast.success('Lead ganha! Novo cliente criado.');
            if (newClient?.id) {
              setPrefillSaleClientId(newClient.id);
              setPrefillSaleClient({
                id: newClient.id,
                name: newClient.name,
                code: newClient.code,
                email: newClient.email,
                nif: newClient.nif,
                address_line1: newClient.address_line1,
                city: newClient.city,
                postal_code: newClient.postal_code,
                country: newClient.country,
              });
              setIsCreateSaleModalOpen(true);
            }
          },
        });
      }
      return;
    }
    
    // For other statuses, update normally
    updateStatus.mutate({ leadId, status: newStatus });
  };

  const handleEventCreated = () => {
    // O estado NÃO é atualizado por ninguém automaticamente: useCreateEvent só
    // insere o evento e invalida a query das leads, o que apenas volta a buscar
    // o mesmo estado. Também não existe trigger em calendar_events que mexa nas
    // leads (confirmado na base de dados). Sem esta linha, arrastar para
    // "Agendado" criava a reunião e deixava a lead na coluna anterior.
    if (pendingScheduleStatus && pendingLead) {
      updateStatus.mutate({ leadId: pendingLead.id, status: pendingScheduleStatus });
    }
    setPendingScheduleStatus(null);
    setPendingLead(null);
    setSelectedEvent(null);
    setIsCreateEventModalOpen(false);
  };

  const handleLostConfirm = (data: {
    lossReason: string;
    notes: string;
    followUpDate: string;
    followUpTime: string;
    eventType: "call" | "meeting";
    scheduleFollowUp: boolean;
    reminderMinutes: number | null;
  }) => {
    if (!pendingLostStatus || !pendingLead) return;

    const LOSS_REASON_LABELS: Record<string, string> = {
      price: "Preço",
      competition: "Concorrência",
      no_response: "Sem resposta",
      timing: "Timing",
      other: "Outro",
    };

    // Build notes with loss reason
    const reasonLabel = LOSS_REASON_LABELS[data.lossReason] || data.lossReason;
    const lossNote = `[Perdido - ${reasonLabel}]${data.notes ? ` ${data.notes}` : ""}`;
    const existingNotes = pendingLead.notes || "";
    const updatedNotes = existingNotes ? `${existingNotes}\n${lossNote}` : lossNote;

    // Update lead notes always
    updateLead.mutate({ leadId: pendingLostStatus.leadId, updates: { notes: updatedNotes } });

    // Only mark as lost if NO follow-up is scheduled; otherwise move to "Agendado"
    if (!data.followUpDate) {
      updateStatus.mutate({ leadId: pendingLostStatus.leadId, status: pendingLostStatus.status });
    } else {
      const scheduledStage = stages?.find(s => isScheduledStage(s.key));
      if (scheduledStage) {
        updateStatus.mutate({ leadId: pendingLostStatus.leadId, status: scheduledStage.key });
      } else {
        // Fallback: no scheduled stage exists, mark as lost anyway
        updateStatus.mutate({ leadId: pendingLostStatus.leadId, status: pendingLostStatus.status });
      }
    }

    // Create follow-up calendar event only if requested
    if (data.followUpDate && user && organization) {
      const followUpDate = new Date(`${data.followUpDate}T${data.followUpTime}:00`);
      
      supabase
        .from('calendar_events')
        .insert({
          title: `Recontacto: ${pendingLead.name}`,
          description: `Follow-up de lead perdido (${reasonLabel}). ${data.notes || ""}`.trim(),
          event_type: data.eventType,
          start_time: followUpDate.toISOString(),
          lead_id: pendingLead.id,
          user_id: user!.id,
          organization_id: organization!.id,
          reminder_minutes: data.reminderMinutes,
        })
        .select()
        .single()
        .then(({ error }) => {
          if (error) {
            toast.error('Erro ao criar agendamento de recontacto');
            console.error('Error creating follow-up event:', error);
          } else {
            toast.success('Recontacto agendado com sucesso');
            queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
            queryClient.invalidateQueries({ queryKey: ['lead-events'] });
          }
        });
    }
    setIsLostDialogOpen(false);
    setPendingLostStatus(null);
    setPendingLead(null);
  };

  const handleEditEvent = () => {
    // Close details modal and open create/edit modal
    setIsEventDetailsModalOpen(false);
    setIsCreateEventModalOpen(true);
  };

  const handleProposalCreated = () => {
    if (pendingLead && !prefillProposalClientId) {
      // Normal proposal stage flow (not Perfect2Gether won flow)
      const proposalStage = stages.find(s => isProposalStage(s.key));
      if (proposalStage) {
        updateStatus.mutate({ leadId: pendingLead.id, status: proposalStage.key });
      }
    }
    setPendingLead(null);
    setNewlyCreatedClientId(null);
    setPrefillProposalClientId(null);
    setIsChainedFlow(false);
    setIsCreateProposalModalOpen(false);
  };

  // Handler for when client is created in the chained flow (Lead -> Client -> Proposal)
  const handleClientCreatedForProposal = (clientId: string) => {
    // Mark that we're in a chained flow (preserve pendingLead)
    setIsChainedFlow(true);
    // Close client modal
    setIsCreateClientModalOpen(false);
    // Store the new client ID
    setNewlyCreatedClientId(clientId);
    // Open proposal modal
    setIsCreateProposalModalOpen(true);
  };

  const handleTemperatureChange = (leadId: string, temperature: LeadTemperature) => {
    updateLead.mutate({ leadId, updates: { temperature } });
  };

  const handleViewDetails = (lead: Lead) => {
    setSelectedLead(lead);
    setIsModalOpen(true);
  };

  const handleDelete = (leadId: string) => {
    deleteLead.mutate(leadId);
  };

  const handleUpdate = (leadId: string, updates: Partial<Lead>) => {
    updateLead.mutate({ leadId, updates });
  };

  const handleAssignSuccess = () => {
    setSelectedIds([]);
    setShowAssignModal(false);
  };

  // Export handlers
  const handleExportCsv = () => {
    const selectedLeads = filteredLeads.filter(l => selectedIds.includes(l.id));
    const data = mapLeadsForExport(selectedLeads);
    exportToCsv(data, `leads_${format(new Date(), 'yyyy-MM-dd')}`);
    toast.success(`${selectedLeads.length} leads exportados para CSV`);
  };

  const handleExportExcel = () => {
    const selectedLeads = filteredLeads.filter(l => selectedIds.includes(l.id));
    const data = mapLeadsForExport(selectedLeads);
    exportToExcel(data, `leads_${format(new Date(), 'yyyy-MM-dd')}`);
    toast.success(`${selectedLeads.length} leads exportados para Excel`);
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    const { error } = await supabase.from("leads").delete().in("id", ids);
    if (error) {
      toast.error("Erro ao apagar leads: " + error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    queryClient.invalidateQueries({ queryKey: ["leads-archived"] });
    toast.success(`${ids.length} leads apagados`);
    setSelectedIds([]);
  };

  const handleBulkArchive = async () => {
    await archiveLeads.mutateAsync([...selectedIds]);
    setSelectedIds([]);
  };

  const handleBulkRestore = async () => {
    await unarchiveLeads.mutateAsync([...selectedIds]);
    setSelectedIds([]);
  };

  const handleArchiveOne = (leadId: string) => {
    archiveLeads.mutate([leadId]);
  };

  const handleArchiveByStage = async (stageKey: string) => {
    await archiveByStage.mutateAsync(stageKey);
    setIsArchiveByStageOpen(false);
  };

  // Helper to get badge style from stage color
  const getBadgeStyle = (hexColor: string, isActive: boolean) => {
    if (isActive) {
      return {
        backgroundColor: hexColor,
        color: '#fff',
        borderColor: hexColor,
      };
    }
    return {
      backgroundColor: 'transparent',
      color: hexColor,
      borderColor: `${hexColor}50`,
    };
  };

  const leadFilterControls = (
    <div className="space-y-4">
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Período</span>
        <DateRangePicker
          value={dateRange.from ? { from: dateRange.from, to: dateRange.to } : undefined}
          onChange={(range) => setDateRange({ from: range?.from, to: range?.to })}
          placeholder="Todo o histórico"
          className="w-full"
        />
      </div>
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Vendedor</span>
        <TeamMemberFilter className="w-full" />
      </div>
      <div className="space-y-1">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">Estado</span>
        <div className="flex flex-wrap gap-1.5">
          {stages.map((stage) => (
            <Badge
              key={stage.id}
              variant="outline"
              className="cursor-pointer transition-colors hover:opacity-80 text-xs"
              style={getBadgeStyle(stage.color, statusFilter.includes(stage.key))}
              onClick={() => toggleStatus(stage.key)}
            >
              {stage.name}
            </Badge>
          ))}
        </div>
      </div>
      {showEnergy && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Tipologia</span>
          <Select value={tipologiaFilter} onValueChange={(v) => setTipologiaFilter(v as 'all' | LeadTipologia)}>
            <SelectTrigger className="h-9 w-full">
              <Zap className="h-3.5 w-3.5 mr-1" />
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {(Object.entries(TIPOLOGIA_LABELS) as [LeadTipologia, string][]).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 px-0 text-muted-foreground hover:text-foreground">
          <X className="mr-1 h-3.5 w-3.5" />Limpar filtros
        </Button>
      )}
    </div>
  );

  return (
    <div className="p-4 lg:p-8">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'pipeline' | 'report')} className="space-y-4">
        <div className="space-y-4 border-b border-border/70 bg-background pb-4">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Gestão comercial</p>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-semibold tracking-tight md:text-[2.1rem]">Leads</h1>
                <Badge variant="secondary" className="text-xs font-medium">
                  {hasActiveFilters ? `${filteredLeads.length} / ${baseLeads.length}` : baseLeads.length}
                </Badge>
                {showArchived && <Badge variant="outline" className="border-amber-500/40 text-xs font-medium text-amber-600">Arquivadas</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Gira os contactos e acompanha o progresso do seu pipeline.</p>
            </div>
            {activeTab === 'pipeline' && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="hidden items-center rounded-lg border border-border bg-background p-1 sm:flex">
                  <Button variant={viewMode === 'kanban' ? 'secondary' : 'ghost'} size="icon" className="h-7 w-7" onClick={() => setViewMode('kanban')} aria-label="Vista Kanban"><LayoutGrid className="h-4 w-4" /></Button>
                  <Button variant={viewMode === 'table' ? 'secondary' : 'ghost'} size="icon" className="h-7 w-7" onClick={() => setViewMode('table')} aria-label="Vista de tabela"><List className="h-4 w-4" /></Button>
                </div>
                <Button variant="outline" data-otto-target="leads-import-btn" onClick={() => setIsImportModalOpen(true)} className="h-9 lg:h-10"><Upload className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Importar</span></Button>
                <Button variant="outline" onClick={() => setIsImportsHistoryOpen(true)} className="h-9 lg:h-10" title="Histórico de importações"><History className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Histórico</span></Button>
                <Button onClick={() => setIsAddModalOpen(true)} className="h-9 lg:h-10"><Plus className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Adicionar</span></Button>
                {!showArchived && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="outline" className="h-9 lg:h-10" title="Arquivar leads"><Archive className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Arquivar</span></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onClick={() => setIsArchiveByStageOpen(true)}><Layers className="mr-2 h-4 w-4" />Arquivar leads de um estado</DropdownMenuItem>
                      <DropdownMenuItem disabled={selectedIds.length === 0} onClick={handleBulkArchive}><CheckSquare className="mr-2 h-4 w-4" />Arquivar leads selecionados{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <Button variant={showArchived ? 'secondary' : 'outline'} onClick={() => setShowArchived(v => !v)} className="h-9 lg:h-10" title={showArchived ? 'Voltar às leads ativas' : 'Ver leads arquivadas'}><Archive className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">{showArchived ? 'Ver ativas' : 'Arquivadas'}</span></Button>
              </div>
            )}
          </header>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList className="h-10 w-full justify-start sm:w-auto">
              <TabsTrigger value="pipeline" className="gap-1"><LayoutGrid className="h-3.5 w-3.5" />Pipeline</TabsTrigger>
              <TabsTrigger value="report" className="gap-1"><BarChart3 className="h-3.5 w-3.5" />Relatório</TabsTrigger>
            </TabsList>
          </div>
        </div>

        {activeTab === 'pipeline' && (
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Pesquisar por nome, email ou telefone..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-10 border-primary/35 bg-primary/[0.04] pl-10 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-primary/25" />
          </div>
        )}

        <TabsContent value="pipeline" className="mt-0">
          <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[252px_minmax(0,1fr)]">
            <div className="space-y-3">
              <aside className="hidden rounded-xl border border-border/70 bg-card p-3 lg:sticky lg:top-4 lg:block lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="h-4 w-4 text-primary" />Filtros</h2>
                {leadFilterControls}
              </aside>
              <div className="lg:hidden">
                <Accordion type="single" collapsible value={leadsFiltersOpen ? 'lead-filters' : ''} onValueChange={(value) => setLeadsFiltersOpen(!!value)} className="rounded-xl border border-border/70 bg-card px-3">
                  <AccordionItem value="lead-filters" className="border-0">
                    <AccordionTrigger className="py-3 text-sm font-semibold hover:no-underline"><span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-primary" />Filtros{hasActiveFilters ? ' •' : ''}</span></AccordionTrigger>
                    <AccordionContent className="pb-3">{leadFilterControls}</AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            </div>
            <div className="min-w-0">
        {/* Bulk Actions Bar */}
        {effectiveViewMode === 'table' && (
          <BulkActionsBar
            selectedCount={selectedIds.length}
            onAssignTeamMember={() => setShowAssignModal(true)}
            onExportCsv={handleExportCsv}
            onExportExcel={handleExportExcel}
            onDelete={handleBulkDelete}
            onRestore={showArchived ? handleBulkRestore : undefined}
            onClearSelection={() => setSelectedIds([])}
            entityLabel="leads selecionados"
          />
        )}

        <div className="rounded-xl border bg-card p-3 lg:p-4">
          {(showArchived ? archivedLoading : isLoading) ? (
            <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : filteredLeads.length === 0 && searchQuery ? (
            <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
              <Search className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">Nenhum resultado encontrado</p>
            </div>
          ) : filteredLeads.length === 0 ? (
            showArchived ? (
              <EmptyState icon={Users} title="Sem leads arquivadas" />
            ) : (
              <EmptyState
                icon={Users}
                title="Ainda não tens leads"
                description="Importa os teus contactos ou cria a primeira lead. O Otto pode ajudar-te a começar."
              >
                <Button onClick={() => setIsAddModalOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Criar primeira lead
                </Button>
                <Button variant="outline" onClick={() => setIsImportModalOpen(true)}>
                  <Upload className="h-4 w-4 mr-2" />
                  Importar
                </Button>
              </EmptyState>
            )
          ) : effectiveViewMode === 'kanban' ? (
            <ResponsiveKanban leads={filteredLeads} onStatusChange={handleStatusChange} onTemperatureChange={handleTemperatureChange} onViewDetails={handleViewDetails} onDelete={handleDelete} onArchive={handleArchiveOne} />
          ) : (
            <LeadsTableView 
              leads={filteredLeads} 
              onStatusChange={handleStatusChange} 
              onTemperatureChange={handleTemperatureChange} 
              onViewDetails={handleViewDetails} 
              onDelete={handleDelete}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
            />
          )}
        </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="report" className="mt-0">
          <LeadsReportPanel />
        </TabsContent>

        <LeadDetailsModal lead={selectedLead} open={isModalOpen} onOpenChange={setIsModalOpen} onStatusChange={handleStatusChange} onDelete={handleDelete} onUpdate={handleUpdate} />
        <AddLeadModal open={isAddModalOpen} onOpenChange={setIsAddModalOpen} />
        <ImportLeadsDialog open={isImportModalOpen} onOpenChange={setIsImportModalOpen} />
        <ImportsHistoryDialog open={isImportsHistoryOpen} onOpenChange={setIsImportsHistoryOpen} />
        <ArchiveByStageDialog
          open={isArchiveByStageOpen}
          onOpenChange={setIsArchiveByStageOpen}
          stages={stages}
          counts={activeCountsByStage}
          onConfirm={handleArchiveByStage}
          isPending={archiveByStage.isPending}
        />
        
        <EventDetailsModal
          open={isEventDetailsModalOpen}
          onOpenChange={(open) => {
            setIsEventDetailsModalOpen(open);
            if (!open) setSelectedEvent(null);
          }}
          event={selectedEvent}
          onEdit={handleEditEvent}
        />
        
        <CreateEventModal
          open={isCreateEventModalOpen}
          onOpenChange={(open) => {
            setIsCreateEventModalOpen(open);
            if (!open) {
              // Fechar sem criar não deve mover a lead: fica onde estava.
              setPendingScheduleStatus(null);
              setPendingLead(null);
              setSelectedEvent(null);
            }
          }}
          selectedDate={new Date()}
          preselectedLeadId={pendingLead?.id || selectedEvent?.lead_id}
          event={selectedEvent}
          onSuccess={handleEventCreated}
        />
        
        <CreateClientModal
          open={isCreateClientModalOpen}
          onOpenChange={(open) => {
            setIsCreateClientModalOpen(open);
            if (!open && !isChainedFlow) {
              setPendingLead(null);
            }
          }}
          onCreated={handleClientCreatedForProposal}
          initialData={pendingLead ? {
            name: pendingLead.name,
            email: pendingLead.email,
            phone: pendingLead.phone,
            notes: pendingLead.notes || undefined,
            source: "lead",
            leadId: pendingLead.id,
          } : undefined}
        />
        
        <CreateProposalModal
          open={isCreateProposalModalOpen}
          onOpenChange={(open) => {
            setIsCreateProposalModalOpen(open);
            if (!open) {
              setPendingLead(null);
              setNewlyCreatedClientId(null);
              setIsChainedFlow(false);
            }
          }}
          onSuccess={handleProposalCreated}
          preselectedClientId={newlyCreatedClientId}
          leadId={pendingLead?.id}
        />
        
        <ProposalDetailsModal
          proposal={selectedProposal}
          open={isProposalDetailsModalOpen && !!selectedProposal}
          onOpenChange={(open) => {
            setIsProposalDetailsModalOpen(open);
            if (!open) setSelectedProposal(null);
          }}
        />

        <AssignTeamMemberModal
          open={showAssignModal}
          onOpenChange={setShowAssignModal}
          selectedIds={selectedIds}
          entityType="leads"
          onSuccess={handleAssignSuccess}
        />

        <LostLeadDialog
          open={isLostDialogOpen}
          onOpenChange={(open) => {
            setIsLostDialogOpen(open);
            if (!open) {
              setPendingLostStatus(null);
              setPendingLead(null);
            }
          }}
          leadName={pendingLead?.name || ""}
          isTelecom={isTelecom}
          onConfirm={handleLostConfirm}
        />

        <CreateSaleModal
          open={isCreateSaleModalOpen}
          onOpenChange={(open) => {
            setIsCreateSaleModalOpen(open);
            if (!open) {
              setPrefillSaleClientId(null);
              setPrefillSaleClient(null);
              setPendingWonData(null);
            }
          }}
          prefillClientId={prefillSaleClientId}
          prefillClient={prefillSaleClient}
          onSaleCreated={() => {
            if (pendingWonData) {
              updateStatus.mutate({ leadId: pendingWonData.leadId, status: pendingWonData.status });
              setPendingWonData(null);
            }
          }}
        />
      </Tabs>
    </div>
  );
}
