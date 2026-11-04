import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/hooks/useModules";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Phone, 
  Mail, 
  Building2, 
  Calendar, 
  MessageCircle, 
  Pencil,
  FileText,
  Euro,
  ShoppingBag,
  ExternalLink
} from "lucide-react";
import { CrmClient, CLIENT_STATUS_LABELS, CLIENT_STATUS_STYLES, CLIENT_SOURCE_LABELS } from "@/types/clients";
import { formatDate, formatDateTime, getInboxUrl, formatCurrency } from "@/lib/format";
import { formatOperationalUnits } from "@/lib/sale-units";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { LeadAttachments } from "@/components/leads/LeadAttachments";
import { useLanguage } from "@/i18n";

interface ClientDetailsModalProps {
  client: CrmClient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (client: CrmClient) => void;
}

export function ClientDetailsModal({ client, open, onOpenChange, onEdit }: ClientDetailsModalProps) {
  const { t } = useLanguage();
  const { organization } = useAuth();
  const isTelecom = organization?.niche === 'telecom';
  const { modules } = useModules();
  const showEnergy = isTelecom && modules.energy;
  
  if (!client) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
              {client.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-xl">{client.name}</DialogTitle>
                {client.code && (
                  <span className="text-sm font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
                    #{client.code}
                  </span>
                )}
              </div>
              <DialogDescription className="mt-1">
                {t("Cliente desde")} {formatDate(client.created_at)}
              </DialogDescription>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "border",
                CLIENT_STATUS_STYLES[client.status].bg,
                CLIENT_STATUS_STYLES[client.status].text,
                CLIENT_STATUS_STYLES[client.status].border
              )}
            >
              {t(CLIENT_STATUS_LABELS[client.status])}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Contact Info */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">{t("Informações de Contacto")}</h4>
            
            {client.phone && (
              <div className="flex items-center gap-3 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{client.phone}</span>
                <Link to={getInboxUrl(client.phone)} className="ml-auto">
                  <Button variant="ghost" size="sm" className="h-7 px-2">
                    <MessageCircle className="h-4 w-4 text-green-500" />
                  </Button>
                </Link>
              </div>
            )}
            
            {client.email && (
              <div className="flex items-center gap-3 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <a href={`mailto:${client.email}`} className="text-primary hover:underline">
                  {client.email}
                </a>
              </div>
            )}

            <div className="flex items-center gap-3 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>{t("Criado:")} {formatDateTime(client.created_at)}</span>
            </div>
          </div>

          {/* Company Info */}
          {(client.company || client.nif) && (
            <>
              <Separator />
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-foreground">{t("Dados da Empresa")}</h4>
                
                {client.company && (
                  <div className="flex items-center gap-3 text-sm">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span>{client.company}</span>
                  </div>
                )}
                
                {client.nif && (
                  <div className="flex items-center gap-3 text-sm">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span>{t("NIF:")} {client.nif}</span>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Metrics */}
          <Separator />
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">{t("Métricas")}</h4>
            
            <div className="grid grid-cols-1 xs:grid-cols-3 gap-4">
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                  <FileText className="h-3 w-3" />
                </div>
                <p className="text-lg font-semibold">{client.total_proposals}</p>
                <p className="text-xs text-muted-foreground">{t("Propostas")}</p>
              </div>
              
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                  <ShoppingBag className="h-3 w-3" />
                </div>
                <p className="text-lg font-semibold">{formatOperationalUnits(client.total_sales)}</p>
                <p className="text-xs text-muted-foreground">{t("Vendas")}</p>
              </div>
              
              {showEnergy ? (
                <>
                  <div className="rounded-lg bg-muted/50 p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                      <Euro className="h-3 w-3" />
                    </div>
                    <p className="text-lg font-semibold">{formatCurrency(client.total_comissao || 0)}</p>
                    <p className="text-xs text-muted-foreground">{t("Comissão")}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3 text-center">
                    <p className="text-lg font-semibold">{(client.total_mwh || 0).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">{t("MWh")}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3 text-center">
                    <p className="text-lg font-semibold">{(client.total_kwp || 0).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">{t("kWp")}</p>
                  </div>
                </>
              ) : (
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                    <Euro className="h-3 w-3" />
                  </div>
                  <p className="text-lg font-semibold">{formatCurrency(client.total_value)}</p>
                  <p className="text-xs text-muted-foreground">{t("Valor Total")}</p>
                </div>
              )}
            </div>
          </div>

          {/* Source */}
          {client.source && (
            <>
              <Separator />
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  {t("Origem")}
                </h4>
                <div className="px-3 py-2 bg-muted rounded-md text-sm">
                  {CLIENT_SOURCE_LABELS[client.source] ? t(CLIENT_SOURCE_LABELS[client.source]) : client.source}
                </div>
              </div>
            </>
          )}

          {/* Notes */}
          {client.notes && (
            <>
              <Separator />
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-foreground">{t("Notas")}</h4>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {client.notes}
                </p>
              </div>
            </>
          )}
          {/* Faturas Anexadas - Telecom only, via lead_id */}
          {isTelecom && client.lead_id && (
            <>
              <Separator />
              <LeadAttachments leadId={client.lead_id} readOnly />
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Fechar")}
          </Button>
          <Button onClick={() => { onOpenChange(false); onEdit(client); }}>
            <Pencil className="h-4 w-4 mr-2" />
            {t("Editar")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
