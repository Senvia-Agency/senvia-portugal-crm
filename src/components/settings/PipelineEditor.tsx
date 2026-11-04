import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { 
  usePipelineStages, 
  useCreatePipelineStage, 
  useUpdatePipelineStage, 
  useDeletePipelineStage,
  useReorderPipelineStages,
  useApplyNicheTemplate,
  PipelineStage 
} from "@/hooks/usePipelineStages";
import { useOrganization } from "@/hooks/useOrganization";
import { NICHE_TEMPLATES, NicheType, NICHE_LABELS, PipelineStageTemplate, getNicheTemplate } from "@/lib/pipeline-templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { SortableStageItem } from "./SortableStageItem";
import { SortablePreviewStageItem, type PreviewStage } from "./SortablePreviewStageItem";
import { 
  Plus, 
  Building2, 
  Heart, 
  Hammer, 
  Wifi, 
  ShoppingCart, 
  Home,
  AlertTriangle,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n";

const NICHE_ICONS: Record<string, React.ReactNode> = {
  Building2: <Building2 className="h-5 w-5" />,
  Heart: <Heart className="h-5 w-5" />,
  Hammer: <Hammer className="h-5 w-5" />,
  Wifi: <Wifi className="h-5 w-5" />,
  ShoppingCart: <ShoppingCart className="h-5 w-5" />,
  Home: <Home className="h-5 w-5" />,
};

interface EditingStage {
  id?: string;
  name: string;
  key: string;
  color: string;
  is_final_positive: boolean;
  is_final_negative: boolean;
}


const DEFAULT_NEW_STAGE: EditingStage = {
  name: "",
  key: "",
  color: "#3B82F6",
  is_final_positive: false,
  is_final_negative: false,
};

export function PipelineEditor() {
  const { data: stages, isLoading } = usePipelineStages();
  const { data: organization } = useOrganization();
  const createStage = useCreatePipelineStage();
  const updateStage = useUpdatePipelineStage();
  const deleteStage = useDeletePipelineStage();
  const reorderStages = useReorderPipelineStages();
  const applyTemplate = useApplyNicheTemplate();
  const { t } = useLanguage();

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Current stages editing
  const [editingStage, setEditingStage] = useState<EditingStage | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [stageToDelete, setStageToDelete] = useState<PipelineStage | null>(null);

  // Preview mode state
  const [previewStages, setPreviewStages] = useState<PreviewStage[] | null>(null);
  const [selectedNiche, setSelectedNiche] = useState<NicheType | null>(null);
  const [editingPreviewIndex, setEditingPreviewIndex] = useState<number | null>(null);
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);

  const generateTempId = () => Math.random().toString(36).substring(2, 9);

  // Handle drag end for current stages
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !stages) return;

    const oldIndex = stages.findIndex(s => s.id === active.id);
    const newIndex = stages.findIndex(s => s.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = arrayMove(stages, oldIndex, newIndex);
    const updates = newOrder.map((stage, index) => ({
      id: stage.id,
      position: index + 1,
    }));

    await reorderStages.mutateAsync(updates);
  };

  // Handle drag end for preview stages
  const handlePreviewDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !previewStages) return;

    const oldIndex = previewStages.findIndex(s => s.tempId === active.id);
    const newIndex = previewStages.findIndex(s => s.tempId === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    setPreviewStages(arrayMove(previewStages, oldIndex, newIndex));
  };

  // Handle selecting a template - shows preview instead of applying immediately
  const handleSelectTemplate = (niche: NicheType) => {
    const template = getNicheTemplate(niche);
    const previewData: PreviewStage[] = template.stages.map(stage => ({
      ...stage,
      tempId: generateTempId(),
    }));
    setSelectedNiche(niche);
    setPreviewStages(previewData);
  };

  // Cancel preview mode
  const handleCancelPreview = () => {
    setPreviewStages(null);
    setSelectedNiche(null);
    setEditingPreviewIndex(null);
  };

  // Apply the preview stages to the database
  const handleApplyPreview = async () => {
    if (!organization || !previewStages || !selectedNiche) return;
    
    // Convert preview stages to template format for the mutation
    const stagesToApply: PipelineStageTemplate[] = previewStages.map((stage, index) => ({
      name: stage.name,
      key: stage.key,
      color: stage.color,
      position: index + 1,
      is_final_positive: stage.is_final_positive,
      is_final_negative: stage.is_final_negative,
    }));

    await applyTemplate.mutateAsync({ 
      organizationId: organization.id, 
      niche: selectedNiche,
      customStages: stagesToApply,
    });
    
    setShowApplyConfirm(false);
    setPreviewStages(null);
    setSelectedNiche(null);
  };

  // Preview stage editing functions
  const handleEditPreviewStage = (index: number, field: keyof PreviewStage, value: any) => {
    if (!previewStages) return;
    const updated = [...previewStages];
    updated[index] = { ...updated[index], [field]: value };
    
    // Auto-generate key from name if editing name
    if (field === 'name') {
      updated[index].key = value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    }
    
    // Ensure mutual exclusivity of final states
    if (field === 'is_final_positive' && value) {
      updated[index].is_final_negative = false;
    }
    if (field === 'is_final_negative' && value) {
      updated[index].is_final_positive = false;
    }
    
    setPreviewStages(updated);
  };

  const handleAddPreviewStage = () => {
    if (!previewStages) return;
    const newStage: PreviewStage = {
      tempId: generateTempId(),
      name: "Nova Etapa",
      key: "nova_etapa",
      color: "#3B82F6",
      position: previewStages.length + 1,
      is_final_positive: false,
      is_final_negative: false,
    };
    setPreviewStages([...previewStages, newStage]);
    setEditingPreviewIndex(previewStages.length);
  };

  const handleRemovePreviewStage = (index: number) => {
    if (!previewStages) return;
    const updated = previewStages.filter((_, i) => i !== index);
    setPreviewStages(updated);
    if (editingPreviewIndex === index) {
      setEditingPreviewIndex(null);
    }
  };

  const handleMovePreviewStage = (index: number, direction: 'up' | 'down') => {
    if (!previewStages) return;
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= previewStages.length) return;
    
    const updated = [...previewStages];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    setPreviewStages(updated);
  };

  // Current stages functions (unchanged)
  const handleAddStage = () => {
    setEditingStage(DEFAULT_NEW_STAGE);
    setIsDialogOpen(true);
  };

  const handleEditStage = (stage: PipelineStage) => {
    setEditingStage({
      id: stage.id,
      name: stage.name,
      key: stage.key,
      color: stage.color,
      is_final_positive: stage.is_final_positive,
      is_final_negative: stage.is_final_negative,
    });
    setIsDialogOpen(true);
  };

  const handleSaveStage = async () => {
    if (!editingStage || !organization) return;

    const key = editingStage.key || editingStage.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    if (editingStage.id) {
      await updateStage.mutateAsync({
        id: editingStage.id,
        name: editingStage.name,
        key,
        color: editingStage.color,
        is_final_positive: editingStage.is_final_positive,
        is_final_negative: editingStage.is_final_negative,
      });
    } else {
      const maxPosition = stages?.reduce((max, s) => Math.max(max, s.position), 0) || 0;
      await createStage.mutateAsync({
        organization_id: organization.id,
        name: editingStage.name,
        key,
        color: editingStage.color,
        position: maxPosition + 1,
        is_final_positive: editingStage.is_final_positive,
        is_final_negative: editingStage.is_final_negative,
      });
    }

    setIsDialogOpen(false);
    setEditingStage(null);
  };

  const handleDeleteStage = async () => {
    if (!stageToDelete) return;
    await deleteStage.mutateAsync(stageToDelete.id);
    setStageToDelete(null);
  };

  const handleMoveStage = async (stageId: string, direction: 'up' | 'down') => {
    if (!stages) return;

    const currentIndex = stages.findIndex(s => s.id === stageId);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= stages.length) return;

    const newStages = [...stages];
    [newStages[currentIndex], newStages[newIndex]] = [newStages[newIndex], newStages[currentIndex]];

    const updates = newStages.map((stage, index) => ({
      id: stage.id,
      position: index + 1,
    }));

    await reorderStages.mutateAsync(updates);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const currentNiche = (organization as any)?.niche || 'generic';

  return (
    <div className="space-y-6">
      {/* Niche Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('Template de Nicho')}</CardTitle>
          <CardDescription>
            {previewStages 
              ? t("Clica num template para ver as etapas antes de aplicar")
              : t("Escolhe um template predefinido ou personaliza as etapas manualmente")
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {NICHE_TEMPLATES.map((template) => (
              <button
                key={template.id}
                onClick={() => handleSelectTemplate(template.id)}
                className={cn(
                  "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all",
                  selectedNiche === template.id
                    ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                    : currentNiche === template.id && !previewStages
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:border-primary/50"
                )}
              >
                <div className={cn(
                  "p-2 rounded-full",
                  selectedNiche === template.id 
                    ? "bg-primary text-primary-foreground" 
                    : currentNiche === template.id && !previewStages
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                )}>
                  {NICHE_ICONS[template.icon]}
                </div>
                <span className="text-sm font-medium text-center">{t(template.name)}</span>
                {currentNiche === template.id && !previewStages && (
                  <span className="text-xs text-primary">{t('Atual')}</span>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Preview Section - Only shown when a template is selected */}
      {previewStages && selectedNiche && (
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-base">
                  {t('Pré-visualização: {{niche}}', { niche: t(NICHE_LABELS[selectedNiche]) })}
                </CardTitle>
                <CardDescription>
                  {t('Edita as etapas antes de aplicar o template')}
                </CardDescription>
              </div>
            </div>
            <Button onClick={handleAddPreviewStage} size="sm" variant="outline">
              <Plus className="h-4 w-4 mr-1" />
              {t('Adicionar')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handlePreviewDragEnd}
              modifiers={[restrictToVerticalAxis]}
            >
              <SortableContext
                items={previewStages.map(s => s.tempId)}
                strategy={verticalListSortingStrategy}
              >
                {previewStages.map((stage, index) => (
                  <SortablePreviewStageItem
                    key={stage.tempId}
                    stage={stage}
                    index={index}
                    isEditing={editingPreviewIndex === index}
                    totalStages={previewStages.length}
                    onEdit={() => setEditingPreviewIndex(index)}
                    onStopEditing={() => setEditingPreviewIndex(null)}
                    onFieldChange={(field, value) => handleEditPreviewStage(index, field, value)}
                    onRemove={() => handleRemovePreviewStage(index)}
                  />
                ))}
              </SortableContext>
            </DndContext>

            {/* Warning message */}
            <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 mt-4">
              <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
              <p className="text-sm text-warning">
                {t('Ao aplicar, os leads existentes serão movidos para a primeira etapa "{{name}}".', { name: previewStages[0]?.name })}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={handleCancelPreview}>
                {t('Cancelar')}
              </Button>
              <Button 
                onClick={() => setShowApplyConfirm(true)}
                disabled={previewStages.length === 0 || applyTemplate.isPending}
              >
                {applyTemplate.isPending ? t('A aplicar...') : t('Aplicar Template')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current Pipeline Stages - Only shown when NOT in preview mode */}
      {!previewStages && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div>
              <CardTitle className="text-base">{t('Etapas do Pipeline')}</CardTitle>
              <CardDescription>
                {t('Arrasta para reordenar ou edita cada etapa')}
              </CardDescription>
            </div>
            <Button data-otto-target="settings-pipeline-add" onClick={handleAddStage} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              {t('Adicionar')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
              modifiers={[restrictToVerticalAxis]}
            >
              <SortableContext
                items={stages?.map(s => s.id) || []}
                strategy={verticalListSortingStrategy}
              >
                {stages?.map((stage) => (
                  <SortableStageItem
                    key={stage.id}
                    stage={stage}
                    onEdit={() => handleEditStage(stage)}
                    onDelete={() => setStageToDelete(stage)}
                  />
                ))}
              </SortableContext>
            </DndContext>

            {(!stages || stages.length === 0) && (
              <div className="text-center py-8 text-muted-foreground">
                {t('Nenhuma etapa configurada. Escolhe um template ou adiciona etapas manualmente.')}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Edit/Create Dialog for current stages */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingStage?.id ? t('Editar Etapa') : t('Nova Etapa')}
            </DialogTitle>
            <DialogDescription>
              {t('Configura os detalhes da etapa do pipeline')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t('Nome')}</Label>
              <Input
                id="name"
                value={editingStage?.name || ""}
                onChange={(e) => setEditingStage(prev => prev ? { ...prev, name: e.target.value } : null)}
                placeholder={t('Ex: Consulta Marcada')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="color">{t('Cor')}</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  id="color"
                  value={editingStage?.color || "#3B82F6"}
                  onChange={(e) => setEditingStage(prev => prev ? { ...prev, color: e.target.value } : null)}
                  className="w-10 h-10 rounded border cursor-pointer"
                />
                <Input
                  value={editingStage?.color || "#3B82F6"}
                  onChange={(e) => setEditingStage(prev => prev ? { ...prev, color: e.target.value } : null)}
                  className="flex-1"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('Etapa de Sucesso')}</Label>
                <p className="text-xs text-muted-foreground">{t('Conta como conversão')}</p>
              </div>
              <Switch
                checked={editingStage?.is_final_positive || false}
                onCheckedChange={(checked) => setEditingStage(prev => 
                  prev ? { ...prev, is_final_positive: checked, is_final_negative: checked ? false : prev.is_final_negative } : null
                )}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('Etapa de Perda')}</Label>
                <p className="text-xs text-muted-foreground">{t('Marca como perdido')}</p>
              </div>
              <Switch
                checked={editingStage?.is_final_negative || false}
                onCheckedChange={(checked) => setEditingStage(prev => 
                  prev ? { ...prev, is_final_negative: checked, is_final_positive: checked ? false : prev.is_final_positive } : null
                )}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              {t('Cancelar')}
            </Button>
            <Button 
              onClick={handleSaveStage}
              disabled={!editingStage?.name || createStage.isPending || updateStage.isPending}
            >
              {t('Guardar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!stageToDelete} onOpenChange={() => setStageToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Eliminar etapa?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('Esta ação não pode ser revertida. Leads nesta etapa ficarão sem status.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancelar')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteStage}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('Eliminar')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Apply Preview Confirmation */}
      <AlertDialog open={showApplyConfirm} onOpenChange={setShowApplyConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              {t('Aplicar template?')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('Todas as etapas atuais serão substituídas pelas {{n}} etapas da pré-visualização. Os leads existentes serão movidos para a primeira etapa "{{name}}".', { n: previewStages?.length, name: previewStages?.[0]?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancelar')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleApplyPreview}
              disabled={applyTemplate.isPending}
            >
              {applyTemplate.isPending ? t('A aplicar...') : t('Confirmar')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
