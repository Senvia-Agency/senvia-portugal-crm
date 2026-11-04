import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

import {
  enabledOttoModules,
  isOttoModuleKey,
  OTTO_MODULE_BY_PERMISSION,
} from "./modules.ts";
import type {
  DataScope,
  ModulePermissions,
  Tool,
  ToolContext,
} from "./types.ts";
import type { OttoModuleKey } from "./modules.ts";

export type AuthorizationSnapshot = {
  readonly isAdmin: boolean;
  readonly permissions: ModulePermissions | null;
  readonly writeGrants: ReadonlySet<OttoModuleKey>;
  readonly enabledModules: ReadonlySet<OttoModuleKey>;
  readonly dataScope: DataScope;
  readonly scopeUserIds: ReadonlySet<string>;
};

export type AuthorizationLoadResult =
  | { readonly ok: true; readonly snapshot: AuthorizationSnapshot }
  | { readonly ok: false; readonly reason: string };

export type ToolAuthorizationResult =
  | { readonly ok: true; readonly ctx: ToolContext }
  | { readonly ok: false; readonly reason: string };

type ToolAuthorizationContext = Pick<
  ToolContext,
  "isAdmin" | "permissions" | "writeGrants" | "enabledModules"
>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDataScope(value: unknown): DataScope {
  return value === "team" || value === "all" ? value : "own";
}

function hasPermission(
  permissions: ModulePermissions | null,
  tool: Tool,
): boolean {
  if (!tool.permission || !permissions) return tool.permission === undefined;
  const moduleValue = permissions[tool.permission.module];
  if (!isRecord(moduleValue)) return false;
  const subareas = moduleValue.subareas;
  if (!isRecord(subareas)) return false;
  const subarea = subareas[tool.permission.subarea];
  return isRecord(subarea) && subarea[tool.permission.action] === true;
}

export function canUseTool(tool: Tool, auth: ToolAuthorizationContext): boolean {
  if (!auth.enabledModules.has(tool.module)) return false;
  if (
    tool.permission
    && OTTO_MODULE_BY_PERMISSION[tool.permission.module] !== tool.module
  ) return false;
  if (tool.isWrite && !auth.writeGrants.has(tool.module)) return false;
  if (tool.adminOnly && !auth.isAdmin) return false;
  if (auth.isAdmin) return true;
  return hasPermission(auth.permissions, tool);
}

export async function loadAuthorizationSnapshot(
  admin: SupabaseClient,
  userId: string,
  orgId: string,
): Promise<AuthorizationLoadResult> {
  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("profile_id, role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (membershipError || !membership) {
    return { ok: false, reason: "membership_unavailable" };
  }

  const [superRoleResult, adminRoleResult, organizationResult, grantsResult] = await Promise.all([
    admin
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "super_admin")
      .maybeSingle(),
    admin.rpc("is_org_admin", { _user_id: userId, _org_id: orgId }),
    admin
      .from("organizations")
      .select("enabled_modules")
      .eq("id", orgId)
      .maybeSingle(),
    admin
      .from("otto_write_grants")
      .select("module_key")
      .eq("organization_id", orgId)
      .eq("is_granted", true),
  ]);

  if (
    superRoleResult.error
    || adminRoleResult.error
    || organizationResult.error
    || !organizationResult.data
    || grantsResult.error
  ) return { ok: false, reason: "authorization_unavailable" };

  const isAdmin = Boolean(superRoleResult.data) || adminRoleResult.data === true;
  let permissions: ModulePermissions | null = null;
  let dataScope: DataScope = isAdmin ? "all" : "own";

  if (!isAdmin && typeof membership.profile_id === "string") {
    const { data: profile, error: profileError } = await admin
      .from("organization_profiles")
      .select("module_permissions, data_scope")
      .eq("id", membership.profile_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (profileError || !profile) {
      return { ok: false, reason: "profile_unavailable" };
    }
    permissions = isRecord(profile.module_permissions)
      ? profile.module_permissions
      : null;
    dataScope = parseDataScope(profile.data_scope);
  }

  const scopeUserIds = new Set<string>([userId]);
  if (dataScope === "team") {
    const { data: teams, error: teamsError } = await admin
      .from("teams")
      .select("id")
      .eq("organization_id", orgId)
      .eq("leader_id", userId);
    if (teamsError) return { ok: false, reason: "team_scope_unavailable" };
    const teamIds = (teams ?? [])
      .map(({ id }) => id)
      .filter((id): id is string => typeof id === "string");
    if (teamIds.length > 0) {
      const { data: teamMembers, error: teamMembersError } = await admin
        .from("team_members")
        .select("team_id, user_id")
        .in("team_id", teamIds);
      if (teamMembersError) return { ok: false, reason: "team_scope_unavailable" };
      for (const member of teamMembers ?? []) {
        if (typeof member.user_id === "string") scopeUserIds.add(member.user_id);
      }
    }
  }

  const writeGrants = new Set<OttoModuleKey>();
  for (const row of grantsResult.data ?? []) {
    if (isOttoModuleKey(row.module_key)) writeGrants.add(row.module_key);
  }

  return {
    ok: true,
    snapshot: {
      isAdmin,
      permissions,
      writeGrants,
      enabledModules: enabledOttoModules(organizationResult.data.enabled_modules),
      dataScope,
      scopeUserIds,
    },
  };
}

export function withAuthorizationSnapshot(
  ctx: ToolContext,
  snapshot: AuthorizationSnapshot,
): ToolContext {
  return { ...ctx, ...snapshot };
}

export async function refreshToolAuthorization(
  ctx: ToolContext,
  tool: Tool,
): Promise<ToolAuthorizationResult> {
  const loaded = await loadAuthorizationSnapshot(
    ctx.supabaseAdmin,
    ctx.userId,
    ctx.orgId,
  );
  if (!loaded.ok) return loaded;
  const refreshed = withAuthorizationSnapshot(ctx, loaded.snapshot);
  return canUseTool(tool, refreshed)
    ? { ok: true, ctx: refreshed }
    : { ok: false, reason: "authorization_denied" };
}

export const AUTHORIZATION_CHANGED_RESULT = {
  error: "Sem permissão",
  reason_code: "authorization_changed",
  _instruction: "A autorização mudou antes da ação. A ação NÃO foi executada. Informa o utilizador e pede para rever permissões, módulo e grant do Otto.",
} as const;
