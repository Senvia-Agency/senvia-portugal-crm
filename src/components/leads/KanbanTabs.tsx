import { Badge } from "@/components/ui/badge";
import { LeadCard } from "./LeadCard";
import { Lead, LeadTemperature } from "@/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { usePermissions } from "@/hooks/usePermissions";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useLanguage } from "@/i18n";

interface LeadEvent {
  id: string;
  title: string;
  start_time: string;
  event_type: string;
}

interface KanbanTabsProps {
  leads: Lead[];
  leadEvents?: Record<string, LeadEvent>;
  onStatusChange: (leadId: string, newStatus: string) => void;
  onTemperatureChange: (leadId: string, newTemperature: LeadTemperature) => void;
  onViewDetails: (lead: Lead) => void;
  onDelete: (leadId: string) => void;
  onArchive?: (leadId: string) => void;
}

// Helper to generate badge style from hex color
const getBadgeStyle = (hexColor: string) => {
  return {
    backgroundColor: `${hexColor}20`,
    color: hexColor,
  };
};

// Helper to generate dot color class from hex
const getDotStyle = (hexColor: string) => ({
  backgroundColor: hexColor,
});

export function KanbanTabs({
  leads,
  leadEvents = {},
  onStatusChange,
  onTemperatureChange,
  onViewDetails,
  onDelete,
  onArchive,
}: KanbanTabsProps) {
  const { t } = useLanguage();
  const { data: stages = [], isLoading } = usePipelineStages();
  const { isAdmin } = usePermissions();
  const [activeStatus, setActiveStatus] = useState<string>("");

  // Set initial active status when stages load
  useEffect(() => {
    if (stages.length > 0 && !activeStatus) {
      setActiveStatus(stages[0].key);
    }
  }, [stages, activeStatus]);

  const isFinalStatus = (status: string) => {
    const stage = stages.find(s => s.key === status);
    return stage?.is_final_positive || stage?.is_final_negative || false;
  };

  const getLeadsByStatus = (statusKey: string) => {
    return leads.filter((lead) => lead.status === statusKey);
  };

  // Get orphan leads (leads with status not in current pipeline)
  const getOrphanLeads = () => {
    const stageKeys = stages.map(s => s.key);
    return leads.filter((lead) => !stageKeys.includes(lead.status || ''));
  };

  const orphanLeads = getOrphanLeads();
  const filteredLeads = activeStatus === '__orphan__'
    ? orphanLeads
    : getLeadsByStatus(activeStatus);

  const activeStage = stages.find(s => s.key === activeStatus);

  // Window-based virtualization: only the cards currently on screen are kept
  // in the DOM. A stage with thousands of leads no longer exhausts the
  // browser's memory (which was crashing the page on mobile).
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const virtualizer = useWindowVirtualizer({
    count: filteredLeads.length,
    estimateSize: () => 140,
    overscan: 6,
    scrollMargin,
    getItemKey: (index) => filteredLeads[index]?.id ?? index,
  });

  // Track the list's distance from the top of the document so the virtualizer
  // knows where its items begin. Re-measured on every render (cheap, guarded).
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

  if (isLoading) {
    return (
      <div className="w-full space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (stages.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">{t("Pipeline não configurado")}</p>
        <p className="text-xs mt-1">{t("Configure o pipeline nas Definições")}</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      {/* Status Selector */}
      <Select value={activeStatus} onValueChange={setActiveStatus}>
        <SelectTrigger className="w-full">
          <div className="flex items-center gap-2">
            {activeStatus === '__orphan__' ? (
              <>
                <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                <span>{t("Sem Etapa")}</span>
                <Badge variant="secondary" className="ml-auto bg-muted text-muted-foreground">
                  {orphanLeads.length}
                </Badge>
              </>
            ) : activeStage ? (
              <>
                <span
                  className="h-2 w-2 rounded-full"
                  style={getDotStyle(activeStage.color)}
                />
                <span>{activeStage.name}</span>
                <Badge
                  variant="secondary"
                  className="ml-auto"
                  style={getBadgeStyle(activeStage.color)}
                >
                  {getLeadsByStatus(activeStatus).length}
                </Badge>
              </>
            ) : (
              <SelectValue placeholder={t("Selecionar etapa")} />
            )}
          </div>
        </SelectTrigger>
        <SelectContent>
          {stages.map((stage) => {
            const count = getLeadsByStatus(stage.key).length;
            return (
              <SelectItem key={stage.id} value={stage.key}>
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={getDotStyle(stage.color)}
                  />
                  <span>{stage.name}</span>
                  <Badge
                    variant="secondary"
                    className="ml-2"
                    style={getBadgeStyle(stage.color)}
                  >
                    {count}
                  </Badge>
                </div>
              </SelectItem>
            );
          })}
          {/* Orphan leads option */}
          {orphanLeads.length > 0 && (
            <SelectItem value="__orphan__">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                <span>{t("Sem Etapa")}</span>
                <Badge variant="secondary" className="ml-2 bg-muted text-muted-foreground">
                  {orphanLeads.length}
                </Badge>
              </div>
            </SelectItem>
          )}
        </SelectContent>
      </Select>

      {/* Leads List (virtualized) */}
      {filteredLeads.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">{t("Sem leads nesta fase")}</p>
        </div>
      ) : (
        <div
          ref={listRef}
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const lead = filteredLeads[item.index];
            if (!lead) return null;
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
                <div className="pb-2">
                  <LeadCard
                    lead={lead}
                    upcomingEvent={leadEvents[lead.id]}
                    onStatusChange={(id, status) => {
                      onStatusChange(id, status);
                      setActiveStatus(status);
                    }}
                    onTemperatureChange={onTemperatureChange}
                    onViewDetails={onViewDetails}
                    onDelete={onDelete}
                    onArchive={onArchive}
                    pipelineStages={stages}
                    isLocked={isFinalStatus(lead.status || '') && !isAdmin}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
