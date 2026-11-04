import { useState, useMemo } from "react";
import { Mail, Eye, MousePointer, MoreHorizontal, Trash2, BarChart3, Search, Pencil, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { EmailCampaign, CampaignStatus } from "@/types/marketing";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_STYLES } from "@/types/marketing";
import { format } from "date-fns";
import { normalizeString } from "@/lib/utils";
import { useLanguage } from "@/i18n";

interface CampaignsTableProps {
  campaigns: EmailCampaign[];
  onView: (campaign: EmailCampaign) => void;
  onEdit: (campaign: EmailCampaign) => void;
  onDelete: (id: string) => void;
  onReopen?: (id: string) => void;
}

const STATUS_DOT_COLORS: Record<CampaignStatus, string> = {
  draft: 'bg-muted-foreground',
  sending: 'bg-yellow-500',
  sent: 'bg-green-500',
  failed: 'bg-destructive',
  scheduled: 'bg-blue-500',
};

export function CampaignsTable({ campaigns, onView, onEdit, onDelete, onReopen }: CampaignsTableProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { t } = useLanguage();

  const filtered = useMemo(() => {
    return campaigns.filter(c => {
      const matchesSearch = !search || normalizeString(c.name).includes(normalizeString(search));
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [campaigns, search, statusFilter]);

  if (campaigns.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p className="text-lg font-medium">{t("Sem campanhas")}</p>
        <p className="text-sm">{t("Crie a sua primeira campanha de email")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("Procurar uma campanha...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder={t("Todos os estados")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Todos os estados")}</SelectItem>
            <SelectItem value="draft">{t("Rascunho")}</SelectItem>
            <SelectItem value="sending">{t("A enviar")}</SelectItem>
            <SelectItem value="sent">{t("Enviada")}</SelectItem>
            <SelectItem value="failed">{t("Falhada")}</SelectItem>
            <SelectItem value="scheduled">{t("Agendada")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Campaign cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          {t("Nenhuma campanha encontrada")}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((campaign, index) => {
            const style = CAMPAIGN_STATUS_STYLES[campaign.status];
            const dotColor = STATUS_DOT_COLORS[campaign.status];

            return (
              <div
                key={campaign.id}
                className="border rounded-lg bg-card hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => onView(campaign)}
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                  {/* Left: info */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground font-mono">#{campaigns.length - index}</span>
                      <h3 className="font-semibold text-sm truncate">{campaign.name}</h3>
                      <Badge
                        className="text-xs shrink-0 gap-1.5 font-normal"
                        style={{ backgroundColor: style.bg, color: style.text }}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                        {t(CAMPAIGN_STATUS_LABELS[campaign.status])}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {campaign.status === 'scheduled' && campaign.scheduled_at
                        ? t("Agendada para {{date}} às {{time}}", { date: format(new Date(campaign.scheduled_at), "dd/MM/yyyy"), time: format(new Date(campaign.scheduled_at), "HH:mm") })
                        : campaign.sent_at
                          ? t("Enviada a {{date}} às {{time}}", { date: format(new Date(campaign.sent_at), "dd/MM/yyyy"), time: format(new Date(campaign.sent_at), "HH:mm") })
                          : t("Editada a {{date}} às {{time}}", { date: format(new Date(campaign.updated_at), "dd/MM/yyyy"), time: format(new Date(campaign.updated_at), "HH:mm") })
                      }
                    </p>
                  </div>

                  {/* Right: metrics */}
                  <div className="flex items-center gap-4 sm:gap-6">
                    <MetricCol icon={<Mail className="h-3.5 w-3.5" />} label={t("Destinatários")} value={campaign.total_recipients} />
                    <MetricCol icon={<Eye className="h-3.5 w-3.5" />} label={t("Enviados")} value={campaign.sent_count} />
                    <MetricCol icon={<MousePointer className="h-3.5 w-3.5" />} label={t("Falhados")} value={campaign.failed_count} />

                    {/* Action button */}
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => campaign.status === 'draft' ? onEdit(campaign) : onView(campaign)}
                      >
                        {campaign.status === 'draft' ? (
                          <Pencil className="h-4 w-4" />
                        ) : (
                          <BarChart3 className="h-4 w-4" />
                        )}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {campaign.status === 'draft' && (
                            <DropdownMenuItem onClick={() => onEdit(campaign)}>
                              <Pencil className="mr-2 h-4 w-4" /> {t("Editar")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => onView(campaign)}>
                            <BarChart3 className="mr-2 h-4 w-4" /> {t("Ver detalhes")}
                          </DropdownMenuItem>
                          {(campaign.status === 'failed' || campaign.status === 'scheduled') && onReopen && (
                            <DropdownMenuItem onClick={() => onReopen(campaign.id)}>
                              <RotateCcw className="mr-2 h-4 w-4" /> {t("Reabrir como rascunho")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem className="text-destructive" onClick={() => onDelete(campaign.id)}>
                            <Trash2 className="mr-2 h-4 w-4" /> {t("Eliminar")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetricCol({ icon, label, value, pct }: { icon: React.ReactNode; label: string; value: number; pct?: number }) {
  return (
    <div className="text-center min-w-[60px] hidden sm:block">
      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">
        {icon}
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-sm font-bold">
        {value}
        {pct !== undefined && <span className="text-xs font-normal text-muted-foreground ml-1">({pct}%)</span>}
      </p>
    </div>
  );
}
