import type { Tool } from "../types.ts";
import { resultError, stringArg } from "./marketing-shared.ts";

export const marketingContactCreate: Tool = {
  name: "create_marketing_contact",
  description: "Criar um contacto de marketing na organização atual. Só indicar subscribed=true se o utilizador confirmar o consentimento.",
  module: "marketing",
  permission: { module: "marketing", subarea: "lists", action: "create" },
  isWrite: true,
  confirmation: { kind: "immediate" },
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" }, email: { type: "string" }, phone: { type: "string" },
      company: { type: "string" }, subscribed: { type: "boolean" },
    },
    required: ["name"],
  },
  execute: async (args, ctx) => {
    const name = stringArg(args, "name");
    if (!name) return resultError("Indica o nome do contacto.", "contact_name_missing");
    const { data, error } = await ctx.supabaseAdmin.from("marketing_contacts").insert({
      organization_id: ctx.orgId,
      name,
      email: stringArg(args, "email"),
      phone: stringArg(args, "phone"),
      company: stringArg(args, "company"),
      source: "otto",
      subscribed: args.subscribed === true,
    }).select("id, name, email, subscribed").single();
    if (error) return resultError("Não foi possível criar o contacto de marketing.");
    return { success: true, contact: data, destination: "/marketing/lists" };
  },
};
