import { useState } from "react";
import { Lead } from "@/types";
import { useEmailTemplates } from "@/hooks/useEmailTemplates";
import { useSendTemplateEmail } from "@/hooks/useSendTemplateEmail";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, Send, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isPlaceholderEmail } from "@/lib/leadUtils";
import { EMAIL_TEMPLATE_TRIGGERS } from "@/lib/email-template-triggers";

interface SendLeadEmailModalProps {
  lead: Lead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SendLeadEmailModal({ lead, open, onOpenChange }: SendLeadEmailModalProps) {
  const { data: templates, isLoading } = useEmailTemplates();
  const sendEmail = useSendTemplateEmail();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const leadTemplates = templates?.filter(t =>
    t.is_active && t.automation_trigger_type === EMAIL_TEMPLATE_TRIGGERS.lead
  ) || [];
  const welcomeTemplates = leadTemplates.filter(t => t.category === 'welcome');
  const otherTemplates = leadTemplates.filter(t => t.category !== 'welcome');
  const selected = templates?.find(t => t.id === selectedId);

  const handleSend = () => {
    if (!selected || !lead.email) return;

    sendEmail.mutate({
      templateId: selected.id,
      requiredTriggerType: EMAIL_TEMPLATE_TRIGGERS.lead,
      recipients: [{
        email: lead.email,
        name: lead.name,
        variables: {
          nome: lead.name || '',
          email: lead.email || '',
          telefone: lead.phone || '',
          empresa: lead.company_name || '',
        },
      }],
    }, {
      onSuccess: () => {
        setSelectedId(null);
        onOpenChange(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Enviar Email para {lead.name}
          </DialogTitle>
        </DialogHeader>

        {!lead.email || isPlaceholderEmail(lead.email) ? (
          <p className="text-sm text-muted-foreground py-4">
            Este lead não tem email registado.
          </p>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (welcomeTemplates.length === 0 && otherTemplates.length === 0) ? (
          <p className="text-sm text-muted-foreground py-4">
            Configure um template de email com o gatilho «Envio Manual: Lead» em Marketing → Templates.
          </p>
        ) : (
          <div className="space-y-4">
            <ScrollArea className="max-h-[50dvh]">
              <div className="space-y-3 pr-3">
                {welcomeTemplates.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Star className="h-3.5 w-3.5 text-warning" />
                      Boas-vindas
                    </p>
                    {welcomeTemplates.map(t => (
                      <TemplateItem
                        key={t.id}
                        name={t.name}
                        subject={t.subject}
                        selected={selectedId === t.id}
                        onClick={() => setSelectedId(t.id)}
                        highlight
                      />
                    ))}
                  </div>
                )}

                {otherTemplates.length > 0 && (
                  <div className="space-y-2">
                    {welcomeTemplates.length > 0 && (
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-2">
                        Outros templates
                      </p>
                    )}
                    {otherTemplates.map(t => (
                      <TemplateItem
                        key={t.id}
                        name={t.name}
                        subject={t.subject}
                        selected={selectedId === t.id}
                        onClick={() => setSelectedId(t.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>

            {selected && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Assunto</p>
                <p className="text-sm font-medium">{selected.subject}</p>
                <p className="text-xs text-muted-foreground mt-2">Destinatário</p>
                <p className="text-sm">{lead.email}</p>
              </div>
            )}

            <Button
              className="w-full"
              disabled={!selectedId || sendEmail.isPending}
              onClick={handleSend}
            >
              {sendEmail.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Enviar Email
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TemplateItem({ name, subject, selected, onClick, highlight }: {
  name: string;
  subject: string;
  selected: boolean;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-lg border p-3 transition-all",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border hover:border-primary/40 hover:bg-accent/50",
        highlight && !selected && "border-warning/30 bg-warning/5"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium truncate">{name}</p>
        {highlight && <Badge variant="secondary" className="text-[10px] shrink-0">Boas-vindas</Badge>}
      </div>
      <p className="text-xs text-muted-foreground truncate mt-0.5">{subject}</p>
    </button>
  );
}
