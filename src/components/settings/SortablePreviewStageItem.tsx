import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PipelineStageTemplate } from "@/lib/pipeline-templates";
import { useLanguage } from "@/i18n";

export interface PreviewStage extends PipelineStageTemplate {
  tempId: string;
}

interface SortablePreviewStageItemProps {
  stage: PreviewStage;
  index: number;
  isEditing: boolean;
  totalStages: number;
  onEdit: () => void;
  onStopEditing: () => void;
  onFieldChange: (field: keyof PreviewStage, value: any) => void;
  onRemove: () => void;
}

export function SortablePreviewStageItem({
  stage,
  isEditing,
  totalStages,
  onEdit,
  onStopEditing,
  onFieldChange,
  onRemove,
}: SortablePreviewStageItemProps) {
  const { t } = useLanguage();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.tempId });

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
          : "hover:bg-accent/50",
        isEditing && "ring-2 ring-primary"
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

      {/* Color picker */}
      <input
        type="color"
        value={stage.color}
        onChange={(e) => onFieldChange('color', e.target.value)}
        className="w-6 h-6 rounded border cursor-pointer flex-shrink-0"
      />

      {/* Name - editable inline */}
      {isEditing ? (
        <Input
          value={stage.name}
          onChange={(e) => onFieldChange('name', e.target.value)}
          onBlur={onStopEditing}
          onKeyDown={(e) => e.key === 'Enter' && onStopEditing()}
          autoFocus
          className="flex-1 h-8"
        />
      ) : (
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={onEdit}
        >
          <p className="font-medium text-sm truncate">{stage.name}</p>
          <p className="text-xs text-muted-foreground">key: {stage.key}</p>
        </div>
      )}

      {/* Status badges */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onFieldChange('is_final_positive', !stage.is_final_positive)}
          className={cn(
            "text-xs flex items-center gap-1 px-2 py-1 rounded-full border transition-colors",
            stage.is_final_positive
              ? "bg-success/20 text-success border-success/30"
              : "text-muted-foreground border-transparent hover:bg-muted"
          )}
        >
          <Check className="h-3 w-3" />
          <span className="hidden sm:inline">{t("Ganho")}</span>
        </button>
        <button
          onClick={() => onFieldChange('is_final_negative', !stage.is_final_negative)}
          className={cn(
            "text-xs flex items-center gap-1 px-2 py-1 rounded-full border transition-colors",
            stage.is_final_negative
              ? "bg-muted text-muted-foreground border-muted-foreground/30"
              : "text-muted-foreground border-transparent hover:bg-muted"
          )}
        >
          <X className="h-3 w-3" />
          <span className="hidden sm:inline">{t("Perdido")}</span>
        </button>
      </div>

      {/* Delete button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-destructive hover:text-destructive flex-shrink-0"
        onClick={onRemove}
        disabled={totalStages <= 1}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
