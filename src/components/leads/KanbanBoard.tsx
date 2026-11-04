import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { Lead, LeadTemperature } from "@/types";
import { LeadCard } from "./LeadCard";
import { cn } from "@/lib/utils";
import { usePipelineStages, PipelineStage } from "@/hooks/usePipelineStages";
import { useLeadProposalValues } from "@/hooks/useLeadProposalValues";
import { usePermissions } from "@/hooks/usePermissions";
import { useTeamMembers } from "@/hooks/useTeam";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/hooks/useModules";
import { formatCurrency } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useLanguage } from "@/i18n";

interface LeadEvent {
  id: string;
  title: string;
  start_time: string;
  event_type: string;
}

interface KanbanBoardProps {
  leads: Lead[];
  leadEvents?: Record<string, LeadEvent>;
  onStatusChange: (leadId: string, newStatus: string) => void;
  onTemperatureChange: (leadId: string, temperature: LeadTemperature) => void;
  onViewDetails: (lead: Lead) => void;
  onDelete: (leadId: string) => void;
  onArchive?: (leadId: string) => void;
}

interface KanbanColumnProps {
  /** The pipeline stage, or null for the orphan ("Sem Etapa") column. */
  stage: PipelineStage | null;
  columnLeads: Lead[];
  stages: PipelineStage[];
  leadEvents: Record<string, LeadEvent>;
  proposalValues?: Map<string, number>;
  /** user_id → name, for the assignee initials on each card. */
  memberNames: Map<string, string>;
  /** Money totals per column (off for the energy niche, where cards show kWh). */
  showTotals: boolean;
  isAdmin: boolean;
  draggedLead: string | null;
  isOver: boolean;
  isFinalStatus: (status: string) => boolean;
  onDragStart: (e: React.DragEvent, leadId: string) => void;
  onDragOver: (e: React.DragEvent, key: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, key: string) => void;
  onStatusChange: (leadId: string, newStatus: string) => void;
  onTemperatureChange: (leadId: string, temperature: LeadTemperature) => void;
  onViewDetails: (lead: Lead) => void;
  onDelete: (leadId: string) => void;
  onArchive?: (leadId: string) => void;
}

/**
 * A single Kanban column. Cards are window-virtualized so a stage with
 * thousands of leads keeps only the visible cards in the DOM.
 */
function KanbanColumn({
  stage,
  columnLeads,
  stages,
  leadEvents,
  proposalValues,
  memberNames,
  showTotals,
  isAdmin,
  draggedLead,
  isOver,
  isFinalStatus,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onStatusChange,
  onTemperatureChange,
  onViewDetails,
  onDelete,
  onArchive,
}: KanbanColumnProps) {
  const { t } = useLanguage();
  const isOrphan = stage === null;
  const dropKey = isOrphan ? "__orphan__" : stage.key;

  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const total = showTotals
    ? columnLeads.reduce((sum, lead) => sum + (proposalValues?.get(lead.id) || lead.value || 0), 0)
    : 0;

  const virtualizer = useWindowVirtualizer({
    count: columnLeads.length,
    estimateSize: () => 130,
    overscan: 6,
    scrollMargin,
    getItemKey: (index) => columnLeads[index]?.id ?? index,
  });

  useLayoutEffect(() => {
    const measure = () => {
      if (!listRef.current) return;
      const top = listRef.current.getBoundingClientRect().top + window.scrollY;
      setScrollMargin((prev) => (Math.abs(prev - top) > 1 ? top : prev));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });

  return (
    <div
      className={cn(
        "flex w-72 min-w-[288px] flex-col rounded-2xl bg-muted/50 transition-colors",
        isOver && "bg-primary/5 ring-2 ring-inset ring-primary/30"
      )}
      onDragOver={(e) => onDragOver(e, dropKey)}
      onDragLeave={onDragLeave}
      onDrop={isOrphan ? undefined : (e) => onDrop(e, dropKey)}
    >
      {/* Column header: colour dot, name, count and what the stage is worth. */}
      <div className="flex items-center gap-2 px-3.5 pb-2 pt-3">
        {isOrphan
          ? <AlertCircle className="h-3.5 w-3.5 shrink-0 text-orange-500" />
          : <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden="true" />}
        <h3 className="truncate text-sm font-semibold text-foreground">
          {isOrphan ? t("Sem etapa") : stage.name}
        </h3>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">{columnLeads.length}</span>
        {total > 0 && <span className="ml-auto truncate text-xs tabular-nums text-muted-foreground" title={t("Valor das leads desta etapa")}>{formatCurrency(total)}</span>}
      </div>

      {/* Cards Container (virtualized) */}
      <div className="flex-1 px-2 pb-2">
        {columnLeads.length === 0 ? (
          <div
            className={cn(
              "flex h-20 items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground",
              isOver && "border-primary bg-primary/5"
            )}
          >
            {isOver ? t("Largar aqui") : t("Sem leads")}
          </div>
        ) : (
          <div
            ref={listRef}
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const lead = columnLeads[item.index];
              if (!lead) return null;
              const draggable = !isFinalStatus(lead.status || "") || isAdmin;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
                  }}
                >
                  <div
                    className="pb-2"
                    draggable={draggable}
                    onDragStart={(e) => onDragStart(e, lead.id)}
                  >
                    <LeadCard
                      lead={lead}
                      proposalValue={proposalValues?.get(lead.id)}
                      upcomingEvent={leadEvents[lead.id]}
                      assigneeName={lead.assigned_to ? memberNames.get(lead.assigned_to) : null}
                      onStatusChange={onStatusChange}
                      onTemperatureChange={onTemperatureChange}
                      onViewDetails={onViewDetails}
                      onDelete={onDelete}
                      onArchive={onArchive}
                      isDragging={draggedLead === lead.id}
                      pipelineStages={stages}
                      isLocked={isFinalStatus(lead.status || "") && !isAdmin}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function KanbanBoard({ leads, leadEvents = {}, onStatusChange, onTemperatureChange, onViewDetails, onDelete, onArchive }: KanbanBoardProps) {
  const { t } = useLanguage();
  const { data: stages, isLoading: stagesLoading } = usePipelineStages();
  const { data: proposalValues } = useLeadProposalValues();
  const { isAdmin } = usePermissions();
  const { data: teamMembers = [] } = useTeamMembers();
  const memberNames = useMemo(() => new Map(teamMembers.map(member => [member.user_id, member.full_name])), [teamMembers]);
  const { organization } = useAuth();
  const { modules } = useModules();
  const showTotals = !(organization?.niche === 'telecom' && modules.energy);
  const [draggedLead, setDraggedLead] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const topScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);

  useEffect(() => {
    if (bottomScrollRef.current) {
      setScrollWidth(bottomScrollRef.current.scrollWidth);
    }
  }, [leads, stages]);

  const handleTopScroll = () => {
    if (topScrollRef.current && bottomScrollRef.current) {
      bottomScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  };

  const handleBottomScroll = () => {
    if (topScrollRef.current && bottomScrollRef.current) {
      topScrollRef.current.scrollLeft = bottomScrollRef.current.scrollLeft;
    }
  };

  const isFinalStatus = (status: string) => {
    const stage = stages?.find(s => s.key === status);
    return stage?.is_final_positive || stage?.is_final_negative || false;
  };

  const getLeadsByStatus = (statusKey: string) =>
    leads.filter(lead => lead.status === statusKey);

  // Get orphan leads (leads with status not matching any pipeline stage)
  const getOrphanLeads = () => {
    if (!stages) return [];
    const stageKeys = stages.map(s => s.key);
    return leads.filter(lead => !stageKeys.includes(lead.status || ''));
  };

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    // Block drag for leads in final stages if not admin
    const lead = leads.find(l => l.id === leadId);
    if (lead && isFinalStatus(lead.status || '') && !isAdmin) {
      e.preventDefault();
      return;
    }
    setDraggedLead(leadId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, statusKey: string) => {
    e.preventDefault();
    setDragOverColumn(statusKey);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, statusKey: string) => {
    e.preventDefault();
    if (draggedLead) {
      onStatusChange(draggedLead, statusKey);
    }
    setDraggedLead(null);
    setDragOverColumn(null);
  };

  if (stagesLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="w-72 min-w-[288px]">
            <Skeleton className="h-12 w-full mb-2" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full mt-2" />
          </div>
        ))}
      </div>
    );
  }

  if (!stages || stages.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <div className="text-center">
          <p className="text-lg font-medium">{t("Pipeline não configurado")}</p>
          <p className="text-sm">{t("Vá às Definições → Pipeline para configurar as etapas.")}</p>
        </div>
      </div>
    );
  }

  const orphanLeads = getOrphanLeads();

  return (
    <div className="flex flex-col">
      {/* Top scroll bar */}
      <div
        ref={topScrollRef}
        onScroll={handleTopScroll}
        className="overflow-x-auto overflow-y-hidden h-3 mb-2"
      >
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>

      {/* Kanban container */}
      <div
        ref={bottomScrollRef}
        onScroll={handleBottomScroll}
        className="flex gap-3 overflow-x-auto pb-6"
      >
        {/* Orphan Leads Column - Only show if there are orphans */}
        {orphanLeads.length > 0 && (
          <KanbanColumn
            stage={null}
            columnLeads={orphanLeads}
            stages={stages}
            leadEvents={leadEvents}
            proposalValues={proposalValues}
            memberNames={memberNames}
            showTotals={showTotals}
            isAdmin={isAdmin}
            draggedLead={draggedLead}
            isOver={dragOverColumn === '__orphan__'}
            isFinalStatus={isFinalStatus}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onStatusChange={onStatusChange}
            onTemperatureChange={onTemperatureChange}
            onViewDetails={onViewDetails}
            onDelete={onDelete}
            onArchive={onArchive}
          />
        )}

        {/* Regular Pipeline Columns */}
        {stages.map((stage) => (
          <KanbanColumn
            key={stage.id}
            stage={stage}
            columnLeads={getLeadsByStatus(stage.key)}
            stages={stages}
            leadEvents={leadEvents}
            proposalValues={proposalValues}
            memberNames={memberNames}
            showTotals={showTotals}
            isAdmin={isAdmin}
            draggedLead={draggedLead}
            isOver={dragOverColumn === stage.key}
            isFinalStatus={isFinalStatus}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onStatusChange={onStatusChange}
            onTemperatureChange={onTemperatureChange}
            onViewDetails={onViewDetails}
            onDelete={onDelete}
            onArchive={onArchive}
          />
        ))}
      </div>
    </div>
  );
}
