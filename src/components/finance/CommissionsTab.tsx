import { useState } from 'react';
import { format, subMonths, startOfMonth } from 'date-fns';
import { useLanguage, dateLocale, intlLocale } from '@/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronRight, Zap, FileX, Search, Sun } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { useLiveCommissions } from '@/hooks/useLiveCommissions';
import { matchesSearch } from '@/lib/utils';
import { useTeamFilter } from '@/hooks/useTeamFilter';
import { TeamMemberFilter } from '@/components/dashboard/TeamMemberFilter';

const NEGOTIATION_TYPE_LABELS: Record<string, string> = {
  angariacao: 'Angariação',
  angariacao_indexado: 'Ang. Indexado',
  renovacao: 'Renovação',
  sem_volume: 'Ang. sem Volume',
};

const TIER_LABELS: Record<string, string> = {
  low: 'Baixo (≤300 MWh)',
  mid: 'Médio (301–600 MWh)',
  high: 'Alto (+601 MWh)',
};

function generateMonthOptions() {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = startOfMonth(subMonths(now, i));
    options.push({
      value: format(d, 'yyyy-MM-dd'),
      label: format(d, 'MMMM yyyy', { locale: dateLocale() }),
    });
  }
  return options;
}

export function CommissionsTab() {
  const { t } = useLanguage();
  const { effectiveUserIds, canFilterByTeam } = useTeamFilter();
  const monthOptions = generateMonthOptions();
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]?.value);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const { data, isLoading } = useLiveCommissions(selectedMonth, effectiveUserIds);

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const commercials = data?.commercials || [];
  const globalMwh = data?.globalMwh || 0;
  const globalTier = data?.globalTier || 'low';
  const totalCommission = data?.totalCommission || 0;
  const globalServicosKwp = data?.globalServicosKwp || 0;
  const globalEnergyCommission = data?.globalEnergyCommission || 0;
  const globalServicosCommission = data?.globalServicosCommission || 0;

  const filteredCommercials = commercials.filter(item =>
    matchesSearch(searchTerm, item.name)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canFilterByTeam && (
          <>
            <TeamMemberFilter />
            <div className="relative flex-1 sm:max-w-[300px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("Pesquisar comercial...")}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
          </>
        )}
      </div>

      {filteredCommercials.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileX className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-1">{t("Sem dados de comissão")}</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {t("Nenhuma venda concluída com data de ativação neste mês (Angariação / Angariação Indexado).")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Global Totalizer */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Zap className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("Totalizador EE (Angariação)")}</p>
                  <p className="text-2xl font-bold">{globalMwh.toFixed(1)} MWh</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-sm font-semibold">
                  {t(TIER_LABELS[globalTier] || globalTier)}
                </Badge>
                <Badge variant="outline" className="text-base font-semibold">
                  {formatCurrency(globalEnergyCommission)}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Services Totalizer */}
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Sun className="h-5 w-5 text-amber-500" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("Totalizador Serviços")}</p>
                  <p className="text-2xl font-bold">{globalServicosKwp.toFixed(1)} kWp</p>
                </div>
              </div>
              <Badge variant="outline" className="text-base font-semibold w-fit">
                {formatCurrency(globalServicosCommission)}
              </Badge>
            </CardContent>
          </Card>

          {/* Total geral */}
          <Card className="border-muted-foreground/20">
            <CardContent className="flex items-center justify-between p-4">
              <p className="text-sm font-medium text-muted-foreground">{t("Total Comissões")}</p>
              <p className="text-2xl font-bold">{formatCurrency(totalCommission)}</p>
            </CardContent>
          </Card>

          {/* Detail by commercial */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>{t("Comercial")}</TableHead>
                    <TableHead className="text-right">{t("MWh Total")}</TableHead>
                    <TableHead>{t("Patamar")}</TableHead>
                    <TableHead className="text-right">{t("Comissão")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCommercials.map(item => (
                    <>
                      <TableRow
                        key={item.userId}
                        className="cursor-pointer"
                        onClick={() => toggleExpand(item.userId)}
                      >
                        <TableCell>
                          {expandedItems.has(item.userId) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="text-right">{item.totalConsumoMwh.toFixed(1)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{t(TIER_LABELS[item.tier] || item.tier)}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(item.totalFinal)}</TableCell>
                      </TableRow>
                      {expandedItems.has(item.userId) && (
                        <TableRow key={`${item.userId}-detail`}>
                          <TableCell colSpan={6} className="bg-muted/30 p-0">
                            <div className="p-4">
                              <Table>
                                <TableHeader>
                                <TableRow>
                                    <TableHead>{t("Venda")}</TableHead>
                                     <TableHead>{t("Tipo")}</TableHead>
                                     <TableHead>CPE/CUI</TableHead>
                                    <TableHead className="text-right">{t("EE (kWh)")}</TableHead>
                                    <TableHead className="text-right">{t("Serviços (kWp)")}</TableHead>
                                     <TableHead className="text-right">{t("Comissão Final")}</TableHead>
                                     <TableHead>{t("Serviços")}</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {item.cpes.map((d, idx) => (
                                    <TableRow key={idx}>
                                      <TableCell className="text-xs font-medium">{d.sale_code || '—'}</TableCell>
                                      <TableCell>
                                        <Badge variant="outline" className="text-[10px] whitespace-nowrap">
                                          {d.negotiation_type ? t(NEGOTIATION_TYPE_LABELS[d.negotiation_type] || d.negotiation_type) : '—'}
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-xs">{d.serial_number || d.proposal_cpe_id?.slice(0, 8)}</TableCell>
                                      <TableCell className="text-right text-xs">{d.consumo_anual ? d.consumo_anual.toLocaleString(intlLocale()) : '—'}</TableCell>
                                      <TableCell className="text-right text-xs">{d.servicos_kwp > 0 ? d.servicos_kwp.toFixed(1) : '—'}</TableCell>
                                      <TableCell className="text-right text-xs font-medium">{d.comissao_final != null ? formatCurrency(d.comissao_final) : '—'}</TableCell>
                                      <TableCell className="text-xs">
                                        <div className="flex flex-wrap gap-1">
                                          {d.proposal_type === 'energia' && (
                                            <Badge variant="default" className="text-[10px]">
                                              {t("Energia")}{d.negotiation_type ? ` - ${t(NEGOTIATION_TYPE_LABELS[d.negotiation_type] || d.negotiation_type)}` : ''}
                                            </Badge>
                                          )}
                                          {d.servicos?.map((s, i) => (
                                            <Badge key={i} variant="secondary" className="text-[10px]">{s}</Badge>
                                          ))}
                                          {!d.servicos?.length && d.proposal_type !== 'energia' && '—'}
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
