import { useState, useMemo, useRef, useLayoutEffect } from 'react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { MessageCircle, Eye, Trash2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useModules } from '@/hooks/useModules';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

import { Lead, LeadTemperature, LeadTipologia, TEMPERATURE_STYLES, TIPOLOGIA_LABELS, TIPOLOGIA_STYLES } from '@/types';
import { formatCurrency, formatPhoneForWhatsApp } from '@/lib/format';
import { isPlaceholderEmail } from '@/lib/leadUtils';
import { cn } from '@/lib/utils';
import { usePipelineStages, PipelineStage } from '@/hooks/usePipelineStages';
import { useLeadProposalValues } from '@/hooks/useLeadProposalValues';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { Skeleton } from '@/components/ui/skeleton';

interface LeadsTableViewProps {
  leads: Lead[];
  onStatusChange: (leadId: string, status: string) => void;
  onTemperatureChange: (leadId: string, temperature: LeadTemperature) => void;
  onViewDetails: (lead: Lead) => void;
  onDelete: (leadId: string) => void;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
}

type SortField = 'name' | 'email' | 'status' | 'temperature' | 'tipologia' | 'value' | 'consumo_anual' | 'source' | 'created_at';
type SortDirection = 'asc' | 'desc';

// Helper to generate badge style from hex color
const getStatusBadgeStyle = (hexColor: string) => ({
  backgroundColor: `${hexColor}20`,
  color: hexColor,
  borderColor: `${hexColor}30`,
});

export function LeadsTableView({
  leads,
  onStatusChange,
  onTemperatureChange,
  onViewDetails,
  onDelete,
  selectedIds = [],
  onSelectionChange,
}: LeadsTableViewProps) {
  const { data: stages = [], isLoading: stagesLoading } = usePipelineStages();
  const { data: proposalValues } = useLeadProposalValues();
  const { organization } = useAuth();
  const { isAdmin } = usePermissions();
  const isTelecom = organization?.niche === 'telecom';
  const { modules } = useModules();
  const showEnergy = isTelecom && modules.energy;

  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSelectAll = (checked: boolean) => {
    if (!onSelectionChange) return;
    if (checked) {
      onSelectionChange(leads.map(l => l.id));
    } else {
      onSelectionChange([]);
    }
  };

  const handleSelectOne = (leadId: string, checked: boolean) => {
    if (!onSelectionChange) return;
    if (checked) {
      onSelectionChange([...selectedIds, leadId]);
    } else {
      onSelectionChange(selectedIds.filter(id => id !== leadId));
    }
  };

  const allSelected = leads.length > 0 && selectedIds.length === leads.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < leads.length;

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedLeads = useMemo(() => {
    return [...leads].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'email':
          comparison = a.email.localeCompare(b.email);
          break;
        case 'status':
          comparison = (a.status || '').localeCompare(b.status || '');
          break;
        case 'temperature':
          comparison = (a.temperature || '').localeCompare(b.temperature || '');
          break;
        case 'tipologia':
          comparison = (a.tipologia || '').localeCompare(b.tipologia || '');
          break;
        case 'value':
          comparison = (a.value || 0) - (b.value || 0);
          break;
        case 'consumo_anual':
          comparison = (a.consumo_anual || 0) - (b.consumo_anual || 0);
          break;
        case 'source':
          comparison = (a.source || '').localeCompare(b.source || '');
          break;
        case 'created_at':
          comparison = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [leads, sortField, sortDirection]);

  // Window virtualization: only the rows on screen stay in the DOM, so a large
  // lead list (each row carries a Select + AlertDialog) no longer crashes.
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const virtualizer = useWindowVirtualizer({
    count: sortedLeads.length,
    estimateSize: () => 64,
    overscan: 10,
    scrollMargin,
    getItemKey: (index) => sortedLeads[index]?.id ?? index,
  });

  useLayoutEffect(() => {
    const measure = () => {
      if (!tableBodyRef.current) return;
      const top = tableBodyRef.current.getBoundingClientRect().top + window.scrollY;
      setScrollMargin((prev) => (Math.abs(prev - top) > 1 ? top : prev));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  const handleWhatsAppClick = (phone: string, name: string) => {
    const formattedPhone = formatPhoneForWhatsApp(phone);
    const message = encodeURIComponent(`Olá ${name}! `);
    window.open(`https://wa.me/${formattedPhone}?text=${message}`, '_blank');
  };

  // Find stage by key for dynamic labels and colors
  const getStageByKey = (key: string): PipelineStage | undefined => {
    return stages.find(s => s.key === key);
  };

  const getStatusLabel = (statusKey: string): string => {
    const stage = getStageByKey(statusKey);
    return stage?.name || statusKey || 'Desconhecido';
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground" />;
    }
    return sortDirection === 'asc'
      ? <ArrowUp className="ml-1 h-3 w-3" />
      : <ArrowDown className="ml-1 h-3 w-3" />;
  };

  const SortableHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8 hover:bg-transparent"
      onClick={() => handleSort(field)}
    >
      {children}
      <SortIcon field={field} />
    </Button>
  );

  if (stagesLoading) {
    return (
      <div className="rounded-lg border border-border bg-card overflow-hidden p-4">
        <Skeleton className="h-10 w-full mb-2" />
        <Skeleton className="h-16 w-full mb-2" />
        <Skeleton className="h-16 w-full mb-2" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const colSpan = showEnergy ? 11 : 10;
  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start - scrollMargin : 0;
  const paddingBottom = virtualItems.length > 0
    ? virtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1].end - scrollMargin)
    : 0;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <Table className="leads-table">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {onSelectionChange && (
                <TableHead className="w-[50px]">
                  <Checkbox
                    checked={allSelected}
                    ref={(ref) => {
                      if (ref) {
                        (ref as HTMLButtonElement).dataset.state = someSelected ? 'indeterminate' : allSelected ? 'checked' : 'unchecked';
                      }
                    }}
                    onCheckedChange={handleSelectAll}
                    aria-label="Selecionar todos"
                  />
                </TableHead>
              )}
              <TableHead className="w-[200px]">
                <SortableHeader field="name">Nome</SortableHeader>
              </TableHead>
              <TableHead className="leads-column-email hidden md:table-cell">
                <SortableHeader field="email">Email</SortableHeader>
              </TableHead>
              <TableHead className="leads-column-phone">Telefone</TableHead>
              <TableHead>
                <SortableHeader field="status">Status</SortableHeader>
              </TableHead>
              <TableHead className="leads-column-secondary hidden sm:table-cell">
                <SortableHeader field="temperature">Temp.</SortableHeader>
              </TableHead>
              {showEnergy && (
                <TableHead className="leads-column-secondary hidden sm:table-cell">
                  <SortableHeader field="tipologia">Tipologia</SortableHeader>
                </TableHead>
              )}
              <TableHead className="leads-column-secondary hidden lg:table-cell">
                {showEnergy ? (
                  <SortableHeader field="consumo_anual">Consumo (kWh)</SortableHeader>
                ) : (
                  <SortableHeader field="value">Valor</SortableHeader>
                )}
              </TableHead>
              <TableHead className="leads-column-secondary hidden lg:table-cell">
                <SortableHeader field="source">Fonte</SortableHeader>
              </TableHead>
              <TableHead className="leads-column-secondary hidden lg:table-cell">
                <SortableHeader field="created_at">Criado</SortableHeader>
              </TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={tableBodyRef}>
            {sortedLeads.length === 0 ? (
            <TableRow>
                <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
                  Nenhum lead encontrado.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {paddingTop > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={colSpan} style={{ height: paddingTop, padding: 0 }} />
                  </tr>
                )}
                {virtualItems.map((item) => {
                  const lead = sortedLeads[item.index];
                  if (!lead) return null;
                  const currentStage = getStageByKey(lead.status || '');
                  const isSelected = selectedIds.includes(lead.id);
                  return (
                  <TableRow
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    className={cn(
                      "cursor-pointer hover:bg-muted/50",
                      isSelected && "bg-primary/5"
                    )}
                    onClick={() => onViewDetails(lead)}
                  >
                    {onSelectionChange && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => handleSelectOne(lead.id, !!checked)}
                          aria-label={`Selecionar ${lead.name}`}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="leads-name">
                        <span className="font-medium truncate max-w-[150px] block">
                          {isTelecom ? (lead.company_name || lead.name) : lead.name}
                        </span>
                        {isTelecom ? (
                          lead.name && lead.name !== lead.company_name && (
                            <span className="text-xs text-muted-foreground truncate max-w-[150px] block">{lead.name}</span>
                          )
                        ) : (
                          lead.company_name && (
                            <span className="text-xs text-muted-foreground truncate max-w-[150px] block">{lead.company_name}</span>
                          )
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="leads-column-email hidden md:table-cell">
                      <span className="text-muted-foreground truncate max-w-[180px] block">
                        {isPlaceholderEmail(lead.email) ? '—' : lead.email}
                      </span>
                    </TableCell>
                    <TableCell className="leads-column-phone" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-2 text-green-500 hover:text-green-400 hover:bg-green-500/10"
                        onClick={() => handleWhatsAppClick(lead.phone, lead.name)}
                      >
                        <MessageCircle className="h-4 w-4" />
                        <span className="hidden sm:inline truncate max-w-[100px]">{lead.phone}</span>
                      </Button>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const isFinal = currentStage?.is_final_positive || currentStage?.is_final_negative;
                        const isLocked = isFinal && !isAdmin;
                        return (
                      <Select
                        value={lead.status || ''}
                        onValueChange={(value) => onStatusChange(lead.id, value)}
                        disabled={isLocked}
                      >
                        <SelectTrigger className="leads-status w-[130px] h-8 border-0 bg-transparent p-0">
                          <span
                            className="inline-flex h-[26px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold"
                            style={currentStage ? getStatusBadgeStyle(currentStage.color) : undefined}
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                            {getStatusLabel(lead.status || '')}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {stages.map((stage) => (
                            <SelectItem key={stage.id} value={stage.key}>
                              <span
                                className="inline-flex h-[26px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold"
                                style={getStatusBadgeStyle(stage.color)}
                              >
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                                {stage.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="leads-column-secondary hidden sm:table-cell" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={lead.temperature || 'warm'}
                        onValueChange={(value) => onTemperatureChange(lead.id, value as LeadTemperature)}
                      >
                        <SelectTrigger className="w-[90px] h-8 border-0 bg-transparent p-0">
                          <span className="text-lg">
                            {TEMPERATURE_STYLES[lead.temperature as LeadTemperature || 'warm'].emoji}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {(['cold', 'warm', 'hot'] as LeadTemperature[]).map((temp) => (
                            <SelectItem key={temp} value={temp}>
                              <div className="flex items-center gap-2">
                                <span>{TEMPERATURE_STYLES[temp].emoji}</span>
                                <span className="capitalize">{temp}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    {/* Tipologia column - Only for Telecom */}
                    {showEnergy && (
                      <TableCell className="leads-column-secondary hidden sm:table-cell">
                        {lead.tipologia && TIPOLOGIA_STYLES[lead.tipologia] ? (
                          <Badge
                            variant="outline"
                            className={cn("text-xs gap-1", TIPOLOGIA_STYLES[lead.tipologia].color, TIPOLOGIA_STYLES[lead.tipologia].bgClass)}
                          >
                            <span>{TIPOLOGIA_STYLES[lead.tipologia].emoji}</span>
                            {TIPOLOGIA_LABELS[lead.tipologia] || lead.tipologia}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    )}
                    {/* Conditional: Consumo for Telecom, Value for others */}
                    <TableCell className="leads-column-secondary hidden lg:table-cell">
                      {showEnergy ? (
                        lead.consumo_anual ? (
                          <span className="font-medium text-primary">
                            {new Intl.NumberFormat('pt-PT').format(lead.consumo_anual)} kWh
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )
                      ) : (
                        (() => {
                          const pValue = proposalValues?.get(lead.id);
                          const displayValue = pValue || lead.value;
                          if (!displayValue) return <span className="text-muted-foreground">-</span>;
                          return (
                            <span className="font-medium text-primary">
                              {formatCurrency(displayValue)}
                              {pValue && (
                                <span className="text-xs font-normal text-muted-foreground ml-1">(propostas)</span>
                              )}
                            </span>
                          );
                        })()
                      )}
                    </TableCell>
                    <TableCell className="leads-column-secondary hidden lg:table-cell">
                      <span className="text-muted-foreground text-sm">
                        {lead.source || '-'}
                      </span>
                    </TableCell>
                    <TableCell className="leads-column-secondary hidden lg:table-cell">
                      <span className="text-muted-foreground text-sm">
                        {lead.created_at
                          ? format(new Date(lead.created_at), 'dd MMM yyyy', { locale: pt })
                          : '-'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => onViewDetails(lead)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Eliminar Lead</AlertDialogTitle>
                              <AlertDialogDescription>
                                Tens a certeza que queres eliminar {lead.name}? Esta ação não pode ser revertida.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => onDelete(lead.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Eliminar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
                {paddingBottom > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={colSpan} style={{ height: paddingBottom, padding: 0 }} />
                  </tr>
                )}
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
