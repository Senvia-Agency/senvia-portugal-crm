import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.49.8";

import { meetsMfaPolicy } from "../_shared/user-authorization.ts";

export type RuntimeActor = {
  readonly userId: string;
  readonly userClient: SupabaseClient;
  readonly adminClient: SupabaseClient;
};

export async function authenticateRuntimeActor(request: Request): Promise<
  | {
    readonly ok: true;
    readonly actorId: string;
    readonly token: RuntimeActor;
  }
  | {
    readonly ok: false;
    readonly reason:
      | "unauthorized"
      | "mfa_required"
      | "authorization_unavailable";
  }
> {
  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return { ok: false, reason: "authorization_unavailable" };
  }
  if (
    !token || token.length > 4_096 || token === anonKey || token === serviceKey
  ) {
    return { ok: false, reason: "unauthorized" };
  }
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const identity = await userClient.auth.getUser(token);
  const user = identity.data.user;
  if (identity.error || !user) return { ok: false, reason: "unauthorized" };
  if (!await meetsMfaPolicy(userClient, user.id)) {
    return { ok: false, reason: "mfa_required" };
  }
  const adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    ok: true,
    actorId: user.id,
    token: { userId: user.id, userClient, adminClient },
  };
}
