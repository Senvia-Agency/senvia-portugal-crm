import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { supabaseEntityReader } from "./automation-workflow-entity-source.ts";

Deno.test("PostgREST reader applies organization and keyset before bounded selection", async () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const cursor = "22222222-2222-4222-8222-222222222222";
  let observed: URL | undefined;
  const db = createClient("https://fixture.invalid", "test-only-key", { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      observed = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return new Response("[]", { headers: { "content-type": "application/json" } });
    } } });
  await supabaseEntityReader(db)({ entity: "leads", organizationId, cursor, limit: 20 });
  assertEquals(observed?.pathname, "/rest/v1/leads");
  assertEquals(observed?.searchParams.get("organization_id"), `eq.${organizationId}`);
  assertEquals(observed?.searchParams.get("id"), `gt.${cursor}`);
  assertEquals(observed?.searchParams.get("limit"), "20");
  assertEquals(observed?.searchParams.get("archived_at"), "is.null");
  assertEquals(observed?.searchParams.get("automation_enabled"), "eq.true");
  assertEquals(observed?.searchParams.get("select")?.includes("*"), false);
});
