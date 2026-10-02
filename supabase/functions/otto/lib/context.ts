// Loads everything a tool run needs: authenticated user, org membership,
// admin flag, profile permissions, org info, and the computed onboarding state.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import type { ToolContext, OrgInfo } from "./types.ts";
import { computeOnboardingState, resolveMode } from "./onboarding.ts";

export interface LoadResult {
  ctx: ToolContext | null;   // null when the user has no data access
  userId: string | null;
  hasDataAccess: boolean;
  blockedReason?: string;
}

export async function loadContext(
  req: Request,
  organization_id: string | null,
  attachmentPaths?: string[],
): Promise<LoadResult> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  let orgId = organization_id || null;

  // Validate the user token (anon-key calls count as unauthenticated).
  let userId: string | null = null;
  if (authHeader.startsWith("Bearer ") && authHeader !== `Bearer ${SUPABASE_ANON_KEY}`) {
    const token = authHeader.replace("Bearer ", "");
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    try {
      const { data, error } = await supabaseAuth.auth.getUser(token);
      if (!error && data?.user) userId = data.user.id;
    } catch { /* unauthenticated */ }
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Validate org membership (or super_admin).
  let isSuperAdmin = false;
  if (userId && orgId) {
    const { data: membership } = await admin
      .from("organization_members")
      .select("id")
      .eq("user_id", userId)
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .maybeSingle();
    if (!membership) {
      const { data: superRole } = await admin
        .from("user_roles")
        .select("id")
        .eq("user_id", userId)
        .eq("role", "super_admin")
        .maybeSingle();
      if (superRole) isSuperAdmin = true;
      else orgId = null; // not a member — disable data access
    }
  }

  const hasDataAccess = !!userId && !!orgId;
  if (!hasDataAccess) {
    return { ctx: null, userId, hasDataAccess: false };
  }

  // Resolve admin role + profile permissions.
  let isAdmin = isSuperAdmin;
  let permissions: Record<string, any> | null = null;
  let dataScope: "own" | "team" | "all" = "all";
  if (!isAdmin) {
    const { data: adminRole } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId!)
      .in("role", ["admin", "super_admin"]);
    isAdmin = !!(adminRole && adminRole.length > 0);
  }
  if (!isAdmin) {
    const { data: member } = await admin
      .from("organization_members")
      .select("profile_id")
      .eq("user_id", userId!)
      .eq("organization_id", orgId!)
      .maybeSingle();
    if (member?.profile_id) {
      const { data: profile } = await admin
        .from("organization_profiles")
        .select("module_permissions, data_scope")
        .eq("id", member.profile_id)
        .maybeSingle();
      permissions = profile?.module_permissions || null;
      dataScope = (profile?.data_scope === "team" || profile?.data_scope === "all") ? profile.data_scope : "own";
    }
  }
  if (isAdmin) dataScope = "all";

  let effectiveUserIds: string[] | null = null;
  if (dataScope === "own") {
    effectiveUserIds = [userId!];
  } else if (dataScope === "team") {
    const { data: ledTeam } = await admin
      .from("teams")
      .select("id")
      .eq("organization_id", orgId!)
      .eq("leader_id", userId!)
      .maybeSingle();

    if (ledTeam?.id) {
      const { data: entries } = await admin
        .from("team_members")
        .select("user_id")
        .eq("team_id", ledTeam.id);
      effectiveUserIds = [userId!, ...((entries || []).map((e: any) => e.user_id).filter(Boolean))];
    } else {
      effectiveUserIds = [userId!];
    }
  }

  // Load org info.
  const { data: orgRow } = await admin
    .from("organizations")
    .select("id, name, niche, trial_ends_at, plan, enabled_modules")
    .eq("id", orgId!)
    .maybeSingle();

  const enabledModules = Array.isArray(orgRow?.enabled_modules)
    ? (orgRow!.enabled_modules as string[])
    : (orgRow?.enabled_modules && typeof orgRow.enabled_modules === "object"
        ? Object.keys(orgRow.enabled_modules).filter((k) => (orgRow!.enabled_modules as any)[k])
        : []);

  const org: OrgInfo = {
    id: orgId!,
    name: orgRow?.name ?? "",
    niche: orgRow?.niche ?? null,
    trial_ends_at: orgRow?.trial_ends_at ?? null,
    plan: orgRow?.plan ?? null,
    enabled_modules: enabledModules,
  };

  const onboarding = await computeOnboardingState(admin, org);
  const mode = resolveMode(org, onboarding);

  return {
    ctx: {
      orgId: orgId!,
      userId,
      supabaseAdmin: admin,
      isAdmin,
      permissions,
      dataScope,
      effectiveUserIds,
      org,
      onboarding,
      mode,
      attachmentPaths,
    },
    userId,
    hasDataAccess: true,
  };
}
