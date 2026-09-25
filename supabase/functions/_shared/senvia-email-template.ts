const EMAIL_LOGO_URL = "https://app.senvia.pt/senvia-logo-white.png";
const SHELL_MARKER = 'data-senvia-email-shell="v1"';

/** Places an email body or full HTML document inside the standard SENVIA OS email frame. */
export function applySenviaEmailTemplate(html: string, title = "SENVIA OS"): string {
  const source = String(html ?? "").trim();
  // Do not wrap templates that already contain the complete SENVIA email design.
  // Older saved templates predate the marker but already use the same logo and palette.
  if (source.includes(SHELL_MARKER) || (
    source.includes(EMAIL_LOGO_URL) && source.toUpperCase().includes("#F0F4F8")
  )) return source;

  const head = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(source)?.[1] ?? "";
  const preservedStyles = [...head.matchAll(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi)]
    .map((match) => match[0])
    .join("\n");
  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(source)?.[1];
  const content = (body ?? source
    .replace(/<!doctype\b[^>]*>/gi, "")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, "")
    .replace(/<\/?html\b[^>]*>/gi, "")
    .replace(/<\/?body\b[^>]*>/gi, ""))
    .trim();

  const safeTitle = title.slice(0, 120)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;") || "SENVIA OS";
  return `<!DOCTYPE html>
<html lang="pt-PT">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  ${preservedStyles}
</head>
<body style="margin:0;padding:0;background-color:#F0F4F8;font-family:Arial,sans-serif;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#F0F4F8" style="background-color:#F0F4F8;padding:40px 0;">
    <tr><td align="center">
      <table ${SHELL_MARKER} role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 10px rgba(0,0,0,0.1);">
        <tr><td align="center" bgcolor="#1E3A8A" style="background-color:#1E3A8A;background-image:linear-gradient(135deg,#1E3A8A 0%,#2563EB 100%);padding:40px;">
          <img src="${EMAIL_LOGO_URL}" alt="SENVIA" width="150" style="display:block;width:150px;max-width:100%;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;">
        </td></tr>
        <tr><td style="padding:40px;color:#334155;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;">
          ${content}
        </td></tr>
        <tr><td align="center" bgcolor="#F8FAFC" style="background-color:#F8FAFC;padding:20px;border-top:1px solid #E2E8F0;color:#64748B;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">
          Transforme tráfego em lucro.
        </td></tr>
      </table>
      <p style="color:#94A3B8;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;margin:20px 0 0;">© 2025 SENVIA - AI Software House.</p>
    </td></tr>
  </table>
</body>
</html>`;
}
