import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Loader2, Search, Sparkles, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, normalizeString } from '@/lib/utils';
import { NODE_CATEGORY_STYLES, NODE_DEFINITIONS, TRIGGER_GROUPS, triggerGroupOf } from '@/lib/automation-nodes';
import { AUTOMATION_RECIPES, type AutomationRecipe } from '@/lib/automation-recipes';
import { GroupChip } from '@/components/automations/TriggerPicker';
import { useCreateAutomationFlow } from '@/hooks/useAutomationFlows';

interface RecipeGalleryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Ready-made flows, the way n8n keeps its templates: a gallery of their own,
 * searchable, full screen. Picking one creates the flow with its whole graph
 * and lands in the editor with the texts ready to edit.
 */
export function RecipeGalleryDialog({ open, onOpenChange }: RecipeGalleryDialogProps) {
  const navigate = useNavigate();
  const createFlow = useCreateAutomationFlow();
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const term = normalizeString(search.trim());

  const visible = useMemo(
    () => AUTOMATION_RECIPES.filter((recipe) => {
      if (group && triggerGroupOf(recipe.trigger_type) !== group) return false;
      if (!term) return true;
      const haystack = [recipe.name, recipe.summary, ...recipe.outline, NODE_DEFINITIONS[recipe.trigger_type].label]
        .map(normalizeString).join(' ');
      return haystack.includes(term);
    }),
    [term, group],
  );

  const groupsPresent = useMemo(
    () => TRIGGER_GROUPS.filter((item) => AUTOMATION_RECIPES.some((r) => triggerGroupOf(r.trigger_type) === item.key)),
    [],
  );

  const handleUse = async (recipe: AutomationRecipe) => {
    setCreatingId(recipe.id);
    try {
      const flow = await createFlow.mutateAsync({
        name: recipe.name,
        description: recipe.editHint,
        trigger_type: recipe.trigger_type,
        trigger_config: recipe.trigger_config,
        graph: recipe.graph,
        entry_node_id: recipe.entry_node_id,
      });
      onOpenChange(false);
      if (flow?.id) navigate(`/automacoes/${flow.id}`);
    } finally {
      setCreatingId(null);
    }
  };

  const triggerStyle = NODE_CATEGORY_STYLES.trigger;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Modelos de automação
          </DialogTitle>
          <DialogDescription>
            Fluxos completos para os casos mais comuns. Escolhe um, ajustas os textos e ativas.
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 border-b bg-muted/30 px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Pesquisar modelo por nome, passo ou gatilho..."
                className="h-10 border-primary/40 bg-primary/[0.05] pl-10 pr-10 shadow-sm focus-visible:ring-2 focus-visible:ring-primary/25"
                aria-label="Pesquisar modelo"
                autoFocus
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Limpar pesquisa"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <GroupChip active={group === null} onClick={() => setGroup(null)}>
                Todos <span className="tabular-nums opacity-60">{AUTOMATION_RECIPES.length}</span>
              </GroupChip>
              {groupsPresent.map((item) => (
                <GroupChip
                  key={item.key}
                  active={group === item.key}
                  onClick={() => setGroup(group === item.key ? null : item.key)}
                >
                  {item.label}
                </GroupChip>
              ))}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="mx-auto max-w-6xl">
            {visible.length === 0 ? (
              <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                Nenhum modelo corresponde à pesquisa.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visible.map((recipe) => {
                  const trigger = NODE_DEFINITIONS[recipe.trigger_type];
                  const TriggerIcon = trigger.icon;
                  const busy = creatingId === recipe.id;
                  return (
                    <article
                      key={recipe.id}
                      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-[2.5px]', triggerStyle.bg, triggerStyle.ring)}>
                          <TriggerIcon className={cn('h-5 w-5', triggerStyle.icon)} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-foreground">{recipe.name}</h3>
                            {recipe.conversational && (
                              <span className="rounded-full bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400">
                                Conversa
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">Gatilho: {trigger.label}</p>
                        </div>
                      </div>

                      <p className="text-xs leading-snug text-muted-foreground">{recipe.summary}</p>

                      <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                        {recipe.outline.map((step, i) => (
                          <span key={`${recipe.id}-${step}`} className="flex items-center gap-1">
                            {i > 0 && <ChevronRight className="h-2.5 w-2.5" />}
                            <span className="rounded bg-muted px-1.5 py-0.5">{step}</span>
                          </span>
                        ))}
                      </div>

                      <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3">
                        <p className="text-[11px] text-muted-foreground">{recipe.editHint}</p>
                        <Button size="sm" onClick={() => handleUse(recipe)} disabled={createFlow.isPending} className="shrink-0">
                          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                          Usar este modelo
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 justify-end border-t px-4 py-3 sm:px-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
