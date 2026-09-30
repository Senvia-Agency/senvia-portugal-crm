import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type RenewalTriggerType = "sale_renewal_due_today" | "sale_renewal_due_in_2_days";

interface SaleRecord {
  id: string;
  organization_id: string;
  client_id: string | null;
  code: string | null;
  recurring_value: number | null;
  next_renewal_date: string | null;
  proposal_type: string | null;
  modelo_servico: string | null;
  servicos_produtos: string[] | null;
  client?: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    assigned_to?: string | null;
  } | null;
}

interface TemplateRecord {
  id: string;
  organization_id: string;
  automation_trigger_type: RenewalTriggerType;
  automation_delay_minutes: number;
}

interface SaleItemRecord {
  sale_id: string;
  name: string | null;
  product?: {
    name: string | null;
    is_recurring?: boolean | null;
  } | null;
}

const currencyFormatter = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
});

const dateFormatter = new Intl.DateTimeFormat("pt-PT", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

function formatCurrency(value: number | null | undefined): string {
  return currencyFormatter.format(Number(value || 0));
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  return dateFormatter.format(new Date(`${value}T00:00:00`));
}

function addMinutesIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function resolveRecurringService(sale: SaleRecord, items: SaleItemRecord[]): string {
  const recurringItem = items.find((item) => item.product?.is_recurring && (item.product?.name || item.name));
  if (recurringItem) return recurringItem.product?.name || recurringItem.name || "";

  const firstService = sale.servicos_produtos?.find(Boolean);
  if (firstService) return firstService;

  if (sale.modelo_servico) return sale.modelo_servico;

  const firstItem = items.find((item) => item.product?.name || item.name);
  return firstItem?.product?.name || firstItem?.name || "";
}

serve(async (req: Request): Promise<Response> => {
  const denied = await internalJobGuard(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Flow-engine side: per-cycle billing dates from the ledger. Runs first
    // and on its own, so the legacy path below can neither block it nor be
    // broken by it.
    try {
      const cycles = await announceSaleCycles(supabase, { supabaseUrl, serviceKey: supabaseServiceKey });
      console.log("[check-renewal-automations] sale cycles announced", cycles);
    } catch (error) {
      console.error("[check-renewal-automations] sale cycle announcement failed", (error as Error).message);
    }

    const today = new Date();
    const todayDate = today.toISOString().split("T")[0];
    const inTwoDaysDate = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const [todaySalesResult, twoDaysSalesResult, templatesResult] = await Promise.all([
      supabase
        .from("sales")
        .select(`
          id,
          organization_id,
          client_id,
          code,
          recurring_value,
          next_renewal_date,
          proposal_type,
          modelo_servico,
          servicos_produtos,
          client:crm_clients(id, name, email, phone, company, assigned_to)
        `)
        .eq("has_recurring", true)
        .eq("recurring_status", "active")
        .eq("next_renewal_date", todayDate),
      supabase
        .from("sales")
        .select(`
          id,
          organization_id,
          client_id,
          code,
          recurring_value,
          next_renewal_date,
          proposal_type,
          modelo_servico,
          servicos_produtos,
          client:crm_clients(id, name, email, phone, company, assigned_to)
        `)
        .eq("has_recurring", true)
        .eq("recurring_status", "active")
        .eq("next_renewal_date", inTwoDaysDate),
      supabase
        .from("email_templates")
        .select("id, organization_id, automation_trigger_type, automation_delay_minutes")
        .eq("automation_enabled", true)
        .eq("is_active", true)
        .in("automation_trigger_type", ["sale_renewal_due_today", "sale_renewal_due_in_2_days"]),
    ]);

    if (todaySalesResult.error) throw todaySalesResult.error;
    if (twoDaysSalesResult.error) throw twoDaysSalesResult.error;
    if (templatesResult.error) throw templatesResult.error;

    const renewalEvents = [
      ...((todaySalesResult.data || []) as SaleRecord[]).map((sale) => ({
        triggerType: "sale_renewal_due_today" as const,
        daysUntil: 0,
        sale,
      })),
      ...((twoDaysSalesResult.data || []) as SaleRecord[]).map((sale) => ({
        triggerType: "sale_renewal_due_in_2_days" as const,
        daysUntil: 2,
        sale,
      })),
    ];

    if (renewalEvents.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0, queued: 0, sent: 0, failed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const templates = (templatesResult.data || []) as TemplateRecord[];
    if (templates.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0, queued: 0, sent: 0, failed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const saleIds = renewalEvents.map(({ sale }) => sale.id);
    const organizationIds = [...new Set(renewalEvents.map(({ sale }) => sale.organization_id))];
    const assignedToIds = [...new Set(renewalEvents.map(({ sale }) => sale.client?.assigned_to).filter(Boolean))] as string[];

    const [itemsResult, paymentsResult, orgsResult, profilesResult] = await Promise.all([
      supabase
        .from("sale_items")
        .select("sale_id, name, product:products(name, is_recurring)")
        .in("sale_id", saleIds),
      supabase
        .from("sale_payments")
        .select("id, sale_id, amount, payment_date, status")
        .in("sale_id", saleIds)
        .eq("status", "pending"),
      supabase
        .from("organizations")
        .select("id, name")
        .in("id", organizationIds),
      assignedToIds.length > 0
        ? supabase.from("profiles").select("id, full_name, email, phone").in("id", assignedToIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (itemsResult.error) throw itemsResult.error;
    if (paymentsResult.error) throw paymentsResult.error;
    if (orgsResult.error) throw orgsResult.error;
    if (profilesResult.error) throw profilesResult.error;

    const itemsBySale = new Map<string, SaleItemRecord[]>();
    for (const item of (itemsResult.data || []) as SaleItemRecord[]) {
      const current = itemsBySale.get(item.sale_id) || [];
      current.push(item);
      itemsBySale.set(item.sale_id, current);
    }

    const paymentBySaleAndDate = new Map<string, { id: string; amount: number | null }>();
    for (const payment of (paymentsResult.data || []) as Array<{ id: string; sale_id: string; amount: number | null; payment_date: string; status: string }>) {
      const key = `${payment.sale_id}:${payment.payment_date}`;
      if (!paymentBySaleAndDate.has(key)) {
        paymentBySaleAndDate.set(key, { id: payment.id, amount: payment.amount });
      }
    }

    const orgNameById = new Map<string, string>();
    for (const org of (orgsResult.data || []) as Array<{ id: string; name: string | null }>) {
      orgNameById.set(org.id, org.name || "");
    }

    const vendorById = new Map<string, { full_name: string; email: string; phone: string }>();
    for (const profile of (profilesResult.data || []) as Array<{ id: string; full_name: string | null; email: string | null; phone: string | null }>) {
      vendorById.set(profile.id, {
        full_name: profile.full_name || "",
        email: profile.email || "",
        phone: profile.phone || "",
      });
    }

    const templatesByKey = new Map<string, TemplateRecord[]>();
    for (const template of templates) {
      const key = `${template.organization_id}:${template.automation_trigger_type}`;
      const current = templatesByKey.get(key) || [];
      current.push(template);
      templatesByKey.set(key, current);
    }

    let processed = 0;
    let queued = 0;
    let sent = 0;
    let failed = 0;

    for (const event of renewalEvents) {
      const { sale, triggerType, daysUntil } = event;
      const client = sale.client;
      const recipientEmail = client?.email?.trim();
      if (!recipientEmail || !sale.next_renewal_date) continue;

      const matchingTemplates = templatesByKey.get(`${sale.organization_id}:${triggerType}`) || [];
      if (matchingTemplates.length === 0) continue;

      const saleItems = itemsBySale.get(sale.id) || [];
      const vendor = client?.assigned_to ? vendorById.get(client.assigned_to) : undefined;
      const payment = paymentBySaleAndDate.get(`${sale.id}:${sale.next_renewal_date}`);
      const recurringValue = Number(sale.recurring_value || 0);
      const paymentValue = Number(payment?.amount ?? sale.recurring_value ?? 0);
      const productService = resolveRecurringService(sale, saleItems);
      const organizationName = orgNameById.get(sale.organization_id) || "";

      const variables: Record<string, string> = {
        nome: client?.name || "",
        email: recipientEmail,
        telefone: client?.phone || "",
        empresa: client?.company || "",
        organizacao: organizationName,
        vendedor: vendor?.full_name || "",
        vendedor_email: vendor?.email || "",
        vendedor_telefone: vendor?.phone || "",
        codigo_venda: sale.code || "",
        produto_servico: productService,
        valor_recorrente: formatCurrency(recurringValue),
        valor_pagamento: formatCurrency(paymentValue),
        data_renovacao: formatDate(sale.next_renewal_date),
        dias_para_renovacao: String(daysUntil),
        data: formatDate(todayDate),
        client_id: sale.client_id || "",
      };

      for (const template of matchingTemplates) {
        processed++;

        const { data: runId, error: runError } = await supabase.rpc("acquire_renewal_automation_run", {
          p_organization_id: sale.organization_id,
          p_sale_id: sale.id,
          p_template_id: template.id,
          p_trigger_type: triggerType,
          p_renewal_date: sale.next_renewal_date,
          p_renewal_payment_id: payment?.id ?? null,
        });

        if (runError) {
          console.error("Failed to acquire renewal automation run", runError);
          failed++;
          continue;
        }

        if (!runId) {
          continue;
        }

        try {
          if ((template.automation_delay_minutes || 0) > 0) {
            const { error: queueError } = await supabase.from("automation_queue").insert({
              automation_id: template.id,
              organization_id: sale.organization_id,
              recipient_email: recipientEmail,
              recipient_name: client?.name || "",
              variables,
              template_id: template.id,
              scheduled_for: addMinutesIso(template.automation_delay_minutes || 0),
              status: "pending",
            });

            if (queueError) {
              await supabase.rpc("mark_renewal_automation_run", {
                p_run_id: runId,
                p_status: "failed",
                p_last_error: queueError.message,
              });
              failed++;
              continue;
            }

            await supabase.rpc("mark_renewal_automation_run", {
              p_run_id: runId,
              p_status: "sent",
              p_last_error: null,
            });
            queued++;
            continue;
          }

          const { data: sendData, error: sendError } = await supabase.functions.invoke("send-template-email", {
            body: {
              organizationId: sale.organization_id,
              templateId: template.id,
              automationId: template.id,
              recipients: [{
                email: recipientEmail,
                name: client?.name || "",
                clientId: sale.client_id || undefined,
                variables,
              }],
            },
          });

          const sendFailed = Boolean(sendError) || Number(sendData?.summary?.failed || 0) > 0;
          if (sendFailed) {
            await supabase.rpc("mark_renewal_automation_run", {
              p_run_id: runId,
              p_status: "failed",
              p_last_error: sendError?.message || sendData?.results?.[0]?.error || "Falha no envio",
            });
            failed++;
            continue;
          }

          await supabase.rpc("mark_renewal_automation_run", {
            p_run_id: runId,
            p_status: "sent",
            p_last_error: null,
          });
          sent++;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Erro interno";
          await supabase.rpc("mark_renewal_automation_run", {
            p_run_id: runId,
            p_status: "failed",
            p_last_error: message,
          });
          failed++;
        }
      }
    }

    return new Response(JSON.stringify({ success: true, processed, queued, sent, failed }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in check-renewal-automations:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
import { internalJobGuard } from "../_shared/internal-auth.ts";
import { announceSaleCycles } from "../_shared/sale-cycle-automations.ts";
