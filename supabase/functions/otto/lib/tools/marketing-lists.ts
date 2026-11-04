import type { Tool, ToolContext } from "../types.ts";
import {
  UUID_RE,
  asContact,
  audienceDigest,
  confirmationPreview,
  isRecord,
  resultError,
  stringArg,
  stringArrayArg,
} from "./marketing-shared.ts";

const LIST_COLUMNS = "id, organization_id, name, description, filter_criteria, is_dynamic, is_system, created_by, created_at, updated_at";
const LIST_PERMISSION = { module: "marketing" as const, subarea: "lists" as const };

function listId(args: Readonly<Record<string, unknown>>): string | null {
  const id = stringArg(args, "list_id");
  return id && UUID_RE.test(id) ? id : null;
}

async function listForOrg(ctx: ToolContext, id: string) {
  return ctx.supabaseAdmin
    .from("client_lists")
    .select(LIST_COLUMNS)
    .eq("organization_id", ctx.orgId)
    .eq("id", id)
    .maybeSingle();
}

async function memberCountMap(ctx: ToolContext, listIds: readonly string[]): Promise<Map<string, number> | null> {
  if (listIds.length === 0) return new Map();
  const { data, error } = await ctx.supabaseAdmin
    .from("marketing_list_members")
    .select("list_id")
    .in("list_id", listIds);
  if (error) return null;
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    if (typeof row.list_id === "string") counts.set(row.list_id, (counts.get(row.list_id) ?? 0) + 1);
  }
  return counts;
}

export const marketingListTools: Tool[] = [
  {
    name: "list_marketing_contacts",
    description: "Pesquisar contactos de marketing da organização atual para construir ou rever uma audiência.",
    module: "marketing",
    permission: { ...LIST_PERMISSION, action: "view" },
    parameters: { type: "object", properties: { query: { type: "string" }, subscribed_only: { type: "boolean" } }, required: [] },
    execute: async (args, ctx) => {
      const query = stringArg(args, "query")?.replace(/[(),*%"\\]/g, "") ?? "";
      let request = ctx.supabaseAdmin
        .from("marketing_contacts")
        .select("id, organization_id, name, email, phone, company, source, tags, subscribed, converted_to_lead, created_at, updated_at")
        .eq("organization_id", ctx.orgId)
        .order("name", { ascending: true })
        .limit(100);
      if (query) request = request.or(`name.ilike.%${query}%,email.ilike.%${query}%,company.ilike.%${query}%`);
      if (args.subscribed_only !== false) request = request.eq("subscribed", true);
      const { data, error } = await request;
      if (error) return resultError("Não foi possível pesquisar os contactos de marketing.");
      return { results: data ?? [], count: (data ?? []).length, destination: "/marketing/lists" };
    },
  },
  {
    name: "list_marketing_lists",
    description: "Listar as listas de marketing da organização atual com contagem de membros.",
    module: "marketing",
    permission: { ...LIST_PERMISSION, action: "view" },
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const { data, error } = await ctx.supabaseAdmin
        .from("client_lists")
        .select(LIST_COLUMNS)
        .eq("organization_id", ctx.orgId)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) return resultError("Não foi possível listar as listas de marketing.");
      const rows = data ?? [];
      const counts = await memberCountMap(ctx, rows.map((row) => row.id));
      if (!counts) return resultError("Não foi possível contar os membros das listas.");
      return { results: rows.map((row) => ({ ...row, member_count: counts.get(row.id) ?? 0 })), count: rows.length, destination: "/marketing/lists" };
    },
  },
  {
    name: "get_marketing_list",
    description: "Obter uma lista de marketing e os seus membros nativos da organização atual.",
    module: "marketing",
    permission: { ...LIST_PERMISSION, action: "view" },
    parameters: { type: "object", properties: { list_id: { type: "string" } }, required: ["list_id"] },
    execute: async (args, ctx) => {
      const id = listId(args);
      if (!id) return resultError("Indica um ID de lista válido.", "invalid_list_id");
      const list = await listForOrg(ctx, id);
      if (list.error) return resultError("Não foi possível ler a lista.");
      if (!list.data) return resultError("Lista não encontrada nesta organização.", "list_not_found");
      const { data: members, error: memberError } = await ctx.supabaseAdmin
        .from("marketing_list_members")
        .select("id, list_id, contact_id, added_at, contact:marketing_contacts(id, organization_id, name, email, phone, company, subscribed)")
        .eq("list_id", id)
        .order("added_at", { ascending: false })
        .limit(500);
      if (memberError) return resultError("Não foi possível ler os membros da lista.");
      const contacts = (members ?? []).map((row) => asContact(row.contact)).filter((contact): contact is NonNullable<typeof contact> => Boolean(contact && contact.organization_id === ctx.orgId));
      return { list: list.data, members: members ?? [], member_count: contacts.length, audience_digest: await audienceDigest(contacts), destination: "/marketing/lists" };
    },
  },
  {
    name: "create_marketing_list",
    description: "Criar uma lista de marketing editável na organização atual.",
    module: "marketing",
    permission: { ...LIST_PERMISSION, action: "create" },
    isWrite: true,
    confirmation: confirmationPreview("Criar lista de marketing", "Criar uma nova lista de marketing editável na organização atual.", "/marketing/lists"),
    parameters: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, filter_criteria: { type: "object" }, is_dynamic: { type: "boolean" } }, required: ["name"] },
    execute: async (args, ctx) => {
      const name = stringArg(args, "name");
      if (!name) return resultError("O nome da lista é obrigatório.", "list_fields_missing");
      const payload: Record<string, unknown> = { organization_id: ctx.orgId, name, created_by: ctx.userId };
      const description = stringArg(args, "description");
      if (description) payload.description = description;
      if (isRecord(args.filter_criteria)) payload.filter_criteria = args.filter_criteria;
      if (typeof args.is_dynamic === "boolean") payload.is_dynamic = args.is_dynamic;
      const { data, error } = await ctx.supabaseAdmin.from("client_lists").insert(payload).select(LIST_COLUMNS).single();
      if (error) return resultError("Não foi possível criar a lista de marketing.");
      return { success: true, list: data, member_count: 0, destination: "/marketing/lists" };
    },
  },
  {
    name: "update_marketing_list",
    description: "Editar uma lista de marketing da organização atual; não altera contactos sem uma operação explícita de membros.",
    module: "marketing",
    permission: { ...LIST_PERMISSION, action: "edit" },
    isWrite: true,
    confirmation: confirmationPreview("Editar lista de marketing", "Guardar as alterações na lista de marketing selecionada.", "/marketing/lists"),
    parameters: { type: "object", properties: { list_id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, filter_criteria: { type: "object" }, is_dynamic: { type: "boolean" } }, required: ["list_id"] },
    execute: async (args, ctx) => {
      const id = listId(args);
      if (!id) return resultError("Indica um ID de lista válido.", "invalid_list_id");
      const current = await listForOrg(ctx, id);
      if (current.error) return resultError("Não foi possível ler a lista.");
      if (!current.data) return resultError("Lista não encontrada nesta organização.", "list_not_found");
      if (current.data.is_system === true) return resultError("As listas de sistema não podem ser editadas.", "system_list");
      const update: Record<string, unknown> = {};
      if (stringArg(args, "name")) update.name = stringArg(args, "name");
      if (args.description !== undefined) update.description = stringArg(args, "description");
      if (isRecord(args.filter_criteria)) update.filter_criteria = args.filter_criteria;
      if (typeof args.is_dynamic === "boolean") update.is_dynamic = args.is_dynamic;
      if (Object.keys(update).length === 0) return resultError("Indica pelo menos um campo para alterar.", "list_fields_missing");
      const { data, error } = await ctx.supabaseAdmin.from("client_lists").update(update).eq("organization_id", ctx.orgId).eq("id", id).select(LIST_COLUMNS).single();
      if (error) return resultError("Não foi possível atualizar a lista de marketing.");
      return { success: true, list: data, destination: "/marketing/lists" };
    },
  },
  {
    name: "delete_marketing_list",
    description: "Eliminar uma lista de marketing da organização atual, incluindo as associações nativas de membros.",
    module: "marketing",
    permission: { ...LIST_PERMISSION, action: "delete" },
    isWrite: true,
    confirmation: confirmationPreview("Eliminar lista de marketing", "Eliminar a lista selecionada e as suas associações de membros.", "/marketing/lists"),
    parameters: { type: "object", properties: { list_id: { type: "string" } }, required: ["list_id"] },
    execute: async (args, ctx) => {
      const id = listId(args);
      if (!id) return resultError("Indica um ID de lista válido.", "invalid_list_id");
      const current = await listForOrg(ctx, id);
      if (current.error) return resultError("Não foi possível ler a lista.");
      if (!current.data) return resultError("Lista não encontrada nesta organização.", "list_not_found");
      if (current.data.is_system === true) return resultError("As listas de sistema não podem ser eliminadas.", "system_list");
      const { error } = await ctx.supabaseAdmin.from("client_lists").delete().eq("organization_id", ctx.orgId).eq("id", id);
      if (error) return resultError("Não foi possível eliminar a lista de marketing.");
      return { success: true, deleted_list_id: id, destination: "/marketing/lists" };
    },
  },
  {
    name: "add_contacts_to_marketing_list",
    description: "Adicionar contactos existentes da organização atual a uma lista de marketing nativa.",
    module: "marketing",
    permission: { ...LIST_PERMISSION, action: "edit" },
    isWrite: true,
    confirmation: confirmationPreview("Adicionar contactos à lista", "Adicionar os contactos selecionados à lista de marketing.", "/marketing/lists"),
    parameters: { type: "object", properties: { list_id: { type: "string" }, contact_ids: { type: "array", items: { type: "string" } } }, required: ["list_id", "contact_ids"] },
    execute: async (args, ctx) => {
      const id = listId(args);
      const contactIds = stringArrayArg(args, "contact_ids");
      if (!id || contactIds.length === 0) return resultError("Indica uma lista e pelo menos um contacto válido.", "list_members_missing");
      const current = await listForOrg(ctx, id);
      if (current.error) return resultError("Não foi possível ler a lista.");
      if (!current.data) return resultError("Lista não encontrada nesta organização.", "list_not_found");
      const { data: contacts, error: contactError } = await ctx.supabaseAdmin.from("marketing_contacts").select("id").eq("organization_id", ctx.orgId).in("id", contactIds).limit(500);
      if (contactError || (contacts ?? []).length !== contactIds.length) return resultError("Um ou mais contactos não pertencem à organização atual.", "contact_scope_mismatch");
      const { error } = await ctx.supabaseAdmin.from("marketing_list_members").upsert(contactIds.map((contact_id) => ({ list_id: id, contact_id })), { onConflict: "list_id,contact_id", ignoreDuplicates: true });
      if (error) return resultError("Não foi possível adicionar os contactos à lista.");
      return { success: true, list_id: id, added_count: contactIds.length, destination: "/marketing/lists" };
    },
  },
  {
    name: "remove_contacts_from_marketing_list",
    description: "Remover contactos de uma lista de marketing nativa da organização atual.",
    module: "marketing",
    permission: { ...LIST_PERMISSION, action: "edit" },
    isWrite: true,
    confirmation: confirmationPreview("Remover contactos da lista", "Remover os contactos selecionados da lista de marketing.", "/marketing/lists"),
    parameters: { type: "object", properties: { list_id: { type: "string" }, contact_ids: { type: "array", items: { type: "string" } } }, required: ["list_id", "contact_ids"] },
    execute: async (args, ctx) => {
      const id = listId(args);
      const contactIds = stringArrayArg(args, "contact_ids");
      if (!id || contactIds.length === 0) return resultError("Indica uma lista e pelo menos um contacto válido.", "list_members_missing");
      const current = await listForOrg(ctx, id);
      if (current.error) return resultError("Não foi possível ler a lista.");
      if (!current.data) return resultError("Lista não encontrada nesta organização.", "list_not_found");
      const { error } = await ctx.supabaseAdmin.from("marketing_list_members").delete().eq("list_id", id).in("contact_id", contactIds);
      if (error) return resultError("Não foi possível remover os contactos da lista.");
      return { success: true, list_id: id, removed_count: contactIds.length, destination: "/marketing/lists" };
    },
  },
];
