import { z } from "https://esm.sh/zod@3.25.76";

export const nativeEntitySchema = z.enum(["clients", "leads", "proposals"]);
export type NativeWorkflowEntity = z.infer<typeof nativeEntitySchema>;
const idSchema = z.string().uuid();
const nullableText = z.string().nullable();
const identity = z.object({ id: idSchema, organization_id: idSchema });
const contact = identity.extend({ name: z.string(), email: nullableText, phone: nullableText, assigned_to: idSchema.nullable() });
const common = contact.extend({ status: nullableText, source: nullableText, created_at: nullableText, updated_at: nullableText });
const proposal = identity.extend({
  status: z.string(), total_value: z.number().finite(), proposal_date: nullableText,
  created_at: nullableText, updated_at: nullableText, created_by: idSchema.nullable(),
  client_id: idSchema.nullable(), lead_id: idSchema.nullable(),
  client: contact.nullable(), lead: contact.nullable(),
});

export const ENTITY_SELECTS = {
  clients: "id,organization_id,name,email,phone,status,source,assigned_to,created_at,updated_at",
  leads: "id,organization_id,name,email,phone,status,source,assigned_to,created_at,updated_at,archived_at,automation_enabled",
  proposals: "id,organization_id,status,total_value,proposal_date,created_at,updated_at,created_by,client_id,lead_id,client:crm_clients(id,organization_id,name,email,phone,assigned_to),lead:leads(id,organization_id,name,email,phone,assigned_to)",
} as const;
export const ENTITY_TABLES = { clients: "crm_clients", leads: "leads", proposals: "proposals" } as const;

export type EntityRecord = {
  readonly entity: NativeWorkflowEntity;
  readonly id: string;
  readonly organizationId: string;
  readonly ownerIds: readonly string[];
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
  readonly contact?: { readonly clientId?: string; readonly name: string; readonly email: string | null; readonly phone: string | null };
};

export function parseEntityRecord(entity: NativeWorkflowEntity, input: unknown): EntityRecord | null {
  switch (entity) {
    case "clients": {
      const row = common.parse(input);
      return { entity, id: row.id, organizationId: row.organization_id,
        ownerIds: row.assigned_to ? [row.assigned_to] : [], fields: row,
        contact: { clientId: row.id, name: row.name, email: row.email, phone: row.phone } };
    }
    case "leads": {
      const row = common.extend({ archived_at: nullableText, automation_enabled: z.boolean() }).parse(input);
      if (row.archived_at !== null || !row.automation_enabled) return null;
      return { entity, id: row.id, organizationId: row.organization_id,
        ownerIds: row.assigned_to ? [row.assigned_to] : [], fields: row,
        contact: { name: row.name, email: row.email, phone: row.phone } };
    }
    case "proposals": {
      const row = proposal.parse(input);
      const client = row.client?.organization_id === row.organization_id && row.client.id === row.client_id ? row.client : null;
      const lead = row.lead?.organization_id === row.organization_id && row.lead.id === row.lead_id ? row.lead : null;
      const recipient = client ?? lead;
      const { client: ignoredClient, lead: ignoredLead, ...fields } = row;
      return { entity, id: row.id, organizationId: row.organization_id,
        ownerIds: [row.created_by, lead?.assigned_to].filter((value): value is string => typeof value === "string"), fields,
        ...(recipient ? { contact: { ...(client ? { clientId: client.id } : {}), name: recipient.name, email: recipient.email, phone: recipient.phone } } : {}) };
    }
  }
}
