import type { ToolContext, ToolResult } from "../types.ts";
import { filterAccessibleRecords } from "../record-scope.ts";
import {
  hasPortalTotalLinkAccess,
  portalClientSchema,
  portalContractArgsSchema,
  type PortalSale,
  portalSaleItemSchema,
  portalSaleSchema,
  portalSearchArgsSchema,
  settingsPortalError,
  settingsPortalInvalidArguments,
  settingsPortalNormalize,
} from "./settings-portal-shared.ts";

async function portalClients(
  ctx: ToolContext,
  clientIds: readonly string[],
): Promise<
  ReadonlyMap<
    string,
    Readonly<
      { id: string; code: string | null; name: string; nif: string | null }
    >
  > | ToolResult
> {
  const uniqueIds = [...new Set(clientIds)];
  if (uniqueIds.length === 0) return new Map();
  const { data, error } = await ctx.supabaseAdmin
    .from("crm_clients")
    .select("id,code,name,nif")
    .eq("organization_id", ctx.orgId)
    .in("id", uniqueIds);
  if (error) {
    return settingsPortalError(
      "Não foi possível consultar os clientes dos contratos.",
      "portal_clients_unavailable",
    );
  }
  const parsed = portalClientSchema.array().safeParse(data ?? []);
  return parsed.success
    ? new Map(parsed.data.map((client) => [client.id, client]))
    : settingsPortalError(
      "A resposta de clientes não pôde ser validada.",
      "invalid_portal_client_response",
    );
}

function contractResult(sale: PortalSale, clientName: string | null) {
  return {
    id: sale.id,
    code: sale.code,
    client_name: clientName,
    status: sale.status,
    telecom_status: sale.telecom_status,
    sale_date: sale.sale_date,
    activation_date: sale.activation_date,
    scheduled_install_date: sale.scheduled_install_date,
    fidelizacao_end: sale.fidelizacao_end,
    edp_proposal_number: sale.edp_proposal_number,
    proposal_type: sale.proposal_type,
    negotiation_type: sale.negotiation_type,
    consumo_anual: sale.consumo_anual,
    anos_contrato: sale.anos_contrato,
    total_value: sale.total_value,
    operational_units: sale.operational_units,
    total_cartoes: sale.total_cartoes,
    seller_id: sale.seller_id,
    route: "/sales",
    portal_section: "/portal-total-link/contratos",
  };
}

export async function searchPortalContracts(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = portalSearchArgsSchema.safeParse(args);
  if (
    !input.success ||
    (input.data.start_date && input.data.end_date &&
      input.data.start_date > input.data.end_date)
  ) {
    return settingsPortalInvalidArguments();
  }
  if (!hasPortalTotalLinkAccess(ctx)) {
    return settingsPortalError(
      "O Portal Total Link não está disponível para esta organização.",
      "portal_total_link_unavailable",
    );
  }
  const maxResults = input.data.max_results ?? 20;
  let query = ctx.supabaseAdmin
    .from("sales")
    .select(
      "id,code,status,telecom_status,sale_date,activation_date,scheduled_install_date,fidelizacao_end,edp_proposal_number,proposal_type,negotiation_type,consumo_anual,anos_contrato,total_value,comissao,operational_units,total_cartoes,client_id,lead_id,seller_id,created_by,created_at,updated_at",
    )
    .eq("organization_id", ctx.orgId)
    .order("sale_date", { ascending: false })
    .limit(maxResults * 5);
  if (input.data.status) query = query.eq("telecom_status", input.data.status);
  if (input.data.start_date) {
    query = query.gte("sale_date", input.data.start_date);
  }
  if (input.data.end_date) query = query.lte("sale_date", input.data.end_date);

  const { data, error } = await query;
  if (error) {
    return settingsPortalError(
      "Não foi possível consultar os contratos.",
      "portal_contract_search_failed",
    );
  }
  const parsed = portalSaleSchema.array().safeParse(data ?? []);
  if (!parsed.success) {
    return settingsPortalError(
      "A resposta de contratos não pôde ser validada.",
      "invalid_portal_contract_response",
    );
  }
  const scoped = filterAccessibleRecords(ctx, parsed.data);
  const clients = await portalClients(
    ctx,
    scoped.flatMap(({ client_id }) => client_id ? [client_id] : []),
  );
  if (!(clients instanceof Map)) return clients;

  const normalizedQuery = input.data.query
    ? settingsPortalNormalize(input.data.query)
    : "";
  const visible = scoped.filter((sale) => {
    if (!normalizedQuery) return true;
    const client = sale.client_id ? clients.get(sale.client_id) : null;
    return settingsPortalNormalize(
      [
        sale.code,
        sale.edp_proposal_number,
        client?.name,
        client?.code,
        client?.nif,
      ].filter((value): value is string => typeof value === "string").join(" "),
    ).includes(normalizedQuery);
  }).slice(0, maxResults);

  return {
    results: visible.map((sale) =>
      contractResult(
        sale,
        sale.client_id ? clients.get(sale.client_id)?.name ?? null : null,
      )
    ),
    count: visible.length,
    source: "senvia_sales",
  };
}

export async function getPortalContractDetails(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = portalContractArgsSchema.safeParse(args);
  if (!input.success) return settingsPortalInvalidArguments();
  if (!hasPortalTotalLinkAccess(ctx)) {
    return settingsPortalError(
      "O Portal Total Link não está disponível para esta organização.",
      "portal_total_link_unavailable",
    );
  }
  const { data, error } = await ctx.supabaseAdmin
    .from("sales")
    .select(
      "id,code,status,telecom_status,sale_date,activation_date,scheduled_install_date,fidelizacao_end,edp_proposal_number,proposal_type,negotiation_type,consumo_anual,anos_contrato,total_value,comissao,operational_units,total_cartoes,client_id,lead_id,seller_id,created_by,created_at,updated_at",
    )
    .eq("organization_id", ctx.orgId)
    .eq("id", input.data.sale_id)
    .maybeSingle();
  if (error) {
    return settingsPortalError(
      "Não foi possível consultar o contrato.",
      "portal_contract_lookup_failed",
    );
  }
  const sale = portalSaleSchema.safeParse(data);
  if (!sale.success || filterAccessibleRecords(ctx, [sale.data]).length === 0) {
    return settingsPortalError(
      "Contrato não encontrado ou sem acesso.",
      "portal_contract_not_found",
    );
  }

  const clients = await portalClients(
    ctx,
    sale.data.client_id ? [sale.data.client_id] : [],
  );
  if (!(clients instanceof Map)) return clients;
  const itemsResult = await ctx.supabaseAdmin
    .from("sale_items")
    .select("id,name,quantity,unit_price,total")
    .eq("sale_id", sale.data.id)
    .order("created_at", { ascending: true });
  if (itemsResult.error) {
    return settingsPortalError(
      "Não foi possível consultar os itens do contrato.",
      "portal_contract_items_unavailable",
    );
  }
  const items = portalSaleItemSchema.array().safeParse(itemsResult.data ?? []);
  if (!items.success) {
    return settingsPortalError(
      "A resposta de itens não pôde ser validada.",
      "invalid_portal_contract_items",
    );
  }
  const client = sale.data.client_id
    ? clients.get(sale.data.client_id) ?? null
    : null;

  return {
    contract: {
      ...contractResult(sale.data, client?.name ?? null),
      client_code: client?.code ?? null,
      client_nif: client?.nif ?? null,
      items: items.data,
      created_at: sale.data.created_at,
      updated_at: sale.data.updated_at,
    },
    resource: { type: "sale", id: sale.data.id, route: "/sales" },
    source: "senvia_sales",
  };
}
