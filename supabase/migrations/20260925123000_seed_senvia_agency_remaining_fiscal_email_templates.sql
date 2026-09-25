-- Complete the manual SENVIA Agency fiscal email templates.
-- Each document type gets its own active trigger; no email automation is enabled.
DO $$
DECLARE
  v_org uuid := '06fe9e1d-9670-45b0-8717-c5a6e90be380';
  v_html text := '<!DOCTYPE html>
<html lang="pt-PT">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Documento fiscal SENVIA</title>
</head>
<body style="margin:0;padding:0;background-color:#F0F4F8;font-family:Arial,sans-serif;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#F0F4F8" style="background-color:#F0F4F8;padding:40px 0;">
    <tr><td align="center">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 10px rgba(0,0,0,0.1);">
        <tr>
          <td align="center" bgcolor="#1E3A8A" style="background-color:#1E3A8A;background-image:linear-gradient(135deg,#1E3A8A 0%,#2563EB 100%);padding:40px;">
            <img src="https://app.senvia.pt/senvia-logo-white.png" alt="SENVIA" width="150" style="display:block;width:150px;max-width:100%;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;">
          </td>
        </tr>
        <tr>
          <td data-senvia-email-shell="v1" style="padding:40px;color:#334155;font-size:16px;line-height:1.6;">
            <p style="margin-top:0;">Exmo.(a) {{nome}},</p>
            <p>Segue em anexo o documento fiscal <strong>{{tipo_documento}} {{numero_documento}}</strong>, emitido em {{data_emissao}}, no valor de <strong>{{valor}}</strong>.</p>
            <p>Se tiver alguma questão sobre este documento, por favor responda a este email.</p>
            <p style="margin-bottom:0;">Com os melhores cumprimentos,<br><strong>{{empresa}}</strong></p>
          </td>
        </tr>
        <tr>
          <td align="center" bgcolor="#F8FAFC" style="background-color:#F8FAFC;padding:20px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;font-weight:bold;">
            Transforme tráfego em lucro.
          </td>
        </tr>
      </table>
      <p style="color:#94A3B8;font-size:12px;line-height:1.5;margin:20px 0 0;">© 2025 SENVIA - AI Software House.</p>
    </td></tr>
  </table>
</body>
</html>';
  v_template record;
BEGIN
  FOR v_template IN
    SELECT * FROM (VALUES
      ('invoice_receipt_email', 'Envio de Fatura-Recibo'),
      ('receipt_email', 'Envio de Recibo'),
      ('credit_note_email', 'Envio de Nota de Crédito')
    ) AS templates(trigger_type, template_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.email_templates
      WHERE organization_id = v_org
        AND automation_trigger_type = v_template.trigger_type
        AND is_active = true
    ) THEN
      INSERT INTO public.email_templates (
        organization_id, name, subject, html_content, category, variables,
        is_active, automation_enabled, automation_trigger_type,
        automation_trigger_config, automation_delay_minutes
      ) VALUES (
        v_org,
        v_template.template_name,
        'Documento fiscal {{numero_documento}} | {{empresa}}',
        v_html,
        'general',
        '["nome","tipo_documento","numero_documento","data_emissao","valor","empresa"]'::jsonb,
        true,
        false,
        v_template.trigger_type,
        '{}'::jsonb,
        0
      );
    END IF;
  END LOOP;
END $$;
