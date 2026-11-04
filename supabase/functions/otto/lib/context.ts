// Loads everything a tool run needs: authenticated user, org membership,
// admin flag, profile permissions, org info, and the computed onboarding state.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import type { ToolContext, OrgInfo } from "./types.ts";
import { loadAuthorizationSnapshot } from "./authorization.ts";
import { computeOnboardingState, resolveMode } from "./onboarding.ts";
import { meetsMfaPolicy } from "../../_shared/user-authorization.ts";

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
  let supabaseUser: ToolContext["supabaseUser"] | null = null;
  if (authHeader.startsWith("Bearer ") && authHeader !== `Bearer ${SUPABASE_ANON_KEY}`) {
    const token = authHeader.replace("Bearer ", "");
    const candidateUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    try {
      const { data, error } = await candidateUser.auth.getUser(token);
      if (!error && data?.user) {
        userId = data.user.id;
        if (!await meetsMfaPolicy(candidateUser, userId)) {
          return { ctx: null, userId, hasDataAccess: false, blockedReason: 'MFA_REQUIRED' };
        }
        supabaseUser = candidateUser;
      }
    } catch {
      return { ctx: null, userId: null, hasDataAccess: false, blockedReason: 'AUTH_UNAVAILABLE' };
    }
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (!userId || !orgId || !supabaseUser) {
    return { ctx: null, userId, hasDataAccess: false };
  }
  const validatedOrgId = orgId;
  const authorization = await loadAuthorizationSnapshot(admin, userId, validatedOrgId);
  if (!authorization.ok) {
    return {
      ctx: null,
      userId,
      hasDataAccess: false,
      blockedReason: authorization.reason,
    };
  }

  // Load org info.
  const { data: orgRow, error: orgError } = await admin
    .from("organizations")
    .select("id, name, niche, trial_ends_at, plan, enabled_modules")
    .eq("id", validatedOrgId)
    .maybeSingle();
  if (orgError || !orgRow) {
    return { ctx: null, userId, hasDataAccess: false, blockedReason: "organization_unavailable" };
  }

  const org: OrgInfo = {
    id: validatedOrgId,
    name: orgRow?.name ?? "",
    niche: orgRow?.niche ?? null,
    trial_ends_at: orgRow?.trial_ends_at ?? null,
    plan: orgRow?.plan ?? null,
    enabled_modules: [...authorization.snapshot.enabledModules],
  };

  const onboarding = await computeOnboardingState(admin, org);
  const mode = resolveMode(org, onboarding);

  return {
    ctx: {
      orgId: validatedOrgId,
      userId,
      supabaseUser,
      supabaseAdmin: admin,
      ...authorization.snapshot,
      org,
      onboarding,
      mode,
      attachmentPaths,
    },
    userId,
    hasDataAccess: true,
  };
}
