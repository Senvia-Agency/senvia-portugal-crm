import { useState } from 'react';
import { format, differenceInDays, isPast } from 'date-fns';
import { Router, Plus, Pencil, Trash2, AlertTriangle, Calendar, Zap, RefreshCw, ArrowLeftRight, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useCpes, useDeleteCpe } from '@/hooks/useCpes';
import { useAuth } from '@/contexts/AuthContext';
import { CPE_STATUS_LABELS, CPE_STATUS_STYLES, NIVEL_TENSAO_LABELS, NIVEL_TENSAO_STYLES, type Cpe, type NivelTensao } from '@/types/cpes';
import { CreateCpeModal } from './CreateCpeModal';
import { EditCpeModal } from './EditCpeModal';
import { RenewCpeModal } from './RenewCpeModal';
import { SwitchComercializadorModal } from './SwitchComercializadorModal';
import { useLanguage, dateLocale, intlLocale } from "@/i18n";

interface CpeListProps {
  clientId: string;
}

export function CpeList({ clientId }: CpeListProps) {
  const { t } = useLanguage();
  const { data: cpes, isLoading } = useCpes(clientId);
  const deleteCpe = useDeleteCpe();
  const { organization } = useAuth();
  
  const [createOpen, setCreateOpen] = useState(false);
  const [editingCpe, setEditingCpe] = useState<Cpe | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [renewCpe, setRenewCpe] = useState<Cpe | null>(null);
  const [switchCpe, setSwitchCpe] = useState<Cpe | null>(null);
  
  // Telecom niche uses energy-specific labels
  const isTelecom = organization?.niche === 'telecom';
  const sectionTitle = isTelecom ? t("Pontos de Consumo (CPE/CUI)") : t("Equipamentos (CPE)");
  const serialLabel = isTelecom ? t("CPE/CUI") : 'S/N';
  const emptyMessage = isTelecom 
    ? t("Nenhum CPE/CUI registado para este cliente.") 
    : t("Nenhum CPE registado para este cliente.");
  const SectionIcon = isTelecom ? Zap : Router;

  const getFidelizacaoStatus = (cpe: Cpe) => {
    if (!cpe.fidelizacao_end) return null;
    
    const endDate = new Date(cpe.fidelizacao_end);
    const daysLeft = differenceInDays(endDate, new Date());
    
    if (isPast(endDate)) {
      return { label: t("Expirada"), variant: 'destructive' as const, className: '' };
    }
    if (daysLeft <= 30) {
      return { label: t("{{n}}d restantes", { n: daysLeft }), variant: 'secondary' as const, className: 'bg-warning/10 text-warning border-warning/20' };
    }
    if (daysLeft <= 90) {
      return { label: t("{{n}}m restantes", { n: Math.ceil(daysLeft / 30) }), variant: 'secondary' as const, className: '' };
    }
    return { label: format(endDate, 'MMM yyyy', { locale: dateLocale() }), variant: 'outline' as const, className: '' };
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <SectionIcon className="h-4 w-4" />
          {sectionTitle}
        </h3>
        <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          {t("Adicionar")}
        </Button>
      </div>

      {cpes?.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center text-muted-foreground text-sm">
            {emptyMessage}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {cpes?.map((cpe) => {
            const statusStyle = CPE_STATUS_STYLES[cpe.status as keyof typeof CPE_STATUS_STYLES];
            const fidelizacao = getFidelizacaoStatus(cpe);
            
            return (
              <Card key={cpe.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Header */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{t(cpe.equipment_type)}</span>
                        {isTelecom && cpe.nivel_tensao ? (
                          <Badge 
                            variant="outline" 
                            className={`${NIVEL_TENSAO_STYLES[cpe.nivel_tensao as NivelTensao]?.bg} ${NIVEL_TENSAO_STYLES[cpe.nivel_tensao as NivelTensao]?.text} ${NIVEL_TENSAO_STYLES[cpe.nivel_tensao as NivelTensao]?.border}`}
                          >
                            {t(NIVEL_TENSAO_LABELS[cpe.nivel_tensao as NivelTensao])}
                          </Badge>
                        ) : !isTelecom && (
                          <Badge 
                            variant="outline" 
                            className={`${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
                          >
                            {t(CPE_STATUS_LABELS[cpe.status as keyof typeof CPE_STATUS_LABELS])}
                          </Badge>
                        )}
                        {cpe.renewal_status === 'renewed' && (
                          <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            {t("Renovado")}
                          </Badge>
                        )}
                        {cpe.renewal_status === 'switched' && (
                          <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/20">
                            <ArrowLeftRight className="h-3 w-3 mr-1" />
                            {t("Comercializador alterado")}
                          </Badge>
                        )}
                      </div>

                      {/* Details */}
                      <div className="text-sm text-muted-foreground space-y-1">
                        <div className="flex items-center gap-4 flex-wrap">
                          <span className="font-medium text-foreground">{cpe.comercializador}</span>
                          {cpe.serial_number && (
                            <span className="font-mono text-xs">{serialLabel}: {cpe.serial_number}</span>
                          )}
                        </div>
                        
                        {/* Fidelização */}
                        {(cpe.fidelizacao_start || cpe.fidelizacao_end) && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <Calendar className="h-3.5 w-3.5" />
                            <span>
                              {cpe.fidelizacao_start && format(new Date(cpe.fidelizacao_start), 'dd/MM/yyyy')}
                              {cpe.fidelizacao_start && cpe.fidelizacao_end && ' → '}
                              {cpe.fidelizacao_end && format(new Date(cpe.fidelizacao_end), 'dd/MM/yyyy')}
                            </span>
                            {fidelizacao && (
                              <Badge variant={fidelizacao.variant} className={`text-xs ${fidelizacao.className}`}>
                                {fidelizacao.variant === 'destructive' && <AlertTriangle className="h-3 w-3 mr-1" />}
                                {fidelizacao.label}
                              </Badge>
                            )}
                          </div>
                        )}

                        {cpe.consumo_anual != null && cpe.consumo_anual > 0 && (
                          <div className="flex items-center gap-2">
                            <Zap className="h-3.5 w-3.5" />
                            <span>{t("Consumo:")} {cpe.consumo_anual.toLocaleString(intlLocale())} {t("kWh/ano")}</span>
                          </div>
                        )}

                        {cpe.notes && (
                          <p className="text-xs italic">{cpe.notes}</p>
                        )}
                      </div>

                      {/* Quick actions for expiring/expired CPEs */}
                      {fidelizacao && (fidelizacao.variant === 'destructive' || (cpe.fidelizacao_end && differenceInDays(new Date(cpe.fidelizacao_end), new Date()) <= 30)) && cpe.renewal_status !== 'renewed' && cpe.renewal_status !== 'switched' && (
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-xs"
                            onClick={() => setRenewCpe(cpe)}
                          >
                            <RefreshCw className="h-3 w-3 mr-1" />
                            {t("Renovar")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => setSwitchCpe(cpe)}
                          >
                            <ArrowLeftRight className="h-3 w-3 mr-1" />
                            {t("Alterar Comercializador")}
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-8 w-8"
                        onClick={() => setEditingCpe(cpe)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteId(cpe.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      <CreateCpeModal 
        open={createOpen} 
        onOpenChange={setCreateOpen} 
        clientId={clientId}
        isTelecom={isTelecom}
      />

      {/* Edit Modal */}
      {editingCpe && (
        <EditCpeModal
          cpe={editingCpe}
          open={!!editingCpe}
          onOpenChange={(open) => !open && setEditingCpe(null)}
          isTelecom={isTelecom}
        />
      )}

      {/* Renew Modal */}
      {renewCpe && renewCpe.fidelizacao_end && (
        <RenewCpeModal
          cpeId={renewCpe.id}
          currentEnd={renewCpe.fidelizacao_end}
          open={!!renewCpe}
          onOpenChange={(open) => !open && setRenewCpe(null)}
        />
      )}

      {/* Switch Comercializador Modal */}
      {switchCpe && (
        <SwitchComercializadorModal
          cpeId={switchCpe.id}
          currentComercializador={switchCpe.comercializador}
          open={!!switchCpe}
          onOpenChange={(open) => !open && setSwitchCpe(null)}
        />
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Remover CPE?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Esta ação não pode ser desfeita. O registo do equipamento será removido permanentemente.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) {
                  deleteCpe.mutate(deleteId);
                  setDeleteId(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("Remover")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
