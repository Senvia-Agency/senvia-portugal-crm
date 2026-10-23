import { useRef } from 'react';
import { Archive, CheckSquare, History, Layers, LayoutGrid, List, MoreHorizontal, Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface LeadsToolbarProps {
  readonly viewMode: 'kanban' | 'table';
  readonly onViewChange: (view: 'kanban' | 'table') => void;
  readonly onAdd: () => void;
  readonly onImport: () => void;
  readonly onHistory: () => void;
  readonly onArchiveByStage: () => void;
  readonly onArchiveSelected: () => void;
  readonly selectedCount: number;
  readonly archived: boolean;
  readonly onToggleArchived: () => void;
}

export function LeadsToolbar(props: LeadsToolbarProps) {
  const openingDialog = useRef(false);
  const openDialog = (action: () => void) => { openingDialog.current = true; action(); };
  const restoreFocus = (event: Event) => {
    if (openingDialog.current) { event.preventDefault(); openingDialog.current = false; }
  };
  const archiveLabel = props.archived ? 'Ver ativas' : 'Arquivadas';
  return <div className="leads-actions flex flex-wrap items-center gap-2" aria-label="Ações das leads">
    <div role="group" aria-label="Vista das leads" className="flex shrink-0 items-center rounded-lg border border-border bg-background p-1">
      <Button variant={props.viewMode === 'kanban' ? 'secondary' : 'ghost'} size="icon" className="h-10 w-10" onClick={() => props.onViewChange('kanban')} aria-label="Vista Kanban" aria-pressed={props.viewMode === 'kanban'}><LayoutGrid /></Button>
      <Button variant={props.viewMode === 'table' ? 'secondary' : 'ghost'} size="icon" className="h-10 w-10" onClick={() => props.onViewChange('table')} aria-label="Vista de tabela" aria-pressed={props.viewMode === 'table'}><List /></Button>
    </div>
    <Button onClick={props.onAdd} className="h-10"><Plus />Adicionar</Button>
    <Button variant="outline" data-otto-target="leads-import-btn" onClick={props.onImport} className="leads-wide-action h-10"><Upload />Importar</Button>
    <Button variant="outline" onClick={props.onHistory} className="leads-wide-action h-10"><History />Histórico</Button>
    {!props.archived && <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline" className="leads-wide-action h-10"><Archive />Arquivar</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" onCloseAutoFocus={restoreFocus}>
        <DropdownMenuItem onSelect={() => openDialog(props.onArchiveByStage)}><Layers className="mr-2 h-4 w-4" />Arquivar leads de um estado</DropdownMenuItem>
        <DropdownMenuItem disabled={props.selectedCount === 0} onClick={props.onArchiveSelected}><CheckSquare className="mr-2 h-4 w-4" />Arquivar selecionadas ({props.selectedCount})</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>}
    <Button variant={props.archived ? 'secondary' : 'outline'} onClick={props.onToggleArchived} className="leads-wide-action h-10"><Archive />{archiveLabel}</Button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline" className="leads-compact-action h-10" aria-label="Mais ações das leads"><MoreHorizontal />Mais</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" onCloseAutoFocus={restoreFocus}>
        <DropdownMenuItem onSelect={() => openDialog(props.onImport)}><Upload className="mr-2 h-4 w-4" />Importar leads</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openDialog(props.onHistory)}><History className="mr-2 h-4 w-4" />Histórico de importações</DropdownMenuItem>
        {!props.archived && <>
          <DropdownMenuItem onSelect={() => openDialog(props.onArchiveByStage)}><Layers className="mr-2 h-4 w-4" />Arquivar leads de um estado</DropdownMenuItem>
          <DropdownMenuItem disabled={props.selectedCount === 0} onClick={props.onArchiveSelected}><CheckSquare className="mr-2 h-4 w-4" />Arquivar selecionadas ({props.selectedCount})</DropdownMenuItem>
        </>}
        <DropdownMenuItem onClick={props.onToggleArchived}><Archive className="mr-2 h-4 w-4" />{props.archived ? 'Ver leads ativas' : 'Ver leads arquivadas'}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
