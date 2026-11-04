import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useFidelizationAlerts, type CpeWithClient } from '@/hooks/useFidelizationAlerts';
import { useAuth } from '@/contexts/AuthContext';
import { Zap, AlertTriangle, Clock, ChevronRight, Loader2, XCircle, RefreshCw, ArrowRightLeft } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { dateLocale, useLanguage } from '@/i18n';
import { RenewCpeModal } from '@/components/clients/RenewCpeModal';
import { SwitchComercializadorModal } from '@/components/clients/SwitchComercializadorModal';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function AlertCard({ cpe, variant, onRenew, onSwitch }: { 
  cpe: CpeWithClient; 
  variant: 'expired' | 'urgent' | 'upcoming';
  onRenew: (cpe: CpeWithClient) => void;
  onSwitch: (cpe: CpeWithClient) => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const bgClass = variant === 'expired' ? 'bg-destructive/5 border-destructive/20' 
    : variant === 'urgent' ? 'bg-destructive/5 border-destructive/20' 
    : 'bg-warning/5 border-warning/20';

  return (
    <div className={`p-3 rounded-md transition-colors border ${bgClass}`}>
      <button
        onClick={() => navigate(`/clients?highlight=${cpe.client_id}`)}
        className="w-full text-left"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium truncate">{cpe.client_name}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {cpe.equipment_type} | {cpe.comercializador} | {format(new Date(cpe.fidelizacao_end), 'dd/MM/yyyy', { locale: dateLocale() })}
          {cpe.days_until_expiry <= 0 && (
            <span className="text-destructive font-medium ml-1">
              {t("(expirado há {{n}} dias)", { n: Math.abs(cpe.days_until_expiry) })}
            </span>
          )}
        </div>
      </button>
      <div className="flex gap-1.5 mt-2">
        <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1" onClick={() => onRenew(cpe)}>
          <RefreshCw className="h-3 w-3" /> {t("Renovar")}
        </Button>
        <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1" onClick={() => onSwitch(cpe)}>
          <ArrowRightLeft className="h-3 w-3" /> {t("Alterar")}
        </Button>
      </div>
    </div>
  );
}

export function FidelizationAlertsWidget() {
  const { t } = useLanguage();
  const { data, isLoading } = useFidelizationAlerts();
  const { organization } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [renewCpe, setRenewCpe] = useState<CpeWithClient | null>(null);
  const [switchCpe, setSwitchCpe] = useState<CpeWithClient | null>(null);

  const isTelecom = organization?.niche === 'telecom';
  const title = isTelecom ? t('CPE/CUI a Expirar') : t('Fidelizações a Expirar');

  if (isLoading) {
    return (
      <Card className="lg:col-span-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const { urgent = [], upcoming = [], expired = [] } = data || {};
  const totalAlerts = expired.length + urgent.length + upcoming.length;
  const allItems = [...expired, ...urgent, ...upcoming];
  const previewItems = allItems.slice(0, 2);
  const remaining = totalAlerts - previewItems.length;

  if (totalAlerts === 0) {
    return (
      <Card className="lg:col-span-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-6 text-center">
          <p className="text-sm text-muted-foreground">{t("Sem alertas pendentes")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card
        className="lg:col-span-1 cursor-pointer hover:border-primary/30 transition-colors"
        onClick={() => setModalOpen(true)}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              {title}
            </CardTitle>
            <Badge variant="secondary" className="text-xs">{totalAlerts}</Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-1.5">
          {previewItems.map((cpe) => (
            <div key={cpe.id} className="text-sm text-muted-foreground truncate">
              {cpe.client_name} — {format(new Date(cpe.fidelizacao_end), 'dd/MM/yyyy', { locale: dateLocale() })}
            </div>
          ))}
          {remaining > 0 && (
            <p className="text-xs text-primary font-medium">{t("+ {{n}} mais...", { n: remaining })}</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent variant="fullScreen" className="flex flex-col overflow-hidden p-0 gap-0">
          <DialogHeader className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
            <div className="flex items-center gap-3">
              <DialogTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                {title}
              </DialogTitle>
              <DialogDescription className="sr-only">{t("Lista de alertas de fidelização a expirar")}</DialogDescription>
              <Badge variant="secondary">{totalAlerts}</Badge>
            </div>
          </DialogHeader>
          <ScrollArea className="flex-1 px-4 pb-4 sm:px-6 sm:pb-6">
            <div className="space-y-6 pt-2">
              {expired.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-destructive">
                    <XCircle className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">{t("Expirados")}</span>
                    <Badge variant="destructive" className="text-xs ml-auto">{expired.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {expired.map((cpe) => (
                      <AlertCard key={cpe.id} cpe={cpe} variant="expired" onRenew={setRenewCpe} onSwitch={setSwitchCpe} />
                    ))}
                  </div>
                </div>
              )}

              {urgent.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">{t("Urgente (7 dias)")}</span>
                    <Badge variant="destructive" className="text-xs ml-auto">{urgent.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {urgent.map((cpe) => (
                      <AlertCard key={cpe.id} cpe={cpe} variant="urgent" onRenew={setRenewCpe} onSwitch={setSwitchCpe} />
                    ))}
                  </div>
                </div>
              )}

              {upcoming.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-warning">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">{t("Próximos 30 dias")}</span>
                    <Badge variant="outline" className="text-xs ml-auto border-warning/50 text-warning">{upcoming.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {upcoming.map((cpe) => (
                      <AlertCard key={cpe.id} cpe={cpe} variant="upcoming" onRenew={setRenewCpe} onSwitch={setSwitchCpe} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {renewCpe && (
        <RenewCpeModal
          cpeId={renewCpe.id}
          currentEnd={renewCpe.fidelizacao_end}
          open={!!renewCpe}
          onOpenChange={(open) => !open && setRenewCpe(null)}
        />
      )}

      {switchCpe && (
        <SwitchComercializadorModal
          cpeId={switchCpe.id}
          currentComercializador={switchCpe.comercializador}
          open={!!switchCpe}
          onOpenChange={(open) => !open && setSwitchCpe(null)}
        />
      )}
    </>
  );
}
