import { useState } from "react";
import { ArrowLeft, Mail, Eye, MousePointer, AlertTriangle, Loader2, Send, CheckCircle, ShieldAlert, Ban, RefreshCw, Bot, Megaphone, BarChart3 } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useEmailStats } from "@/hooks/useEmailStats";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useEmailTemplates } from "@/hooks/useEmailTemplates";
import { EMAIL_SEND_STATUS_LABELS, EMAIL_SEND_STATUS_STYLES, type EmailSendStatus } from "@/types/marketing";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/i18n";

type Period = '7d' | '30d' | '90d';
type SourceFilter = 'all' | 'campaign' | 'automation';

export default function Reports() {
  const [period, setPeriod] = useState<Period>('30d');
  const [source, setSource] = useState<SourceFilter>('all');
  const [sourceId, setSourceId] = useState<string | null>(null);

  const { data: stats, isLoading } = useEmailStats(period, source, sourceId);
  const { data: campaigns } = useCampaigns();
  const { data: templates } = useEmailTemplates();
  const queryClient = useQueryClient();
  const { t } = useLanguage();

  const handleSourceChange = (v: SourceFilter) => {
    setSource(v);
    setSourceId(null);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['email-stats'] });
  };

  const getOriginLabel = (event: any) => {
    if (event.campaign_id) {
      const camp = campaigns?.find((c: any) => c.id === event.campaign_id);
      return (
        <div className="flex items-center gap-1.5">
          <Megaphone className="h-3 w-3 text-blue-500" />
          <span className="truncate max-w-[120px]">{camp?.name || t('Campanha')}</span>
        </div>
      );
    }
    if ((event as any).automation_id) {
      const tpl = templates?.find((t: any) => t.id === (event as any).automation_id);
      return (
        <div className="flex items-center gap-1.5">
          <Bot className="h-3 w-3 text-purple-500" />
          <span className="truncate max-w-[120px]">{tpl?.name || t('Automação')}</span>
        </div>
      );
    }
    return <span className="text-muted-foreground">{t('Manual')}</span>;
  };

  const metrics = stats ? [
    { label: "Enviados", value: stats.sent, icon: Send, color: "text-foreground", sub: t("{{n}} totais", { n: stats.total }) },
    { label: "Entregues", value: stats.delivered, icon: CheckCircle, color: "text-emerald-500", sub: t("{{rate}}% taxa de entrega", { rate: stats.deliveredRate }) },
    { label: "Abertos", value: stats.opened, icon: Eye, color: "text-blue-500", sub: t("{{rate}}% taxa de abertura", { rate: stats.openRate }) },
    { label: "Clicados", value: stats.clicked, icon: MousePointer, color: "text-purple-500", sub: t("{{rate}}% taxa de clique", { rate: stats.clickRate }) },
    { label: "Bounces", value: stats.bounced, icon: AlertTriangle, color: "text-yellow-500", sub: stats.sent > 0 ? `${Math.round((stats.bounced / stats.sent) * 100)}%` : '0%' },
    { label: "Spam", value: stats.spam, icon: ShieldAlert, color: "text-destructive", sub: stats.sent > 0 ? `${Math.round((stats.spam / stats.sent) * 100)}%` : '0%' },
    { label: "Bloqueados", value: stats.blocked, icon: Ban, color: "text-muted-foreground", sub: stats.sent > 0 ? `${Math.round((stats.blocked / stats.sent) * 100)}%` : '0%' },
  ] : [];

  const chartData = stats?.daily.map(d => ({
    ...d,
    label: format(new Date(d.date), "dd/MM"),
  })) || [];

  const getStatusBadge = (status: string) => {
    const s = status as EmailSendStatus;
    const style = EMAIL_SEND_STATUS_STYLES[s] || EMAIL_SEND_STATUS_STYLES.sent;
    const label = EMAIL_SEND_STATUS_LABELS[s] ? t(EMAIL_SEND_STATUS_LABELS[s]) : status;
    return (
      <Badge variant="outline" style={{ backgroundColor: style.bg, color: style.text, borderColor: 'transparent' }}>
        {label}
      </Badge>
    );
  };

  return (
    <div className="space-y-6 p-4 md:p-6 pb-nav-safe md:pb-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link to="/marketing">
              <Button variant="back" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <BarChart3 className="h-5 w-5 shrink-0 text-primary" />
                {t("Relatórios")}
              </h1>
              <p className="text-muted-foreground text-sm">{t("Métricas de envio de emails")}</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={source} onValueChange={(v) => handleSourceChange(v as SourceFilter)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder={t("Fonte")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Todos")}</SelectItem>
              <SelectItem value="campaign">{t("Campanhas")}</SelectItem>
              <SelectItem value="automation">{t("Automações")}</SelectItem>
            </SelectContent>
          </Select>

          {source === 'campaign' && (
            <Select value={sourceId || 'all'} onValueChange={(v) => setSourceId(v === 'all' ? null : v)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder={t("Todas as campanhas")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Todas as campanhas")}</SelectItem>
                {campaigns?.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {source === 'automation' && (
            <Select value={sourceId || 'all'} onValueChange={(v) => setSourceId(v === 'all' ? null : v)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder={t("Todas as automações")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Todas as automações")}</SelectItem>
                {templates?.filter((t: any) => t.automation_enabled).map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList>
              <TabsTrigger value="7d">{t("7 dias")}</TabsTrigger>
              <TabsTrigger value="30d">{t("30 dias")}</TabsTrigger>
              <TabsTrigger value="90d">{t("90 dias")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="icon" onClick={handleRefresh} className="h-9 w-9" aria-label={t("Atualizar")}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : stats ? (
          <>
            {/* Webhook Warning */}
            {stats.sent > 0 && stats.delivered === 0 && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-600 dark:text-amber-400">{t("Tracking de entregas não configurado")}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("Existem {{n}} emails enviados mas 0 entregas registadas. Configure o webhook do Brevo em", { n: stats.sent })}{' '}
                    <Link to="/settings" className="underline text-primary">{t("Definições → Integrações → Brevo")}</Link>{' '}
                    {t("para ativar o tracking de entregas, aberturas e cliques.")}
                  </p>
                </div>
              </div>
            )}

            {/* Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7 gap-4">
              {metrics.map(m => (
                <Card key={m.label}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <m.icon className={`h-4 w-4 ${m.color}`} />
                      <span className="text-sm text-muted-foreground">{t(m.label)}</span>
                    </div>
                    <p className="text-xl md:text-2xl font-bold">{m.value}</p>
                    <p className="text-xs text-muted-foreground mt-1">{m.sub}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Charts */}
            {chartData.length > 0 && (
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">{t("Envios e Entregas")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[180px] sm:h-[250px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="label" className="text-xs" tick={{ fontSize: 11 }} />
                          <YAxis className="text-xs" tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Area type="monotone" dataKey="sent" stackId="1" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" name={t("Enviados")} />
                          <Area type="monotone" dataKey="delivered" stackId="2" stroke="hsl(142 76% 45%)" fill="hsl(142 76% 45% / 0.2)" name={t("Entregues")} />
                          <Area type="monotone" dataKey="failed" stackId="3" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive) / 0.2)" name={t("Erros")} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">{t("Aberturas e Cliques")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[180px] sm:h-[250px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="label" className="text-xs" tick={{ fontSize: 11 }} />
                          <YAxis className="text-xs" tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Bar dataKey="opened" fill="hsl(210 80% 55%)" name={t("Abertos")} radius={[4, 4, 0, 0]} />
                          <Bar dataKey="clicked" fill="hsl(270 70% 55%)" name={t("Clicados")} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Events Table */}
            {stats.events && stats.events.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">{t("Eventos Detalhados")}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-auto max-h-[400px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("Destinatário")}</TableHead>
                          <TableHead className="hidden md:table-cell">{t("Email")}</TableHead>
                          <TableHead>{t("Origem")}</TableHead>
                          <TableHead>{t("Estado")}</TableHead>
                          <TableHead className="hidden md:table-cell">{t("Enviado")}</TableHead>
                          <TableHead className="hidden lg:table-cell">{t("Aberto")}</TableHead>
                          <TableHead className="hidden lg:table-cell">{t("Clicado")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stats.events.slice(0, 100).map((event: any) => (
                          <TableRow key={event.id}>
                            <TableCell className="font-medium truncate max-w-[150px]">
                              {event.recipient_name || '—'}
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-muted-foreground truncate max-w-[200px]">
                              {event.recipient_email}
                            </TableCell>
                            <TableCell>{getOriginLabel(event)}</TableCell>
                            <TableCell>{getStatusBadge(event.status)}</TableCell>
                            <TableCell className="hidden md:table-cell text-muted-foreground text-xs">
                              {event.sent_at ? format(new Date(event.sent_at), "dd/MM HH:mm") : '—'}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">
                              {event.opened_at ? format(new Date(event.opened_at), "dd/MM HH:mm") : '—'}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">
                              {event.clicked_at ? format(new Date(event.clicked_at), "dd/MM HH:mm") : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {chartData.length === 0 && (!stats.events || stats.events.length === 0) && (
              <div className="text-center py-12 text-muted-foreground">
                <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{t("Sem dados de envio neste período")}</p>
              </div>
            )}
          </>
        ) : null}
    </div>
  );
}
