import type { Tool, ToolContext, ToolResult } from "../types.ts";
import {
  settingsMembershipSchema,
  settingsOrgProfileSchema,
  settingsPortalError,
  settingsPortalInvalidArguments,
  settingsProfileSchema,
  settingsTeamMemberArgsSchema,
  settingsTeamMemberSchema,
  settingsTeamSchema,
} from "./settings-portal-shared.ts";

async function getTeamMemberDetails(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = settingsTeamMemberArgsSchema.safeParse(args);
  if (!input.success) return settingsPortalInvalidArguments();
  if (ctx.dataScope !== "all" && !ctx.scopeUserIds.has(input.data.user_id)) {
    return settingsPortalError(
      "Membro não encontrado ou sem acesso.",
      "team_member_not_found",
    );
  }

  const membershipResult = await ctx.supabaseAdmin
    .from("organization_members")
    .select("user_id,role,is_active,joined_at,profile_id")
    .eq("organization_id", ctx.orgId)
    .eq("user_id", input.data.user_id)
    .maybeSingle();
  if (membershipResult.error) {
    return settingsPortalError(
      "Não foi possível consultar o membro.",
      "team_member_lookup_failed",
    );
  }
  const membership = settingsMembershipSchema.safeParse(membershipResult.data);
  if (!membership.success) {
    return settingsPortalError(
      "Membro não encontrado.",
      "team_member_not_found",
    );
  }

  const [profileResult, teamsResult, teamLinksResult] = await Promise.all([
    ctx.supabaseAdmin
      .from("profiles")
      .select("id,full_name,email,phone")
      .eq("id", membership.data.user_id)
      .maybeSingle(),
    ctx.supabaseAdmin
      .from("teams")
      .select("id,name,leader_id")
      .eq("organization_id", ctx.orgId),
    ctx.supabaseAdmin
      .from("team_members")
      .select("team_id,user_id")
      .eq("user_id", membership.data.user_id),
  ]);
  if (profileResult.error || teamsResult.error || teamLinksResult.error) {
    return settingsPortalError(
      "Não foi possível consultar os detalhes da equipa.",
      "team_details_unavailable",
    );
  }

  const profile = settingsProfileSchema.safeParse(profileResult.data);
  const teams = settingsTeamSchema.array().safeParse(teamsResult.data ?? []);
  const links = settingsTeamMemberSchema.array().safeParse(
    teamLinksResult.data ?? [],
  );
  if (!teams.success || !links.success) {
    return settingsPortalError(
      "A resposta da equipa não pôde ser validada.",
      "invalid_team_response",
    );
  }
  const linkedTeamIds = new Set(links.data.map(({ team_id }) => team_id));
  const memberTeams = teams.data
    .filter((team) =>
      team.leader_id === membership.data.user_id || linkedTeamIds.has(team.id)
    )
    .map((team) => ({
      id: team.id,
      name: team.name,
      is_leader: team.leader_id === membership.data.user_id,
    }));

  let profileName: string | null = null;
  if (membership.data.profile_id) {
    const orgProfileResult = await ctx.supabaseAdmin
      .from("organization_profiles")
      .select("id,name")
      .eq("organization_id", ctx.orgId)
      .eq("id", membership.data.profile_id)
      .maybeSingle();
    if (orgProfileResult.error) {
      return settingsPortalError(
        "Não foi possível consultar o perfil atribuído.",
        "profile_lookup_failed",
      );
    }
    const orgProfile = settingsOrgProfileSchema.safeParse(
      orgProfileResult.data,
    );
    profileName = orgProfile.success ? orgProfile.data.name : null;
  }

  return {
    member: {
      user_id: membership.data.user_id,
      full_name: profile.success ? profile.data.full_name : null,
      email: profile.success ? profile.data.email : null,
      phone: profile.success ? profile.data.phone : null,
      role: membership.data.role,
      is_active: membership.data.is_active,
      joined_at: membership.data.joined_at,
      profile_name: profileName,
      teams: memberTeams,
    },
    resource: {
      type: "organization_member",
      id: membership.data.user_id,
      route: "/settings",
    },
  };
}

export const settingsTeamReadTools = [
  {
    name: "get_team_member_details",
    module: "settings",
    description:
      "Consultar detalhes seguros e apenas de leitura de um membro da organização, incluindo perfil atribuído e equipas. Não devolve permissões granulares nem credenciais.",
    parameters: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          format: "uuid",
          description: "ID do utilizador membro",
        },
      },
      required: ["user_id"],
      additionalProperties: false,
    },
    permission: { module: "settings", subarea: "team", action: "view" },
    execute: getTeamMemberDetails,
  },
] satisfies readonly Tool[];
