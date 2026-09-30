import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, FileCheck2, Loader2, LockKeyhole } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { usePermissions } from '@/hooks/usePermissions';
import { configureSaleRecurrenceFiscal } from '@/hooks/useSaleRecurrence';
import {
  normalizeRecurringFiscalEmailConfig,
  type RecurringFiscalDocumentPolicy,
  type RecurringFiscalMode,
} from '@/types/recurring-fiscal';

/**
 * The email template the fiscal worker sends for each document type. The
 * worker reads these org-level templates (Marketing → Templates), not the
 * subject/body stored on each sale — so they are what "configured" means.
 */
const TEMPLATES_BY_POLICY: Record<RecurringFiscalDocumentPolicy, Array<{ trigger: string; label: string }>> = {
  invoice_then_receipt: [
    { trigger: 'invoice_email', label: 'Fatura' },
    { trigger: 'receipt_email', label: 'Recibo' },
  ],
  invoice_receipt_when_paid: [
    { trigger: 'invoice_receipt_email', label: 'Fatura-recibo' },
  ],
};
const FISCAL_TEMPLATE_TRIGGERS = ['invoice_email', 'invoice_receipt_email', 'receipt_email'];

const SETTINGS_INTEGRATIONS = '/settings?og=integrations&os=integrations-connect';
const TEMPLATES_PAGE = '/marketing/templates';

interface RecurrenceRow {
  id: string;
  fiscal_mode: RecurringFiscalMode | null;
  fiscal_document_policy: RecurringFiscalDocumentPolicy | null;
  fiscal_auto_email: boolean | null;
  fiscal_email_config: unknown;
  service_status: string | null;
  sale: { code: string | null; client: { email: string | null } | null } | null;
}

// A widened string keeps the typed client from parsing the embed against
// generated types that predate these columns.
const RECURRENCE_FIELDS: string =
  'id, fiscal_mode, fiscal_document_policy, fiscal_auto_email, fiscal_email_config, service_status, sale:sales(code, client:crm_clients(email))';

/**
 * The protected "fiscal document issued → email the PDF" flow, as a single
 * switch. It used to be a button opening a dialog that explained the setting
 * lived on each sale and sent you there; now the switch applies it to every
 * recurring sale that issues its invoice automatically, and is only enabled
 * once invoicing, Brevo and the email templates are in place.
 *
 * Issuance itself stays per sale on purpose: turning it on creates real
 * invoices at the tax authority every month, which one shared switch should
 * never do. The worker only emails documents it issued, so sales that issue by
 * hand are left out and counted.
 */
export function SystemFiscalAutomationCard() {
  const { organization } = useAuth();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const canConfigureFiscal = can('finance', 'invoices', 'issue');
  const orgId = organization?.id;
  const [pending, setPending] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['system-fiscal-automation', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [recurrences, templates] = await Promise.all([
        supabase.from('sale_recurrences').select(RECURRENCE_FIELDS).eq('organization_id', orgId as string),
        supabase.from('email_templates')
          .select('automation_trigger_type')
          .eq('organization_id', orgId as string)
          .eq('is_active', true)
          .in('automation_trigger_type', FISCAL_TEMPLATE_TRIGGERS),
      ]);
      if (recurrences.error) throw recurrences.error;
      if (templates.error) throw templates.error;
      return {
        recurrences: (recurrences.data ?? []) as unknown as RecurrenceRow[],
        templates: new Set(
          (templates.data ?? []).map((row) => (row as { automation_trigger_type: string | null }).automation_trigger_type ?? ''),
        ),
      };
    },
  });

  const view = useMemo(() => {
    const recurrences = data?.recurrences ?? [];
    const templates = data?.templates ?? new Set<string>();
    const running = recurrences.filter((r) => r.service_status === 'active');
    const eligible = running.filter((r) => r.fiscal_mode === 'automatic');
    const handIssued = running.length - eligible.length;
    const on = eligible.filter((r) => r.fiscal_auto_email === true).length;

    const keyInvoiceReady = organization?.billing_provider === 'keyinvoice'
      && (organization?.integrations_enabled as Record<string, boolean> | null)?.keyinvoice === true
      && organization?.tem_keyinvoice_password === true;
    const brevoReady = organization?.tem_brevo_api_key === true && !!organization?.brevo_sender_email?.trim();

    // Only the templates the sales' own document policies will actually use.
    const needed = new Map<string, string>();
    for (const r of eligible) {
      for (const t of TEMPLATES_BY_POLICY[r.fiscal_document_policy ?? 'invoice_then_receipt'] ?? []) {
        needed.set(t.trigger, t.label);
      }
    }

    const missing: Array<{ label: string; to: string }> = [];
    if (!keyInvoiceReady) missing.push({ label: 'Faturação KeyInvoice', to: SETTINGS_INTEGRATIONS });
    if (!brevoReady) missing.push({ label: 'Brevo e remetente', to: SETTINGS_INTEGRATIONS });
    for (const [trigger, label] of needed) {
      if (!templates.has(trigger)) missing.push({ label: `Modelo de email: ${label}`, to: TEMPLATES_PAGE });
    }

    return { eligible, handIssued, on, missing, ready: missing.length === 0 };
  }, [data, organization]);

  const allOn = view.eligible.length > 0 && view.on === view.eligible.length;
  const canToggle = view.ready && view.eligible.length > 0 && canConfigureFiscal && !pending && !isLoading;

  const handleToggle = async (next: boolean) => {
    const targets = view.eligible.filter((r) => (r.fiscal_auto_email === true) !== next);
    if (!targets.length) return;
    setPending(true);
    const skipped: string[] = [];
    let changed = 0;

    // One sale at a time through the same function the sale panel uses, so
    // every server-side rule (KeyInvoice series, permissions, MFA) applies
    // exactly as it does when the switch is flipped on the sale itself.
    for (const r of targets) {
      const label = r.sale?.code ? `Venda ${r.sale.code}` : 'Uma venda';
      const email = normalizeRecurringFiscalEmailConfig(r.fiscal_email_config);
      if (next && email.recipient_mode === 'client' && !r.sale?.client?.email?.trim() && !email.fallback_email.trim()) {
        skipped.push(`${label}: o cliente não tem email`);
        continue;
      }
      try {
        await configureSaleRecurrenceFiscal(r.id, {
          fiscal_mode: 'automatic',
          fiscal_document_policy: r.fiscal_document_policy ?? 'invoice_then_receipt',
          fiscal_auto_email: next,
          fiscal_email_config: email,
        });
        changed++;
      } catch (error) {
        skipped.push(`${label}: ${(error as Error).message}`);
      }
    }

    setPending(false);
    await queryClient.invalidateQueries({ queryKey: ['system-fiscal-automation'] });
    queryClient.invalidateQueries({ queryKey: ['sale-recurrence'] });

    const noun = (n: number) => (n === 1 ? 'venda' : 'vendas');
    if (changed) {
      toast.success(next
        ? `Envio automático ligado em ${changed} ${noun(changed)}.`
        : `Envio automático desligado em ${changed} ${noun(changed)}.`);
    }
    if (skipped.length) {
      toast.warning(`${skipped.length} ${noun(skipped.length)} ficaram de fora`, { description: skipped.join(' · ') });
    }
  };

  const status = (() => {
    if (isLoading) return 'A verificar a configuração…';
    if (!view.ready) return 'Falta configurar o que está abaixo para poder ligar.';
    if (!view.eligible.length) {
      return 'Nenhuma venda recorrente emite a fatura sozinha. Ligue a emissão automática numa venda para usar o envio.';
    }
    if (allOn) return `Ligado em ${view.eligible.length} ${view.eligible.length === 1 ? 'venda' : 'vendas'} com emissão automática.`;
    if (view.on > 0) return `Ligado em ${view.on} de ${view.eligible.length} vendas com emissão automática. Ligue para cobrir as restantes.`;
    return `Pronto a ligar em ${view.eligible.length} ${view.eligible.length === 1 ? 'venda' : 'vendas'} com emissão automática.`;
  })();

  return (
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

      <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/[0.06] via-card to-card p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 ring-2 ring-primary/15">
            <FileCheck2 className="h-5 w-5 text-primary" />
          </span>

          <div className="min-w-0 flex-1">
            <label htmlFor="fiscal-auto-email" className="block text-sm font-semibold">
              Documento fiscal emitido → Enviar PDF ao cliente
            </label>
            <p className="mt-1 text-xs text-muted-foreground">{status}</p>
            {view.ready && view.handIssued > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {view.handIssued} {view.handIssued === 1 ? 'venda emite' : 'vendas emitem'} a fatura à mão e{' '}
                {view.handIssued === 1 ? 'fica' : 'ficam'} de fora.{' '}
                <Link to="/sales" className="text-primary underline-offset-4 hover:underline">Ver vendas</Link>
              </p>
            )}

            {!isLoading && view.missing.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {view.missing.map((item) => (
                  <li key={item.label}>
                    <Link
                      to={item.to}
                      className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
                    >
                      <AlertCircle className="h-3 w-3" />
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {!canConfigureFiscal && (
              <p className="mt-1 text-xs text-muted-foreground">Requer permissão para emitir faturas.</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
            <Switch
              id="fiscal-auto-email"
              checked={allOn}
              disabled={!canToggle}
              onCheckedChange={handleToggle}
              aria-describedby="fiscal-auto-email-status"
            />
          </div>
        </div>
        <span id="fiscal-auto-email-status" className="sr-only">{status}</span>
      </div>
    </section>
  );
}
