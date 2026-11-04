import { useRef } from 'react';
import { Archive, ArchiveRestore, ChevronDown, BarChart3, CheckSquare, History, Layers, LayoutGrid, List, Plus, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { PageModuleIcon } from '@/components/layout/ModuleNavIcon';
import { ExportMenu, type ExportKind } from '@/components/shared/ExportMenu';
import { useLanguage } from '@/i18n';

export type LeadsView = 'kanban' | 'table' | 'report';

interface LeadsToolbarProps {
  readonly view: LeadsView;
  readonly onViewChange: (view: LeadsView) => void;
  /** "17", or "5 / 17" while filters hide some. */
  readonly count: string;
  readonly onAdd: () => void;
  readonly onImport: () => void;
  /** Leads the list shows now, which is what an export takes. */
  readonly exportCount: number;
  readonly onExport: (kind: ExportKind) => void;
  readonly onHistory: () => void;
  readonly onArchiveByStage: () => void;
  readonly onArchiveSelected: () => void;
  readonly selectedCount: number;
  readonly archived: boolean;
  readonly onToggleArchived: () => void;
}

const VIEWS: readonly { key: LeadsView; label: string; icon: typeof LayoutGrid }[] = [
  { key: 'kanban', label: 'Funil', icon: LayoutGrid },
  { key: 'table', label: 'Lista', icon: List },
  { key: 'report', label: 'Relatório', icon: BarChart3 },
];

/** One line: title, view switch, the rarely used actions behind ⋯ and the one main action. Search lives with the filters. */
export function LeadsToolbar(props: LeadsToolbarProps) {
  const { t } = useLanguage();
  const openingDialog = useRef(false);
  const openDialog = (action: () => void) => { openingDialog.current = true; action(); };
  const restoreFocus = (event: Event) => {
    if (openingDialog.current) { event.preventDefault(); openingDialog.current = false; }
  };
  return <header className="leads-header flex flex-wrap items-center gap-x-3 gap-y-3" aria-label={t("Leads")}>
    <PageModuleIcon to="/leads" />
    <div className="flex items-baseline gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{t("Leads")}</h1>
      <span className="text-sm tabular-nums text-muted-foreground">{props.count}</span>
    </div>
    <div role="group" aria-label={t("Vista das leads")} className="flex items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-sm">
      {VIEWS.map(({ key, label, icon: Icon }) => {
        // Archived leads only have the list.
        const unavailable = props.archived && key === 'kanban';
        const current = props.view === key;
        return <button key={key} type="button" aria-pressed={current} disabled={unavailable}
          title={unavailable ? t('As leads arquivadas só aparecem em lista') : undefined}
          className={cn('flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors disabled:opacity-40',
            current ? 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/30' : 'text-foreground/75 hover:bg-muted hover:text-foreground')}
          onClick={() => props.onViewChange(key)}>
          <Icon className="h-4 w-4" aria-hidden="true" />{t(label)}
        </button>;
      })}
    </div>
    {props.archived && <button type="button" onClick={props.onToggleArchived}
      className="flex h-8 items-center gap-1.5 rounded-full bg-amber-500/10 px-3 text-xs font-medium text-amber-700 hover:bg-amber-500/15 dark:text-amber-300">
      <Archive className="h-3.5 w-3.5" aria-hidden="true" />{t("A ver arquivadas")}<X className="h-3.5 w-3.5" aria-label={t("Voltar às ativas")} />
    </button>}
    <div className="leads-header-tools ml-auto flex min-w-0 items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" data-otto-target="leads-import-btn" className="h-9 shrink-0 rounded-full px-3" aria-label={t("Importar leads")}>
            <Upload className="h-4 w-4" /><span className="hidden sm:inline">{t("Importar")}</span><ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60" onCloseAutoFocus={restoreFocus}>
          <DropdownMenuItem onSelect={() => openDialog(props.onImport)}><Upload className="mr-2 h-4 w-4" />{t("Importar leads")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openDialog(props.onHistory)}><History className="mr-2 h-4 w-4" />{t("Histórico de importações")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ExportMenu count={props.exportCount} noun={t("leads")} onExport={props.onExport} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-9 shrink-0 rounded-full px-3" aria-label={t("Arquivo das leads")}>
            <Archive className="h-4 w-4" /><span className="hidden sm:inline">{t("Arquivo")}</span><ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64" onCloseAutoFocus={restoreFocus}>
          {!props.archived && <>
            <DropdownMenuItem onSelect={() => openDialog(props.onArchiveByStage)}><Layers className="mr-2 h-4 w-4" />{t("Arquivar leads de um estado")}</DropdownMenuItem>
            <DropdownMenuItem disabled={props.selectedCount === 0} onClick={props.onArchiveSelected}><CheckSquare className="mr-2 h-4 w-4" />{t("Arquivar selecionadas ({{n}})", { n: props.selectedCount })}</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>}
          <DropdownMenuItem onClick={props.onToggleArchived}>
            {props.archived ? <ArchiveRestore className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
            {props.archived ? t('Ver leads ativas') : t('Ver leads arquivadas')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button onClick={props.onAdd} className="h-9 shrink-0 rounded-full px-4"><Plus className="h-4 w-4" /><span className="leads-add-label">{t("Novo lead")}</span></Button>
    </div>
  </header>;
}
