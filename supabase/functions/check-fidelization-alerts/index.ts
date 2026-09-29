import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { applySenviaEmailTemplate } from "../_shared/senvia-email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CpeAlert {
  id: string;
  equipment_type: string;
  serial_number: string | null;
  comercializador: string;
  fidelizacao_end: string;
  client_id: string;
  client_name: string;
  client_company: string | null;
  client_email: string | null;
  organization_id: string;
  days_until_expiry: number;
  alert_type: '30d' | '7d';
}

interface OrganizationSettings {
  id: string;
  name: string;
  fidelization_alert_days: number[];
  fidelization_create_event: boolean;
  fidelization_event_time: string;
  fidelization_email_enabled: boolean;
  fidelization_email: string | null;
  // Contract loyalty on SALES (telecom): when to warn, and through what.
  fidelization_sales_alert_days: number[] | null;
  fidelization_sales_push_enabled: boolean | null;
  fidelization_sales_email_enabled: boolean | null;
  brevo_api_key: string | null;
  brevo_sender_email: string | null;
}

async function sendBrevoEmail(
  brevoApiKey: string,
  senderEmail: string,
  toEmail: string,
  cpe: CpeAlert,
  orgName: string
): Promise<boolean> {
  try {
    const expiryDate = new Date(cpe.fidelizacao_end).toLocaleDateString('pt-PT');
    const isUrgent = cpe.alert_type === '7d';
    const subject = isUrgent 
      ? `⚠️ URGENTE: Fidelização expira em ${cpe.days_until_expiry} dias - ${cpe.client_name}`
      : `🔔 Fidelização a expirar - ${cpe.client_name}`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
          .container { max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
          .header { background: ${isUrgent ? '#ef4444' : '#f59e0b'}; color: white; padding: 20px; text-align: center; }
          .header h1 { margin: 0; font-size: 18px; }
          .content { padding: 24px; }
          .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; }
          .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
          .info-row:last-child { border-bottom: none; }
          .label { color: #64748b; font-size: 14px; }
          .value { color: #0f172a; font-weight: 500; font-size: 14px; }
          .cta { text-align: center; margin-top: 24px; }
          .cta a { display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500; }
          .footer { text-align: center; padding: 16px; color: #94a3b8; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${isUrgent ? '⚠️ Ação Urgente Necessária' : '🔔 Alerta de Renovação'}</h1>
          </div>
          <div class="content">
            <p>Olá,</p>
            <p>A fidelização do cliente abaixo expira em <strong>${cpe.days_until_expiry} dias</strong>:</p>
            
            <div class="info-box">
              <div class="info-row">
                <span class="label">Cliente</span>
                <span class="value">${cpe.client_name}</span>
              </div>
              ${cpe.client_company ? `
              <div class="info-row">
                <span class="label">Empresa</span>
                <span class="value">${cpe.client_company}</span>
              </div>
              ` : ''}
              <div class="info-row">
                <span class="label">Tipo</span>
                <span class="value">${cpe.equipment_type}</span>
              </div>
              <div class="info-row">
                <span class="label">Comercializador</span>
                <span class="value">${cpe.comercializador}</span>
              </div>
              ${cpe.serial_number ? `
              <div class="info-row">
                <span class="label">CPE/CUI</span>
                <span class="value">${cpe.serial_number}</span>
              </div>
              ` : ''}
              <div class="info-row">
                <span class="label">Data de Expiração</span>
                <span class="value">${expiryDate}</span>
              </div>
            </div>
            
            <p>Recomendamos que contacte o cliente para renovar ou renegociar o contrato.</p>
          </div>
          <div class="footer">
            Enviado por ${orgName} via SENVIA Software House
          </div>
        </div>
      </body>
      </html>
    `;

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': brevoApiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: orgName },
        to: [{ email: toEmail }],
        subject,
        htmlContent: applySenviaEmailTemplate(htmlContent, subject),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Brevo API error:', errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}

interface SaleLoyaltyAlert {
  id: string;
  code: string | null;
  client_name: string;
  products: string[];
  fidelizacao_end: string;
  days_until_end: number;
  urgent: boolean;
}

async function sendSaleLoyaltyEmail(
  brevoApiKey: string,
  senderEmail: string,
  toEmails: string[],
  sale: SaleLoyaltyAlert,
  orgName: string,
): Promise<boolean> {
  try {
    const endDate = new Date(sale.fidelizacao_end).toLocaleDateString('pt-PT');
    const subject = sale.urgent
      ? `⚠️ Fidelização termina em ${sale.days_until_end} dias - ${sale.client_name}`
      : `🔔 Fidelização a terminar - ${sale.client_name}`;
    const htmlContent = `
      <!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:20px;background:#f5f5f5}
        .c{max-width:500px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)}
        .h{background:${sale.urgent ? '#ef4444' : '#f59e0b'};color:#fff;padding:20px;text-align:center}.h h1{margin:0;font-size:18px}
        .b{padding:24px}.box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0}
        .r{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0}.r:last-child{border-bottom:none}
        .l{color:#64748b;font-size:14px}.v{color:#0f172a;font-weight:500;font-size:14px}.f{text-align:center;padding:16px;color:#94a3b8;font-size:12px}
      </style></head><body><div class="c">
        <div class="h"><h1>${sale.urgent ? '⚠️ Fidelização a terminar' : '🔔 Fidelização a terminar'}</h1></div>
        <div class="b"><p>Olá,</p><p>A fidelização do contrato abaixo termina em <strong>${sale.days_until_end} dias</strong>:</p>
          <div class="box">
            <div class="r"><span class="l">Cliente</span><span class="v">${sale.client_name}</span></div>
            ${sale.code ? `<div class="r"><span class="l">Venda</span><span class="v">${sale.code}</span></div>` : ''}
            ${sale.products.length ? `<div class="r"><span class="l">Produto</span><span class="v">${sale.products.join(', ')}</span></div>` : ''}
            <div class="r"><span class="l">Fim da fidelização</span><span class="v">${endDate}</span></div>
          </div>
          <p>Recomendamos contactar o cliente para renovar ou renegociar o contrato.</p>
        </div><div class="f">Enviado por ${orgName} via SENVIA Software House</div>
      </div></body></html>`;
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': brevoApiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ sender: { email: senderEmail, name: orgName }, to: toEmails.map((email) => ({ email })), subject, htmlContent: applySenviaEmailTemplate(htmlContent, subject) }),
    });
    if (!response.ok) { console.error('Brevo API error (sale loyalty):', await response.text()); return false; }
    return true;
  } catch (error) {
    console.error('Error sending sale loyalty email:', error);
    return false;
  }
}

serve(async (req) => {
  const denied = await internalJobGuard(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Starting fidelization alerts check...");

    // Get only telecom organizations with their settings
    const { data: organizations, error: orgsError } = await supabase
      .from('organizations')
      .select('id, name, niche, fidelization_alert_days, fidelization_create_event, fidelization_event_time, fidelization_email_enabled, fidelization_email, fidelization_sales_alert_days, fidelization_sales_push_enabled, fidelization_sales_email_enabled, brevo_api_key, brevo_sender_email')
      .eq('niche', 'telecom');

    if (orgsError) {
      throw new Error(`Error fetching organizations: ${orgsError.message}`);
    }

    const results = {
      processed: 0,
      alerts_sent: 0,
      emails_sent: 0,
      events_created: 0,
      errors: [] as string[],
    };

    for (const org of organizations as OrganizationSettings[]) {
      const alertDays = org.fidelization_alert_days || [30, 7];
      const [firstAlert, secondAlert] = alertDays;

      // Get CPEs expiring within alert windows that haven't been alerted
      const today = new Date();
      const firstAlertDate = new Date();
      firstAlertDate.setDate(today.getDate() + firstAlert);
      const secondAlertDate = new Date();
      secondAlertDate.setDate(today.getDate() + secondAlert);

      // Query for 30-day alerts
      const { data: cpesFor30d, error: cpes30Error } = await supabase
        .from('cpes')
        .select(`
          id, equipment_type, serial_number, comercializador, fidelizacao_end, client_id,
          crm_clients!inner(name, company, email)
        `)
        .eq('organization_id', org.id)
        .eq('status', 'active')
        .eq('alert_30d_sent', false)
        .not('fidelizacao_end', 'is', null)
        .gte('fidelizacao_end', today.toISOString().split('T')[0])
        .lte('fidelizacao_end', firstAlertDate.toISOString().split('T')[0]);

      if (cpes30Error) {
        results.errors.push(`Org ${org.id}: ${cpes30Error.message}`);
        continue;
      }

      // Query for 7-day alerts
      const { data: cpesFor7d, error: cpes7Error } = await supabase
        .from('cpes')
        .select(`
          id, equipment_type, serial_number, comercializador, fidelizacao_end, client_id,
          crm_clients!inner(name, company, email)
        `)
        .eq('organization_id', org.id)
        .eq('status', 'active')
        .eq('alert_7d_sent', false)
        .not('fidelizacao_end', 'is', null)
        .gte('fidelizacao_end', today.toISOString().split('T')[0])
        .lte('fidelizacao_end', secondAlertDate.toISOString().split('T')[0]);

      if (cpes7Error) {
        results.errors.push(`Org ${org.id}: ${cpes7Error.message}`);
        continue;
      }

      // Process 30-day alerts
      for (const cpe of cpesFor30d || []) {
        const expiryDate = new Date(cpe.fidelizacao_end);
        const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        const alert: CpeAlert = {
          id: cpe.id,
          equipment_type: cpe.equipment_type,
          serial_number: cpe.serial_number,
          comercializador: cpe.comercializador,
          fidelizacao_end: cpe.fidelizacao_end,
          client_id: cpe.client_id,
          client_name: (cpe as any).crm_clients.name,
          client_company: (cpe as any).crm_clients.company,
          client_email: (cpe as any).crm_clients.email,
          organization_id: org.id,
          days_until_expiry: daysUntilExpiry,
          alert_type: '30d',
        };

        // Send email if enabled
        if (org.fidelization_email_enabled && org.fidelization_email && (Deno.env.get('BREVO_TRANSACTIONAL_API_KEY') || org.brevo_api_key) && org.brevo_sender_email) {
          const emailSent = await sendBrevoEmail(
            Deno.env.get('BREVO_TRANSACTIONAL_API_KEY') || org.brevo_api_key,
            org.brevo_sender_email,
            org.fidelization_email,
            alert,
            org.name
          );
          if (emailSent) results.emails_sent++;
        }

        // Create calendar event if enabled
        if (org.fidelization_create_event) {
          const eventDate = new Date(cpe.fidelizacao_end);
          eventDate.setDate(eventDate.getDate() - 7); // Event 7 days before expiry
          
          const [hours, minutes] = (org.fidelization_event_time || '10:00').split(':');
          const preferredHour = parseInt(hours);
          const preferredMinute = parseInt(minutes);

          // Get first admin user for the organization
          const { data: members } = await supabase
            .from('organization_members')
            .select('user_id')
            .eq('organization_id', org.id)
            .eq('role', 'admin')
            .eq('is_active', true)
            .limit(1);

          if (members && members.length > 0) {
            const userId = members[0].user_id;
            
            // Get all events for this day to check conflicts
            const dayStart = new Date(eventDate);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(eventDate);
            dayEnd.setHours(23, 59, 59, 999);

            const { data: existingEvents } = await supabase
              .from('calendar_events')
              .select('start_time, end_time')
              .eq('organization_id', org.id)
              .eq('user_id', userId)
              .gte('start_time', dayStart.toISOString())
              .lte('start_time', dayEnd.toISOString())
              .neq('status', 'cancelled');

            // Find first free slot (30-minute increments from preferred time until 18:00)
            let foundSlot = false;
            let slotStart = new Date(eventDate);
            slotStart.setHours(preferredHour, preferredMinute, 0, 0);

            while (!foundSlot && slotStart.getHours() < 18) {
              const slotEnd = new Date(slotStart);
              slotEnd.setHours(slotEnd.getHours() + 1);

              // Check if this slot conflicts with any existing event
              const hasConflict = (existingEvents || []).some(event => {
                const eventStart = new Date(event.start_time);
                const eventEnd = event.end_time ? new Date(event.end_time) : new Date(eventStart.getTime() + 60 * 60 * 1000);
                
                // Overlap check: slot overlaps if it starts before event ends AND ends after event starts
                return slotStart < eventEnd && slotEnd > eventStart;
              });

              if (!hasConflict) {
                foundSlot = true;
              } else {
                // Try next 30-minute slot
                slotStart.setMinutes(slotStart.getMinutes() + 30);
              }
            }

            if (foundSlot) {
              const endTime = new Date(slotStart);
              endTime.setHours(endTime.getHours() + 1);

              await supabase.from('calendar_events').insert({
                organization_id: org.id,
                user_id: userId,
                client_id: cpe.client_id,
                title: `Renovação - ${alert.client_name}`,
                description: `Fidelização do ${cpe.equipment_type} (${cpe.comercializador}) expira em ${new Date(cpe.fidelizacao_end).toLocaleDateString('pt-PT')}. Contactar cliente para renovação.`,
                event_type: 'visit',
                start_time: slotStart.toISOString(),
                end_time: endTime.toISOString(),
              });
              results.events_created++;
              console.log(`Created event for ${alert.client_name} at ${slotStart.toISOString()}`);
            } else {
              console.log(`No free slot found for ${alert.client_name} on ${eventDate.toDateString()}`);
            }
          }
        }

        // Mark alert as sent
        await supabase
          .from('cpes')
          .update({ alert_30d_sent: true })
          .eq('id', cpe.id);

        results.alerts_sent++;
      }

      // Process 7-day alerts
      for (const cpe of cpesFor7d || []) {
        const expiryDate = new Date(cpe.fidelizacao_end);
        const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        const alert: CpeAlert = {
          id: cpe.id,
          equipment_type: cpe.equipment_type,
          serial_number: cpe.serial_number,
          comercializador: cpe.comercializador,
          fidelizacao_end: cpe.fidelizacao_end,
          client_id: cpe.client_id,
          client_name: (cpe as any).crm_clients.name,
          client_company: (cpe as any).crm_clients.company,
          client_email: (cpe as any).crm_clients.email,
          organization_id: org.id,
          days_until_expiry: daysUntilExpiry,
          alert_type: '7d',
        };

        // Send email if enabled
        if (org.fidelization_email_enabled && org.fidelization_email && (Deno.env.get('BREVO_TRANSACTIONAL_API_KEY') || org.brevo_api_key) && org.brevo_sender_email) {
          const emailSent = await sendBrevoEmail(
            Deno.env.get('BREVO_TRANSACTIONAL_API_KEY') || org.brevo_api_key,
            org.brevo_sender_email,
            org.fidelization_email,
            alert,
            org.name
          );
          if (emailSent) results.emails_sent++;
        }

        // Mark alert as sent
        await supabase
          .from('cpes')
          .update({ alert_7d_sent: true })
          .eq('id', cpe.id);

        results.alerts_sent++;
      }

      // ── Contract loyalty on the SALES themselves (telecom). Two windows,
      //    each sent once per sale; push to every admin, email to every
      //    admin's address — the people who renew contracts.
      const saleDays = (org.fidelization_sales_alert_days as number[] | null) || [60, 15];
      const [saleFirst, saleSecond] = saleDays;
      const todayStr = today.toISOString().split('T')[0];
      const saleWindows: { days: number; flag: 'fidelizacao_alert_1_sent' | 'fidelizacao_alert_2_sent'; urgent: boolean }[] = [
        { days: saleFirst, flag: 'fidelizacao_alert_1_sent', urgent: false },
        { days: saleSecond, flag: 'fidelizacao_alert_2_sent', urgent: true },
      ];
      let adminIds: string[] | null = null;
      let adminEmails: string[] | null = null;
      const loadAdmins = async () => {
        if (adminIds) return;
        const { data: admins } = await supabase
          .from('organization_members')
          .select('user_id')
          .eq('organization_id', org.id)
          .eq('role', 'admin')
          .eq('is_active', true);
        adminIds = (admins || []).map((m: any) => m.user_id);
        if (adminIds.length === 0) { adminEmails = []; return; }
        const { data: profiles } = await supabase.from('profiles').select('email').in('id', adminIds);
        adminEmails = (profiles || []).map((p: any) => p.email).filter((e: string | null): e is string => !!e && e.includes('@'));
      };
      for (const w of saleWindows) {
        if (!w.days || w.days <= 0) continue;
        const limit = new Date();
        limit.setDate(today.getDate() + w.days);
        const { data: dueSales, error: salesError } = await supabase
          .from('sales')
          .select('id, code, fidelizacao_end, servicos_produtos, client_id, lead_id, crm_clients:client_id(name), leads:lead_id(name)')
          .eq('organization_id', org.id)
          .eq(w.flag, false)
          .neq('status', 'cancelled')
          .not('fidelizacao_end', 'is', null)
          .gte('fidelizacao_end', todayStr)
          .lte('fidelizacao_end', limit.toISOString().split('T')[0]);
        if (salesError) { results.errors.push(`Org ${org.id} sales: ${salesError.message}`); continue; }
        for (const sale of dueSales || []) {
          await loadAdmins();
          const endDate = new Date(sale.fidelizacao_end);
          const alert: SaleLoyaltyAlert = {
            id: sale.id,
            code: sale.code,
            client_name: (sale as any).crm_clients?.name || (sale as any).leads?.name || 'Cliente',
            products: (sale.servicos_produtos as string[] | null) || [],
            fidelizacao_end: sale.fidelizacao_end,
            days_until_end: Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
            urgent: w.urgent,
          };
          if ((org.fidelization_sales_push_enabled ?? true) && adminIds && adminIds.length > 0) {
            const { error: pushError } = await supabase.functions.invoke('send-push-notification', {
              body: {
                organization_id: org.id,
                user_ids: adminIds,
                title: alert.urgent ? `⚠️ Fidelização termina em ${alert.days_until_end} dias` : '🔔 Fidelização a terminar',
                body: `${alert.client_name}${alert.code ? ` · ${alert.code}` : ''} — termina a ${endDate.toLocaleDateString('pt-PT')}`,
                url: '/vendas',
                tag: `sale-loyalty-${sale.id}`,
              },
            });
            if (pushError) results.errors.push(`Push ${sale.id}: ${pushError.message}`);
          }
          const brevoKey = Deno.env.get('BREVO_TRANSACTIONAL_API_KEY') || org.brevo_api_key;
          if ((org.fidelization_sales_email_enabled ?? true) && adminEmails && adminEmails.length > 0 && brevoKey && org.brevo_sender_email) {
            const sent = await sendSaleLoyaltyEmail(brevoKey, org.brevo_sender_email, adminEmails, alert, org.name);
            if (sent) results.emails_sent++;
          }
          await supabase.from('sales').update({ [w.flag]: true }).eq('id', sale.id);
          results.alerts_sent++;
        }
      }

      results.processed++;
    }

    console.log("Fidelization alerts check complete:", results);

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  } catch (error: any) {
    console.error("Error in check-fidelization-alerts:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
import { internalJobGuard } from "../_shared/internal-auth.ts";
