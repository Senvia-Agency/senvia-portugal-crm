import type { Tool, ToolContext } from "../types.ts";
import { CAMPAIGN_COLUMNS, SEND_RESULT_COLUMNS, UUID_RE, resultError, stringArg } from "./marketing-shared.ts";

const CAMPAIGN_PERMISSION = { module: "marketing" as const, subarea: "campaigns" as const };

function campaignId(args: Readonly<Record<string, unknown>>): string | null {
  const id = stringArg(args, "campaign_id");
  return id && UUID_RE.test(id) ? id : null;
}

async function campaignForOrg(ctx: ToolContext, id: string) {
  return ctx.supabaseAdmin
    .from("email_campaigns")
    .select(CAMPAIGN_COLUMNS)
    .eq("organization_id", ctx.orgId)
    .eq("id", id)
    .maybeSingle();
}

async function templateSummaries(ctx: ToolContext, templateIds: readonly string[]) {
  if (templateIds.length === 0) return new Map<string, Readonly<Record<string, unknown>>>();
  const { data } = await ctx.supabaseAdmin
    .from("email_templates")
    .select("id, name, subject, is_active")
    .eq("organization_id", ctx.orgId)
    .in("id", templateIds);
  return new Map((data ?? []).map((row) => [row.id, row]));
}

export const marketingCampaignReadTools: Tool[] = [
  {
    name: "list_email_campaigns",
    description: "Listar campanhas de email da organização atual, incluindo rascunhos, agendadas e resultados agregados.",
    module: "marketing",
    permission: { ...CAMPAIGN_PERMISSION, action: "view" },
    parameters: { type: "object", properties: { status: { type: "string" } }, required: [] },
    execute: async (args, ctx) => {
      let request = ctx.supabaseAdmin
        .from("email_campaigns")
        .select(CAMPAIGN_COLUMNS)
        .eq("organization_id", ctx.orgId)
        .order("updated_at", { ascending: false })
        .limit(100);
      const status = stringArg(args, "status");
      if (status) request = request.eq("status", status);
      const { data, error } = await request;
      if (error) return resultError("Não foi possível listar as campanhas.");
      const rows = data ?? [];
      const templates = await templateSummaries(ctx, rows.map((row) => row.template_id).filter((id): id is string => typeof id === "string"));
      return {
        results: rows.map((row) => ({ ...row, template: row.template_id ? templates.get(row.template_id) ?? null : null })),
        count: rows.length,
        destination: "/marketing/campaigns",
      };
    },
  },
  {
    name: "get_email_campaign",
    description: "Obter o detalhe editável de uma campanha de email da organização atual.",
    module: "marketing",
    permission: { ...CAMPAIGN_PERMISSION, action: "view" },
    parameters: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"] },
    execute: async (args, ctx) => {
      const id = campaignId(args);
      if (!id) return resultError("Indica um ID de campanha válido.", "invalid_campaign_id");
      const campaign = await campaignForOrg(ctx, id);
      if (campaign.error) return resultError("Não foi possível ler a campanha.");
      if (!campaign.data) return resultError("Campanha não encontrada nesta organização.", "campaign_not_found");
      const templates = await templateSummaries(ctx, campaign.data.template_id ? [campaign.data.template_id] : []);
      return { campaign: campaign.data, template: campaign.data.template_id ? templates.get(campaign.data.template_id) ?? null : null, destination: "/marketing/campaigns" };
    },
  },
  {
    name: "get_email_campaign_results",
    description: "Consultar resultados nativos de envio de uma campanha, sem expor credenciais nem o HTML da mensagem.",
    module: "marketing",
    permission: { ...CAMPAIGN_PERMISSION, action: "view" },
    parameters: { type: "object", properties: { campaign_id: { type: "string" }, limit: { type: "integer" } }, required: ["campaign_id"] },
    execute: async (args, ctx) => {
      const id = campaignId(args);
      if (!id) return resultError("Indica um ID de campanha válido.", "invalid_campaign_id");
      const campaign = await campaignForOrg(ctx, id);
      if (campaign.error) return resultError("Não foi possível ler a campanha.");
      if (!campaign.data) return resultError("Campanha não encontrada nesta organização.", "campaign_not_found");
      const requestedLimit = typeof args.limit === "number" && Number.isInteger(args.limit) ? args.limit : 100;
      const limit = Math.max(1, Math.min(500, requestedLimit));
      const { data, error } = await ctx.supabaseAdmin
        .from("email_sends")
        .select(SEND_RESULT_COLUMNS)
        .eq("organization_id", ctx.orgId)
        .eq("campaign_id", id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return resultError("Não foi possível ler os resultados da campanha.");
      const rows = data ?? [];
      const counts = rows.reduce<Record<string, number>>((result, row) => {
        if (typeof row.status === "string") result[row.status] = (result[row.status] ?? 0) + 1;
        return result;
      }, {});
      return { campaign_id: id, campaign_status: campaign.data.status, results: rows, result_count: rows.length, status_counts: counts, destination: "/marketing/campaigns" };
    },
  },
];
