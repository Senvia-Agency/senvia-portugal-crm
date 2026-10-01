import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle, Copy, Folder, MoreVertical, Pause, Pencil, Play, Plus, Search, Sparkles, Trash2, Workflow, X, Zap,
} from 'lucide-react';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format';
import { usePersistedState } from '@/hooks/usePersistedState';
import { groupAutomationFlows } from '@/lib/automation-folders';
import {
  NODE_CATEGORY_STYLES, TRIGGER_FAMILIES, getNodeDefinition, getNodeLabel, getTriggerFamily,
} from '@/lib/automation-nodes';
import { FlowStatusPill } from '@/components/automations/FlowStatusPill';
import { RecipeGalleryDialog } from '@/components/automations/RecipeGalleryDialog';
import { SystemFiscalAutomationCard } from '@/components/automations/SystemFiscalAutomationCard';
import {
  useAutomationFlows, useAutomationRunCounts, useCreateAutomationFlow, useDeleteAutomationFlow,
  useDuplicateAutomationFlow, useSetAutomationFlowStatus,
} from '@/hooks/useAutomationFlows';
import {
  useAutomationFolders, useCreateAutomationFolder, useDeleteAutomationFolder, useUpdateAutomationFolder,
} from '@/hooks/useAutomationFolders';
import type { AutomationFlow, AutomationFolder } from '@/types/automations';

export default function Automations() {
  const { data: flows, isLoading } = useAutomationFlows();
  const { data: folders = [] } = useAutomationFolders();
  const { data: runCounts } = useAutomationRunCounts();
  const duplicateFlow = useDuplicateAutomationFlow();
  const deleteFlow = useDeleteAutomationFlow();
  const setStatus = useSetAutomationFlowStatus();
  const createFolder = useCreateAutomationFolder();
  const updateFolder = useUpdateAutomationFolder();
  const deleteFolder = useDeleteAutomationFolder();

  const [galleryOpen, setGalleryOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderToEdit, setFolderToEdit] = useState<AutomationFolder | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<AutomationFolder | null>(null);
  const navigate = useNavigate();
  const createFlow = useCreateAutomationFlow();

  // As n8n does: no wizard. The flow exists the moment the button is pressed
  // and opens in the editor, where the trigger is the first thing to choose.
  const handleCreate = async () => {
    const flow = await createFlow.mutateAsync({ name: 'Automação sem nome', trigger_type: 'lead_created' });
    if (flow?.id) navigate(`/automacoes/${flow.id}?novo=1`);
  };
  const [flowToDelete, setFlowToDelete] = useState<AutomationFlow | null>(null);

  // A pesquisa não persiste (é sempre pontual); os filtros sim, como no resto
  // da app — quem trabalha só nas automações de trials não quer voltar a
  // escolher isso a cada visita.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = usePersistedState('automations-status-v1', 'all');
  const [familyFilter, setFamilyFilter] = usePersistedState('automations-family-v1', 'all');
  const [openFolders, setOpenFolders] = usePersistedState<string[]>('automation-folders-v2', []);

  // Só se oferecem as famílias que a organização REALMENTE tem. Um dropdown com
  // nove opções das quais sete não dão resultado nenhum não ajuda a procurar.
  const availableFamilies = useMemo(() => {
    const present = new Set((flows ?? []).map((f) => getTriggerFamily(f.trigger_type)));
    return TRIGGER_FAMILIES.filter((f) => present.has(f.key));
  }, [flows]);

  const visibleFlows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (flows ?? []).filter((flow) => {
      if (statusFilter !== 'all' && flow.status !== statusFilter) return false;
      if (familyFilter !== 'all' && getTriggerFamily(flow.trigger_type) !== familyFilter) return false;
      if (!term) return true;
      // Procura também pelo nome do gatilho ("lead criada"), que é como se
      // descreve uma automação por palavras, e não pelo id interno.
      const haystack = [
        flow.name,
        flow.description ?? '',
        flow.trigger_type ? getNodeLabel(flow.trigger_type) : '',
      ].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [flows, search, statusFilter, familyFilter]);

  const isFiltered = search.trim() !== '' || statusFilter !== 'all' || familyFilter !== 'all';
  const groupedFlows = useMemo(
    () => groupAutomationFlows(visibleFlows, folders),
    [visibleFlows, folders],
  );

  const openFolderDialog = (folder?: AutomationFolder) => {
    setFolderToEdit(folder ?? null);
    setFolderName(folder?.name ?? '');
    setFolderDialogOpen(true);
  };

  const handleSaveFolder = async () => {
    if (folderToEdit) {
      await updateFolder.mutateAsync({ id: folderToEdit.id, name: folderName });
    } else {
      const folder = await createFolder.mutateAsync({ name: folderName });
      setOpenFolders((current) => current.includes(folder.id) ? current : [...current, folder.id]);
    }
    setFolderDialogOpen(false);
    setFolderName('');
    setFolderToEdit(null);
  };
  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setFamilyFilter('all');
  };

  return (
    <div className="space-y-6 p-4 pb-nav-safe md:p-6 md:pb-6">
      <PageHeader
        icon={Workflow}
        title="Automações"
        subtitle="Fluxos automáticos de WhatsApp, email e ações no CRM"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => openFolderDialog()}>
              <Folder className="mr-2 h-4 w-4" />
              Nova pasta
            </Button>
            <Button variant="outline" onClick={() => setGalleryOpen(true)}>
              <Sparkles className="mr-2 h-4 w-4" />
              Usar modelo
            </Button>
            <Button onClick={handleCreate} disabled={createFlow.isPending}>
              <Plus className="mr-2 h-4 w-4" />
              Nova automação
            </Button>
          </div>
        }
      />

      <SystemFiscalAutomationCard />

      {isLoading ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {[...Array(4)].map((_, index) => (
            <Skeleton key={index} className="h-[60px] rounded-none border-b border-border last:border-b-0" />
          ))}
        </div>
      ) : !flows?.length && folders.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="Ainda não tem automações"
          description="Crie um fluxo para responder a leads no WhatsApp, enviar emails de seguimento ou mover etapas sem intervenção manual."
        >
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => setGalleryOpen(true)}>
              <Sparkles className="mr-2 h-4 w-4" />
              Usar modelo
            </Button>
            <Button onClick={handleCreate} disabled={createFlow.isPending}>
              <Plus className="mr-2 h-4 w-4" />
              Criar primeira automação
            </Button>
          </div>
        </EmptyState>
      ) : (
        <>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Procurar por nome, descrição ou gatilho…"
              className="h-9 pl-9"
            />
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os estados</SelectItem>
              <SelectItem value="active">Ativas</SelectItem>
              <SelectItem value="paused">Em pausa</SelectItem>
              <SelectItem value="draft">Rascunho</SelectItem>
            </SelectContent>
          </Select>

          {availableFamilies.length > 1 && (
            <Select value={familyFilter} onValueChange={setFamilyFilter}>
              <SelectTrigger className="h-9 w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                {availableFamilies.map((family) => (
                  <SelectItem key={family.key} value={family.key}>{family.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {isFiltered && (
            <Button variant="ghost" size="sm" className="h-9 shrink-0 text-muted-foreground" onClick={clearFilters}>
              <X className="mr-1 h-4 w-4" />
              Limpar
            </Button>
          )}
        </div>

        {visibleFlows.length === 0 && folders.length === 0 ? (
          <EmptyState
            icon={Search}
            title="Nenhuma automação encontrada"
            description="Nenhuma automação corresponde à pesquisa ou aos filtros escolhidos."
          >
            <Button variant="outline" onClick={clearFilters}>Limpar filtros</Button>
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {folders.length > 0 && (
              <Accordion type="multiple" value={openFolders} onValueChange={setOpenFolders} className="overflow-hidden rounded-2xl border border-border bg-card">
                {groupedFlows.folders.map(({ folder, flows: folderFlows }) => (
                  <AutomationFolder
                    key={folder.id}
                    folder={folder}
                    flows={folderFlows}
                    runCounts={runCounts}
                    onDuplicate={(id) => duplicateFlow.mutate(id)}
                    onDelete={setFlowToDelete}
                    onEdit={openFolderDialog}
                    onDeleteFolder={setFolderToDelete}
                    onToggleStatus={(flow) => setStatus.mutate({ id: flow.id, status: flow.status === 'active' ? 'paused' : 'active', version: flow.version })}
                  />
                ))}
              </Accordion>
            )}
            {groupedFlows.unfiled.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="border-b border-border px-4 py-3 text-sm font-semibold">
                  Sem pasta <span className="ml-1 text-xs font-medium text-muted-foreground">{groupedFlows.unfiled.length}</span>
                </div>
                {groupedFlows.unfiled.map((flow) => (
                  <FlowRow
                    key={flow.id}
                    flow={flow}
                    counts={runCounts?.[flow.id]}
                    onDuplicate={() => duplicateFlow.mutate(flow.id)}
                    onDelete={() => setFlowToDelete(flow)}
                    onToggleStatus={() => setStatus.mutate({ id: flow.id, status: flow.status === 'active' ? 'paused' : 'active', version: flow.version })}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        </>
      )}

      <RecipeGalleryDialog open={galleryOpen} onOpenChange={setGalleryOpen} />

      <Dialog
        open={folderDialogOpen}
        onOpenChange={(open) => {
          setFolderDialogOpen(open);
          if (!open) {
            setFolderName('');
            setFolderToEdit(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{folderToEdit ? 'Mudar nome da pasta' : 'Nova pasta'}</DialogTitle>
            <DialogDescription>
              Organize as automações como quiser. A pasta não muda o funcionamento do fluxo.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveFolder();
            }}
          >
            <Input
              autoFocus
              maxLength={80}
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              placeholder="Ex.: Pós-venda"
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFolderDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={!folderName.trim() || createFolder.isPending || updateFolder.isPending}>
                {folderToEdit ? 'Guardar' : 'Criar pasta'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!flowToDelete} onOpenChange={(open) => !open && setFlowToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar automação?</AlertDialogTitle>
            <AlertDialogDescription>
              A automação <strong>{flowToDelete?.name}</strong> e o respetivo histórico de execuções
              serão eliminados. Esta ação não pode ser revertida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (flowToDelete) deleteFlow.mutate(flowToDelete.id);
                setFlowToDelete(null);
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!folderToDelete} onOpenChange={(open) => !open && setFolderToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar pasta?</AlertDialogTitle>
            <AlertDialogDescription>
              As automações em <strong>{folderToDelete?.name}</strong> ficam sem pasta. Nenhuma automação será eliminada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (folderToDelete) deleteFolder.mutate(folderToDelete.id);
                setFolderToDelete(null);
              }}
            >
              Eliminar pasta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface AutomationFolderProps {
  folder: AutomationFolder;
  flows: AutomationFlow[];
  runCounts: Record<string, { active: number; failed: number; completed: number; total: number }> | undefined;
  onDuplicate: (id: string) => void;
  onDelete: (flow: AutomationFlow) => void;
  onEdit: (folder: AutomationFolder) => void;
  onDeleteFolder: (folder: AutomationFolder) => void;
  onToggleStatus: (flow: AutomationFlow) => void;
}

function AutomationFolder({ folder, flows, runCounts, onDuplicate, onDelete, onEdit, onDeleteFolder, onToggleStatus }: AutomationFolderProps) {
  return (
    <AccordionItem value={folder.id} className="border-b border-border last:border-b-0">
      <div className="flex items-center pr-2 hover:bg-muted/40">
        <AccordionTrigger className="flex-1 px-4 py-3 hover:no-underline">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Folder className="h-4 w-4 text-primary" />
            {folder.name}
            <span className="text-xs font-medium text-muted-foreground">{flows.length}</span>
          </span>
        </AccordionTrigger>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Gerir pasta ${folder.name}`}>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(folder)}>
              <Pencil className="mr-2 h-4 w-4" />
              Mudar nome
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDeleteFolder(folder)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Eliminar pasta
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AccordionContent className="pb-0">
        {flows.length ? flows.map((flow) => (
          <FlowRow
            key={flow.id}
            flow={flow}
            counts={runCounts?.[flow.id]}
            onDuplicate={() => onDuplicate(flow.id)}
            onDelete={() => onDelete(flow)}
            onToggleStatus={() => onToggleStatus(flow)}
          />
        )) : (
          <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">Nenhuma automação com os filtros atuais.</p>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

interface FlowRowProps {
  flow: AutomationFlow;
  counts?: { active: number; failed: number; completed: number; total: number };
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
}

/**
 * Uma linha por automação. Era um cartão de ~176px numa grelha de 3 colunas, o
 * que dava três linhas de grelha para meia dúzia de fluxos e obrigava a
 * percorrer o ecrã para os ver todos. A descrição saiu da lista de propósito —
 * nos fluxos convertidos é toda a mesma frase, e o que distingue uma automação
 * é o gatilho, não o texto. Fica no atributo `title` e no editor.
 */
function FlowRow({ flow, counts, onDuplicate, onDelete, onToggleStatus }: FlowRowProps) {
  const triggerDefinition = getNodeDefinition(flow.trigger_type ?? '');
  const TriggerIcon = triggerDefinition?.icon ?? Zap;
  const triggerStyle = NODE_CATEGORY_STYLES.trigger;
  const stepCount = flow.graph?.nodes?.length ?? 0;
  const isActive = flow.status === 'active';
  const failed = counts?.failed ?? 0;

  return (
    <div className="group flex items-center gap-3 border-b border-border px-3 py-2.5 transition-colors last:border-b-0 hover:bg-muted/40 sm:px-4">
      {/* O Link cobre só o conteúdo: os botões são irmãos, nunca aninhados nele. */}
      <Link to={`/automacoes/${flow.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-2',
            triggerStyle.bg,
            triggerStyle.ring,
          )}
        >
          <TriggerIcon className={cn('h-4 w-4', triggerStyle.icon)} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground" title={flow.description ?? undefined}>
              {flow.name}
            </h3>
            <FlowStatusPill status={flow.status} className="shrink-0" />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {triggerDefinition?.label ?? 'Sem gatilho'}
            {' · '}{stepCount} {stepCount === 1 ? 'passo' : 'passos'}
            {flow.updated_at ? ` · editada ${formatRelativeTime(flow.updated_at)}` : ''}
          </p>
        </div>
      </Link>

      {/* Contadores: escondidos no telemóvel, onde só cabe nome + ações. */}
      <div className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground md:flex">
        <span className="tabular-nums">
          <strong className={cn('font-semibold', (counts?.active ?? 0) > 0 ? 'text-primary' : 'text-foreground')}>
            {counts?.active ?? 0}
          </strong>{' '}
          em curso
        </span>
        {failed > 0 && (
          <span
            className="inline-flex items-center gap-1 font-semibold text-destructive tabular-nums"
            title="Nos últimos 7 dias. O histórico completo está no separador Atividade do fluxo."
          >
            <AlertCircle className="h-3.5 w-3.5" />
            {failed} {failed === 1 ? 'falha' : 'falhas'} em 7 dias
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          className={cn('h-7 px-2 text-xs', isActive ? 'text-warning' : 'text-success')}
          onClick={onToggleStatus}
        >
          {isActive ? (
            <><Pause className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Pausar</span></>
          ) : (
            <><Play className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Ativar</span></>
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="mr-2 h-4 w-4" />
              Duplicar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
              <Trash2 className="mr-2 h-4 w-4" />
              Eliminar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
