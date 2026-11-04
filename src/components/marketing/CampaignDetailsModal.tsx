import { useState, useMemo, useEffect, useRef } from "react";
import { Mail, CheckCircle2, AlertCircle, Eye, MousePointer, Search, ArrowLeft, RefreshCw, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCampaignSends, useSyncCampaignSends } from "@/hooks/useCampaigns";
import type { EmailCampaign, EmailSendWithTracking } from "@/types/marketing";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_STYLES } from "@/types/marketing";
import { format } from "date-fns";
import { normalizeString } from "@/lib/utils";
import { CampaignEmailPreview } from "@/components/marketing/CampaignEmailPreview";
import { useLanguage } from "@/i18n";

type MetricFilter = 'all' | 'delivered' | 'opened' | 'clicked' | 'failed';

type CampaignMetric = {
  label: string;
  value: number;
  pct?: number;
  icon: typeof Mail;
  iconStyle?: { color: string };
  filterKey: MetricFilter;
};

interface CampaignDetailsModalProps {
  campaign: EmailCampaign | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CampaignDetailsPanelProps {
  campaign: EmailCampaign;
  activeFilter: MetricFilter | null;
  filteredSends: EmailSendWithTracking[];
  metrics: CampaignMetric[];
  progress: number;
  recipientSearch: string;
  setActiveFilter: (filter: MetricFilter | null) => void;
  setRecipientSearch: (value: string) => void;
}

const FILTER_LABELS: Record<MetricFilter, string> = {
  all: 'Todos',
  delivered: 'Enviados',
  opened: 'Aberturas',
  clicked: 'Cliques',
  failed: 'Erros',
};

function CampaignDetailsPanel({
  campaign,
  activeFilter,
  filteredSends,
  metrics,
  progress,
  recipientSearch,
  setActiveFilter,
  setRecipientSearch,
}: CampaignDetailsPanelProps) {
  const { t } = useLanguage();
  const handleFilterClick = (filterKey: MetricFilter) => {
    setActiveFilter(activeFilter === filterKey ? null : filterKey);
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {metrics.map((metric) => (
          <button
            key={metric.label}
            type="button"
            onClick={() => handleFilterClick(metric.filterKey)}
            className={`rounded-lg border bg-muted/50 p-4 text-center transition-all hover:border-primary/50 ${
              activeFilter === metric.filterKey ? 'border-primary ring-2 ring-primary' : ''
            }`}
          >
            <metric.icon className="mx-auto mb-2 h-5 w-5" style={metric.iconStyle} />
            <p className="text-2xl font-bold">
              {metric.value}
              {metric.pct !== undefined && <span className="ml-1 text-xs font-normal text-muted-foreground">({metric.pct}%)</span>}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t(metric.label)}</p>
          </button>
        ))}
      </div>

      {campaign.status === 'sending' && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t("Progresso")}</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} />
        </div>
      )}

      <div className="space-y-2 rounded-lg border bg-muted/50 p-4 text-sm">
        {campaign.template && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t("Template:")}</span>
            <span className="font-medium text-right">{campaign.template.name}</span>
          </div>
        )}
        {(campaign.subject || campaign.template?.subject) && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t("Assunto:")}</span>
            <span className="font-medium text-right">{campaign.subject || campaign.template?.subject}</span>
          </div>
        )}
        {campaign.sent_at && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t("Enviada em:")}</span>
            <span className="text-right">{format(new Date(campaign.sent_at), "dd/MM/yyyy HH:mm")}</span>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{t("Destinatários ({{n}})", { n: filteredSends.length })}</p>
            {activeFilter && (
              <Badge variant="secondary" className="gap-1 text-xs">
                {t(FILTER_LABELS[activeFilter])}
                <button type="button" onClick={() => setActiveFilter(null)} aria-label={t("Limpar filtro")}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("Pesquisar destinatário...")}
            value={recipientSearch}
            onChange={(e) => setRecipientSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="overflow-hidden rounded-lg border">
          <div className="divide-y">
            {filteredSends.map((send) => (
              <div key={send.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{send.recipient_name || send.recipient_email}</p>
                  <p className="truncate text-xs text-muted-foreground">{send.recipient_email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {send.opened_at && <Eye className="h-3.5 w-3.5" style={{ color: 'hsl(var(--accent-foreground))' }} />}
                  {send.clicked_at && <MousePointer className="h-3.5 w-3.5" style={{ color: 'hsl(var(--primary))' }} />}
                  {(send.status === 'failed' || send.status === 'bounced') ? (
                    <Badge variant="destructive" className="text-xs">{t("Erro")}</Badge>
                  ) : send.status === 'delivered' ? (
                    <Badge variant="secondary" className="text-xs">{t("Entregue")}</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">{t("Enviado")}</Badge>
                  )}
                </div>
              </div>
            ))}

            {filteredSends.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {recipientSearch || activeFilter ? t('Nenhum destinatário encontrado') : t('Sem dados de envio')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CampaignDetailsModal({ campaign, open, onOpenChange }: CampaignDetailsModalProps) {
  const { data: sends = [], isFetching } = useCampaignSends(campaign?.id || null);
  const { mutate: syncSends, isPending: isSyncing } = useSyncCampaignSends();
  const [recipientSearch, setRecipientSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<MetricFilter | null>(null);
  const hasSyncedRef = useRef<string | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    if (open && campaign?.id && hasSyncedRef.current !== campaign.id) {
      hasSyncedRef.current = campaign.id;
      if (campaign.status === 'sent' || campaign.status === 'sending' || campaign.status === 'failed') {
        syncSends(campaign.id);
      }
    }
    if (!open) {
      hasSyncedRef.current = null;
      setActiveFilter(null);
      setRecipientSearch("");
    }
  }, [open, campaign?.id, campaign?.status, syncSends]);

  const opened = sends.filter((send) => send.opened_at).length;
  const clicked = sends.filter((send) => send.clicked_at).length;
  const failed = sends.filter((send) => send.status === 'failed' || send.status === 'bounced').length;
  const delivered = sends.filter((send) => send.status === 'sent' || send.status === 'delivered').length;

  const totalRecipients = campaign?.total_recipients ?? 0;
  const progress = totalRecipients > 0 ? Math.round((((campaign?.sent_count ?? 0) + (campaign?.failed_count ?? 0)) / totalRecipients) * 100) : 0;
  const style = campaign ? CAMPAIGN_STATUS_STYLES[campaign.status] : CAMPAIGN_STATUS_STYLES.draft;

  const openPct = totalRecipients > 0 ? Math.round((opened / totalRecipients) * 100) : 0;
  const clickPct = totalRecipients > 0 ? Math.round((clicked / totalRecipients) * 100) : 0;

  const filteredSends = useMemo(() => {
    let result = sends;

    if (activeFilter === 'delivered') {
      result = result.filter((send) => send.status === 'sent' || send.status === 'delivered');
    } else if (activeFilter === 'opened') {
      result = result.filter((send) => send.opened_at);
    } else if (activeFilter === 'clicked') {
      result = result.filter((send) => send.clicked_at);
    } else if (activeFilter === 'failed') {
      result = result.filter((send) => send.status === 'failed' || send.status === 'bounced' || send.status === 'blocked' || send.status === 'spam');
    }

    if (recipientSearch) {
      const query = normalizeString(recipientSearch);
      result = result.filter((send) =>
        normalizeString(send.recipient_name || '').includes(query) ||
        normalizeString(send.recipient_email).includes(query)
      );
    }

    return result;
  }, [sends, recipientSearch, activeFilter]);

  if (!campaign) return null;

  const metrics: CampaignMetric[] = [
    { label: 'Destinatários', value: campaign.total_recipients, icon: Mail, iconStyle: { color: 'hsl(var(--foreground))' }, filterKey: 'all' },
    { label: 'Enviados', value: delivered, icon: CheckCircle2, iconStyle: { color: 'hsl(var(--primary))' }, filterKey: 'delivered' },
    { label: 'Aberturas', value: opened, pct: openPct, icon: Eye, iconStyle: { color: 'hsl(var(--accent-foreground))' }, filterKey: 'opened' },
    { label: 'Cliques', value: clicked, pct: clickPct, icon: MousePointer, iconStyle: { color: 'hsl(var(--primary))' }, filterKey: 'clicked' },
    { label: 'Erros', value: failed, icon: AlertCircle, iconStyle: { color: 'hsl(var(--destructive))' }, filterKey: 'failed' },
  ];

  const previewHtml = campaign.html_content || campaign.template?.html_content || '';
  const previewSubject = campaign.subject || campaign.template?.subject || '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="fullScreen" className="flex flex-col gap-0 p-0">
        <div className="border-b bg-card">
          <div className="flex w-full items-center gap-3 px-4 py-4 md:px-6">
            <Button variant="back" size="icon" className="h-8 w-8 shrink-0" onClick={() => onOpenChange(false)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-lg font-semibold">{campaign.name}</DialogTitle>
              <div className="mt-0.5 flex items-center gap-2">
                <Badge className="text-xs" style={{ backgroundColor: style.bg, color: style.text }}>
                  {t(CAMPAIGN_STATUS_LABELS[campaign.status])}
                </Badge>
                {campaign.sent_at && (
                  <span className="text-xs text-muted-foreground">
                    {t("Enviada a {{date}} às {{time}}", { date: format(new Date(campaign.sent_at), "dd/MM/yyyy"), time: format(new Date(campaign.sent_at), "HH:mm") })}
                  </span>
                )}
                {(isFetching || isSyncing) && (
                  <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          <div className="flex h-full flex-col lg:hidden">
            <Tabs defaultValue="dados" className="flex h-full flex-col">
              <div className="border-b px-4 py-3">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="dados">{t("Dados")}</TabsTrigger>
                  <TabsTrigger value="preview">{t("Pré-visualização")}</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="dados" className="mt-0 flex-1 min-h-0">
                <ScrollArea className="h-full">
                  <CampaignDetailsPanel
                    campaign={campaign}
                    activeFilter={activeFilter}
                    filteredSends={filteredSends}
                    metrics={metrics}
                    progress={progress}
                    recipientSearch={recipientSearch}
                    setActiveFilter={setActiveFilter}
                    setRecipientSearch={setRecipientSearch}
                  />
                </ScrollArea>
              </TabsContent>

              <TabsContent value="preview" className="mt-0 flex-1 min-h-0">
                <CampaignEmailPreview
                  htmlContent={previewHtml}
                  subject={previewSubject}
                  className="h-full"
                />
              </TabsContent>
            </Tabs>
          </div>

          <div className="hidden h-full lg:grid lg:grid-cols-2">
            <ScrollArea className="h-full">
              <CampaignDetailsPanel
                campaign={campaign}
                activeFilter={activeFilter}
                filteredSends={filteredSends}
                metrics={metrics}
                progress={progress}
                recipientSearch={recipientSearch}
                setActiveFilter={setActiveFilter}
                setRecipientSearch={setRecipientSearch}
              />
            </ScrollArea>

            <div className="border-l">
              <CampaignEmailPreview
                htmlContent={previewHtml}
                subject={previewSubject}
                className="h-full"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
