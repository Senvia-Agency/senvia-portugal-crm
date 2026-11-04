import { z } from "https://esm.sh/zod@3.25.76";
import type { ToolContext, ToolResult } from "../types.ts";

export const PORTAL_TOTAL_LINK_ORG_ID = "96a3950e-31be-4c6d-abed-b82968c0d7e9";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const settingsTeamMemberArgsSchema = z.object({ user_id: uuid })
  .strict();
export const portalContractArgsSchema = z.object({ sale_id: uuid }).strict();
export const portalSearchArgsSchema = z.object({
  query: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  max_results: z.number().int().min(1).max(20).optional(),
}).strict();

export const settingsMembershipSchema = z.object({
  user_id: uuid,
  role: z.string(),
  is_active: z.boolean(),
  joined_at: z.string().nullable(),
  profile_id: uuid.nullable(),
});

export const settingsProfileSchema = z.object({
  id: uuid,
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});

export const settingsOrgProfileSchema = z.object({
  id: uuid,
  name: z.string(),
});
export const settingsTeamSchema = z.object({
  id: uuid,
  name: z.string(),
  leader_id: uuid,
});
export const settingsTeamMemberSchema = z.object({
  team_id: uuid,
  user_id: uuid,
});

export const portalSaleSchema = z.object({
  id: uuid,
  code: z.string().nullable(),
  status: z.string(),
  telecom_status: z.string().nullable(),
  sale_date: isoDate.nullable(),
  activation_date: z.string().nullable(),
  scheduled_install_date: z.string().nullable(),
  fidelizacao_end: z.string().nullable(),
  edp_proposal_number: z.string().nullable(),
  proposal_type: z.string().nullable(),
  negotiation_type: z.string().nullable(),
  consumo_anual: z.coerce.number().nullable(),
  anos_contrato: z.coerce.number().int().nullable(),
  total_value: z.coerce.number(),
  comissao: z.coerce.number().nullable(),
  operational_units: z.coerce.number().nullable(),
  total_cartoes: z.coerce.number().nullable(),
  client_id: uuid.nullable(),
  lead_id: uuid.nullable(),
  seller_id: uuid.nullable(),
  created_by: uuid.nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

export const portalClientSchema = z.object({
  id: uuid,
  code: z.string().nullable(),
  name: z.string(),
  nif: z.string().nullable(),
});

export const portalSaleItemSchema = z.object({
  id: uuid,
  name: z.string(),
  quantity: z.coerce.number(),
  unit_price: z.coerce.number(),
  total: z.coerce.number(),
});

export type PortalSale = Readonly<z.infer<typeof portalSaleSchema>>;

export function settingsPortalError(
  error: string,
  reasonCode: string,
): ToolResult {
  return {
    error,
    reason_code: reasonCode,
    _instruction:
      "A consulta não foi concluída. Informa o utilizador sem inventar dados.",
  };
}

export function settingsPortalInvalidArguments(): ToolResult {
  return settingsPortalError(
    "Argumentos inválidos",
    "invalid_settings_portal_arguments",
  );
}

export function settingsPortalNormalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .trim();
}

export function hasPortalTotalLinkAccess(ctx: ToolContext): boolean {
  return ctx.orgId === PORTAL_TOTAL_LINK_ORG_ID;
}
