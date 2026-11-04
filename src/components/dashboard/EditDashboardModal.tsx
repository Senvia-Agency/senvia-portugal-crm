import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboardEditorTarget, useSaveDashboardWidgets } from '@/hooks/useDashboardEditor';
import { useDashboardWidgets } from '@/hooks/useDashboardWidgets';
import { useModules } from '@/hooks/useModules';
import {
  getAllAvailableWidgets,
  getWidgetTitle,
  isWidgetForNiche,
  type NicheType,
  type WidgetType,
} from '@/lib/dashboard-templates';
import type { ProfileDashboardWidget } from '@/hooks/useOrganizationProfiles';
import { useLanguage } from '@/i18n';

interface EditDashboardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Picks which of the existing panels and indicators the dashboard shows.
 *
 * Starts from what is on screen right now — whatever the profile has saved,
 * or the niche defaults when it has never been customised — so opening this
 * and saving without touching anything changes nothing.
 */
export function EditDashboardModal({ open, onOpenChange }: EditDashboardModalProps) {
  const { t } = useLanguage();
  const { organization } = useAuth();
  const { data: target, isLoading: targetLoading } = useDashboardEditorTarget();
  const { widgets: currentWidgets, niche } = useDashboardWidgets();
  // useModules, not the organization's raw enabled_modules: it also enforces
  // what the plan allows, so the list never offers a widget the org can't use.
  const { modules } = useModules();
  const save = useSaveDashboardWidgets();

  const salesSettings = (organization?.sales_settings as { commissions_enabled?: boolean } | null) || {};
  const commissionsEnabled = !!salesSettings.commissions_enabled;

  const available = useMemo(
    () => getAllAvailableWidgets().filter(w => {
      if (w.requiredModule && (modules as Record<string, boolean>)[w.requiredModule] === false) return false;
      if (!isWidgetForNiche(w.type, niche as NicheType)) return false;
      // Not a module, a sales setting — the panel only renders when it's on.
      if (w.type === 'commissions_widget' && !commissionsEnabled) return false;
      return true;
    }),
    [modules, niche, commissionsEnabled],
  );

  const [selected, setSelected] = useState<Set<WidgetType>>(new Set());

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(currentWidgets.filter(w => w.is_visible).map(w => w.widget_type)));
    // currentWidgets is rebuilt every render by its hook; keying off `open`
    // seeds the dialog once, so a checkbox click isn't overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (type: WidgetType) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleSave = () => {
    if (!target) return;
    // Anything already saved that this dialog doesn't offer (a module that is
    // off right now, a leftover from another niche) is carried over untouched
    // — turning that module back on shouldn't have silently lost the choice.
    const offered = new Set(available.map(w => w.type as string));
    const preserved = (target.widgets ?? []).filter(w => !offered.has(w.type));
    const chosen: ProfileDashboardWidget[] = available
      .filter(w => selected.has(w.type))
      .map(w => ({ type: w.type, is_visible: true }));
    save.mutate(
      { profileId: target.id, widgets: [...chosen, ...preserved] },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  // Big panels first — they are what takes up the page — then the small
  // indicator tiles that sit in the grid at the bottom.
  const panels = available.filter(w => w.chartType === 'none');
  const indicators = available.filter(w => w.chartType !== 'none');

  const renderGroup = (title: string, list: typeof available) => (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <div className="rounded-lg border divide-y">
        {list.map(widget => (
          <label key={widget.type} className="flex items-start gap-3 p-2.5 cursor-pointer hover:bg-muted/40">
            <Checkbox
              checked={selected.has(widget.type)}
              onCheckedChange={() => toggle(widget.type)}
              className="mt-0.5"
            />
            <widget.icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm leading-tight">{t(getWidgetTitle(widget.type, niche as NicheType))}</p>
              {widget.description && (
                <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{t(widget.description)}</p>
              )}
            </div>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 md:p-6 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5 text-primary" />
            {t("Editar painel")}
          </DialogTitle>
          <DialogDescription>
            {t("Escolhe o que aparece no painel.")}
            {target && (
              <> {t("Aplica-se a toda a gente com o perfil")} <strong>{target.name}</strong>.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-4 space-y-4">
          {targetLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !target ? (
            <p className="text-sm text-muted-foreground py-4">
              {t("Não foi encontrado um perfil onde guardar esta configuração. Cria um perfil em Definições → Perfis e volta aqui.")}
            </p>
          ) : (
            <>
              {panels.length > 0 && renderGroup(t('Painéis'), panels)}
              {indicators.length > 0 && renderGroup(t('Indicadores'), indicators)}
            </>
          )}
        </div>

        <DialogFooter className="p-4 md:p-6 pt-3 border-t">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("Cancelar")}</Button>
          <Button onClick={handleSave} disabled={!target || save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {t("Guardar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
