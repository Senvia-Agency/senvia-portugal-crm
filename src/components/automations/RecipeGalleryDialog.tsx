import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Loader2, Search, Sparkles, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, normalizeString } from '@/lib/utils';
import { NODE_CATEGORY_STYLES, NODE_DEFINITIONS } from '@/lib/automation-nodes';
import { AUTOMATION_RECIPES, type AutomationRecipe } from '@/lib/automation-recipes';
import { RECIPE_OBJECTIVES, recipeObjective } from '@/lib/automation-recipe-library';
import { validateAutomationConfiguration } from '@/lib/automation-validation';
import { AutomationTemplateSharing } from '@/components/automations/AutomationTemplateSharing';
import { AutomationStarter } from '@/components/automations/AutomationStarter';
import { GroupChip } from '@/components/automations/TriggerPicker';
import { useCreateAutomationFlow } from '@/hooks/useAutomationFlows';
import { useLanguage } from '@/i18n';

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
  const { t } = useLanguage();
  const navigate = useNavigate();
  const createFlow = useCreateAutomationFlow();
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [review, setReview] = useState<AutomationRecipe | null>(null);
  const term = normalizeString(search.trim());

  const visible = useMemo(
    () => AUTOMATION_RECIPES.filter((recipe) => {
      if (group && recipeObjective(recipe) !== group) return false;
      if (!term) return true;
      const haystack = [recipe.name, recipe.summary, ...recipe.outline, t(NODE_DEFINITIONS[recipe.trigger_type].label)]
        .map(normalizeString).join(' ');
      return haystack.includes(term);
    }),
    [term, group, t],
  );

  const groupsPresent = useMemo(
    () => RECIPE_OBJECTIVES.filter((item) => AUTOMATION_RECIPES.some((r) => recipeObjective(r) === item.key)),
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
            {t('Modelos de automação')}
          </DialogTitle>
          <DialogDescription>
            {t('Escolha um objetivo, reveja as escolhas necessárias e crie um rascunho para configurar.')}
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 border-b bg-muted/30 px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('Pesquisar modelo por nome, passo ou gatilho...')}
                className="h-10 border-primary/40 bg-primary/[0.05] pl-10 pr-10 shadow-sm focus-visible:ring-2 focus-visible:ring-primary/25"
                aria-label={t('Pesquisar modelo')}
                autoFocus
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label={t('Limpar pesquisa')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <GroupChip active={group === null} onClick={() => setGroup(null)}>
                {t('Todos')} <span className="tabular-nums opacity-60">{AUTOMATION_RECIPES.length}</span>
              </GroupChip>
              {groupsPresent.map((item) => (
                <GroupChip
                  key={item.key}
                  active={group === item.key}
                  onClick={() => setGroup(group === item.key ? null : item.key)}
                >
                  {t(item.label)}
                </GroupChip>
              ))}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="mb-5 space-y-3"><AutomationStarter onCreate={handleUse} busy={createFlow.isPending} /><AutomationTemplateSharing onImported={flowId => { onOpenChange(false); navigate(`/automacoes/${flowId}`); }} /></div>
            {review && (
              <section aria-label="Preparar modelo" className="mb-5 space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
                <h2 className="text-base font-semibold">Preparar: {review.name}</h2>
                <p className="text-sm text-muted-foreground">O modelo será criado como rascunho. Configure os passos indicados antes de ativar.</p>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {(review.configuration ?? [review.editHint]).map(item => <li key={item}>{item}</li>)}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => handleUse(review)} disabled={createFlow.isPending}>
                    {creatingId === review.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar rascunho e configurar
                  </Button>
                  <Button variant="outline" onClick={() => setReview(null)}>Voltar aos modelos</Button>
                </div>
              </section>
            )}
            {visible.length === 0 ? (
              <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                {t('Nenhum modelo corresponde à pesquisa.')}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visible.map((recipe) => {
                  const trigger = NODE_DEFINITIONS[recipe.trigger_type];
                  const TriggerIcon = trigger.icon;
                  const missing = new Set(validateAutomationConfiguration(recipe.graph, { triggerConfig: recipe.trigger_config }).filter(issue => issue.severity === 'error').map(issue => issue.nodeId)).size;
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
                                {t('Conversa')}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{t('Gatilho: {{name}}', { name: t(trigger.label) })}</p>
                        </div>
                      </div>

                      <p className="text-sm leading-snug text-muted-foreground">{recipe.summary}</p>
                      <p className="text-xs font-medium text-warning">{missing > 0 ? `${missing} passo(s) por configurar` : 'Rever textos, responsáveis e condições'}</p>

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
                        <Button size="sm" onClick={() => setReview(recipe)} disabled={createFlow.isPending} className="shrink-0">
                          {t('Preparar modelo')}
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('Fechar')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
