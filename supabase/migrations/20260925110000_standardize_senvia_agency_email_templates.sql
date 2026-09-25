-- Normalize the remaining SENVIA Agency templates that were saved before the
-- shared email frame existed. Keep every message body intact and only replace
-- the old outer shell / brand colors.
DO $$
DECLARE
  v_org uuid := '06fe9e1d-9670-45b0-8717-c5a6e90be380';
  v_old_head text := '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a2e;"><div style="font-size:20px;font-weight:700;color:#5b21b6;margin-bottom:16px;">Senvia OS</div>';
  v_old_foot text := '<hr style="border:none;border-top:1px solid #eee;margin:28px 0 16px;"><div style="font-size:12px;color:#888;">Recebeu este email porque tem um período de teste do Senvia OS. Se precisar de ajuda, é só responder a este email.</div></div>';
  v_new_head text := '<!DOCTYPE html>
<html lang="pt-PT">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>SENVIA OS</title></head>
<body style="margin:0;padding:0;background-color:#F0F4F8;font-family:Arial,sans-serif;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#F0F4F8" style="background-color:#F0F4F8;padding:40px 0;">
<tr><td align="center">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 10px rgba(0,0,0,0.1);">
<tr><td align="center" bgcolor="#1E3A8A" style="background-color:#1E3A8A;background-image:linear-gradient(135deg,#1E3A8A 0%,#2563EB 100%);padding:40px;">
<img src="https://app.senvia.pt/senvia-logo-white.png" alt="SENVIA" width="150" style="display:block;width:150px;max-width:100%;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;">
</td></tr>
<tr><td data-senvia-email-shell="v1" style="padding:40px;color:#334155;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;">';
  v_new_foot text := '</td></tr>
<tr><td align="center" bgcolor="#F8FAFC" style="background-color:#F8FAFC;padding:20px;border-top:1px solid #E2E8F0;color:#64748B;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">Transforme tráfego em lucro.</td></tr>
</table>
<p style="color:#94A3B8;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;margin:20px 0 0;">© 2025 SENVIA - AI Software House.</p>
</td></tr></table>
</body></html>';
  v_changed integer;
BEGIN
  UPDATE public.email_templates
  SET html_content = v_new_head ||
    replace(
      replace(
        replace(html_content, v_old_head, ''),
        v_old_foot, ''
      ),
      '#5b21b6', '#2563EB'
    ) || v_new_foot
  WHERE organization_id = v_org
    AND (
      automation_trigger_type IN (
        'trial_day_7', 'trial_expired', 'trial_expiring_3d', 'trial_inactive_48h'
      )
      OR name = 'Lista de materiais LP'
    )
    AND html_content NOT LIKE '%senvia-logo-white.png%';

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RAISE NOTICE 'SENVIA Agency templates normalized: %', v_changed;
END $$;
