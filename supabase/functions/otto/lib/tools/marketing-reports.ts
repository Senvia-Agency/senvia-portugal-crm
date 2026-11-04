import type { Tool } from "../types.ts";
import { UUID_RE, resultError, stringArg } from "./marketing-shared.ts";

const REPORT_PERMISSION = { module: "marketing" as const, subarea: "reports" as const };
const PERIOD_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
type ReportPeriod = keyof typeof PERIOD_DAYS;

function isReportPeriod(value: string): value is ReportPeriod {
  return value === "7d" || value === "30d" || value === "90d";
}

function statusCount(rows: readonly Readonly<{ status: unknown }>[], statuses: readonly string[]): number {
  const allowed = new Set(statuses);
  return rows.filter((row) => typeof row.status === "string" && allowed.has(row.status)).length;
}

export const marketingReportTools: Tool[] = [
  {
    name: "get_marketing_report",
    description: "Consultar métricas e eventos de email da organização atual por período e origem, sem credenciais nem conteúdo HTML.",
    module: "marketing",
    permission: { ...REPORT_PERMISSION, action: "view" },
    parameters: { type: "object", properties: { period: { type: "string", enum: ["7d", "30d", "90d"] }, source: { type: "string", enum: ["all", "campaign", "automation"] }, source_id: { type: "string" } }, required: [] },
    execute: async (args, ctx) => {
      const period = stringArg(args, "period") ?? "30d";
      if (!isReportPeriod(period)) return resultError("O período tem de ser 7d, 30d ou 90d.", "invalid_report_period");
      const source = stringArg(args, "source") ?? "all";
      if (source !== "all" && source !== "campaign" && source !== "automation") return resultError("A origem tem de ser all, campaign ou automation.", "invalid_report_source");
      const sourceId = stringArg(args, "source_id");
      if (sourceId && !UUID_RE.test(sourceId)) return resultError("Indica um ID de origem válido.", "invalid_report_source_id");
      const periodStart = new Date(Date.now() - PERIOD_DAYS[period] * 86400000).toISOString();
      let request = ctx.supabaseAdmin
        .from("email_sends")
        .select("id, organization_id, campaign_id, automation_id, recipient_email, recipient_name, subject, status, sent_at, created_at, opened_at, clicked_at")
        .eq("organization_id", ctx.orgId)
        .gte("created_at", periodStart)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (source === "campaign") request = sourceId ? request.eq("campaign_id", sourceId) : request.not("campaign_id", "is", null);
      if (source === "automation") request = sourceId ? request.eq("automation_id", sourceId) : request.not("automation_id", "is", null);
      const { data, error } = await request;
      if (error) return resultError("Não foi possível consultar o relatório de marketing.");
      const rows = data ?? [];
      const sent = statusCount(rows, ["sent", "delivered", "opened", "clicked"]);
      const delivered = statusCount(rows, ["delivered", "opened", "clicked"]);
      const opened = rows.filter((row) => typeof row.opened_at === "string").length;
      const clicked = rows.filter((row) => typeof row.clicked_at === "string").length;
      const daily = new Map<string, { sent: number; delivered: number; failed: number; opened: number; clicked: number }>();
      for (const row of rows) {
        if (typeof row.created_at !== "string") continue;
        const day = row.created_at.slice(0, 10);
        const counts = daily.get(day) ?? { sent: 0, delivered: 0, failed: 0, opened: 0, clicked: 0 };
        if (typeof row.status === "string" && ["sent", "delivered", "opened", "clicked"].includes(row.status)) counts.sent += 1;
        if (typeof row.status === "string" && ["delivered", "opened", "clicked"].includes(row.status)) counts.delivered += 1;
        if (row.status === "failed") counts.failed += 1;
        if (typeof row.opened_at === "string") counts.opened += 1;
        if (typeof row.clicked_at === "string") counts.clicked += 1;
        daily.set(day, counts);
      }
      return {
        period,
        source,
        source_id: sourceId ?? null,
        total: rows.length,
        sent,
        delivered,
        failed: statusCount(rows, ["failed"]),
        bounced: statusCount(rows, ["bounced"]),
        blocked: statusCount(rows, ["blocked"]),
        spam: statusCount(rows, ["spam"]),
        unsubscribed: statusCount(rows, ["unsubscribed"]),
        opened,
        clicked,
        delivered_rate: sent > 0 ? Math.round((delivered / sent) * 100) : 0,
        open_rate: sent > 0 ? Math.round((opened / sent) * 100) : 0,
        click_rate: opened > 0 ? Math.round((clicked / opened) * 100) : 0,
        daily: [...daily.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, counts]) => ({ date, ...counts })),
        events: rows,
        destination: "/marketing/reports",
      };
    },
  },
];
