import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FileCheck2, LockKeyhole, Mail, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { usePermissions } from '@/hooks/usePermissions';

interface FiscalAutomationSummary {
  automaticDocuments: number;
  automaticEmails: number;
}

export function SystemFiscalAutomationCard() {
  const { organization } = useAuth();
  const { can, canManageIntegrations } = usePermissions();
  const canConfigureFiscal = can('finance', 'invoices', 'issue');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { data: summary = { automaticDocuments: 0, automaticEmails: 0 } } = useQuery({
    queryKey: ['system-fiscal-automation', organization?.id],
    queryFn: async (): Promise<FiscalAutomationSummary> => {
      if (!organization?.id) return { automaticDocuments: 0, automaticEmails: 0 };

      const fetchRows = async (fields: string) => {
        const result = await supabase
          .from('sale_recurrences')
          .select(fields)
          .eq('organization_id', organization.id);
        return {
          data: result.data as unknown as Array<Record<string, unknown>> | null,
          error: result.error as { code?: string; message?: string } | null,
        };
      };

      let result = await fetchRows('id, fiscal_mode, fiscal_auto_email');
      if (result.error && (
        ['42703', 'PGRST200', 'PGRST204'].includes(result.error.code ?? '')
        || /fiscal_(mode|auto_email)/i.test(result.error.message ?? '')
      )) {
        result = await fetchRows('id');
      }
      if (result.error) throw result.error;

      const rows = result.data ?? [];
      return {
        automaticDocuments: rows.filter((row) => row.fiscal_mode === 'automatic').length,
        automaticEmails: rows.filter(
          (row) => row.fiscal_mode === 'automatic' && row.fiscal_auto_email === true,
        ).length,
      };
    },
    enabled: !!organization?.id,
  });

  const active = summary.automaticEmails > 0;

  return (
    <>
      <section className="space-y-2" aria-labelledby="system-automations-title">
        <div className="flex items-center gap-2">
          <h2 id="system-automations-title" className="text-sm font-medium text-muted-foreground">
            Automações do sistema
          </h2>
          <Badge variant="outline" className="gap-1 text-[10px]">
            <LockKeyhole className="h-3 w-3" />
            Protegida
          </Badge>
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/[0.06] via-card to-card p-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 ring-2 ring-primary/15">
              <FileCheck2 className="h-5 w-5 text-primary" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">Documento fiscal emitido → Enviar PDF ao cliente</h3>
                <Badge
                  variant="outline"
                  className={active
                    ? 'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400'
                    : 'border-border bg-muted/50 text-muted-foreground'}
                >
                  {active ? 'Ativa' : 'Por ativar'}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {active
                  ? `Envio automático ativo em ${summary.automaticEmails} ${summary.automaticEmails === 1 ? 'venda recorrente' : 'vendas recorrentes'}.`
                  : 'Ative o envio numa venda recorrente para usar este fluxo protegido.'}
                {summary.automaticDocuments > 0 && ` · ${summary.automaticDocuments} com emissão automática.`}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-2"
            onClick={() => setDetailsOpen(true)}
            disabled={!canConfigureFiscal}
            title={!canConfigureFiscal ? 'Requer permissão para emitir faturas' : undefined}
          >
            <Settings2 className="h-4 w-4" />
            Configurar
          </Button>
        </div>
      </section>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Envio automático de documentos fiscais</DialogTitle>
            <DialogDescription>
              Este fluxo pertence ao sistema e não pode ser eliminado nem alterado no editor visual.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-2 overflow-x-auto rounded-lg border bg-muted/20 p-3 text-xs">
              <FileCheck2 className="h-4 w-4 shrink-0 text-primary" />
              <span className="whitespace-nowrap font-medium">Fornecedor confirma a emissão</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Mail className="h-4 w-4 shrink-0 text-primary" />
              <span className="whitespace-nowrap font-medium">PDF enviado ao destinatário</span>
            </div>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                A ativação é feita por venda, porque cada contrato pode usar uma política fiscal e um destinatário diferentes.
              </p>
              <p>
                Abra uma venda recorrente e, em <strong className="text-foreground">Faturação fiscal recorrente</strong>, ative “Enviar PDF automaticamente”.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {canManageIntegrations && (
              <Button variant="outline" asChild>
                <Link to="/settings?og=integrations&os=integrations-connect" onClick={() => setDetailsOpen(false)}>
                  Configurar fornecedor
                </Link>
              </Button>
            )}
            <Button asChild>
              <Link to="/sales" onClick={() => setDetailsOpen(false)}>
                Abrir vendas
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
