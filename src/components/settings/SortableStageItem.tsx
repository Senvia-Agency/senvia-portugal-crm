import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Edit2, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PipelineStage } from "@/hooks/usePipelineStages";
import { useLanguage } from "@/i18n";

interface SortableStageItemProps {
  stage: PipelineStage;
  onEdit: () => void;
  onDelete: () => void;
}

export function SortableStageItem({ stage, onEdit, onDelete }: SortableStageItemProps) {
  const { t } = useLanguage();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border bg-card transition-colors",
        isDragging 
          ? "opacity-50 shadow-lg ring-2 ring-primary z-50" 
          : "hover:bg-accent/50"
      )}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 -m-1 touch-none"
        aria-label={t("Arrastar para reordenar")}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </button>

      {/* Color indicator */}
      <div
        className="w-4 h-4 rounded-full flex-shrink-0"
        style={{ backgroundColor: stage.color }}
      />

      {/* Stage info */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{stage.name}</p>
        <p className="text-xs text-muted-foreground">key: {stage.key}</p>
      </div>

      {/* Status badges */}
      <div className="flex items-center gap-2">
        {stage.is_final_positive && (
          <span className="text-success text-xs flex items-center gap-1">
            <Check className="h-3 w-3" /> {t("Ganho")}
          </span>
        )}
        {stage.is_final_negative && (
          <span className="text-muted-foreground text-xs flex items-center gap-1">
            <X className="h-3 w-3" /> {t("Perdido")}
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onEdit}
        >
          <Edit2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
