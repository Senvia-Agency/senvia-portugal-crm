import {
  type AccessSummary,
  type ActivationEndpointDependencies,
  type FlowSummary,
  type PreviewSnapshot,
} from "./contract.ts";
import { handleConfiguredWorkflowActivation } from "./handler.ts";

const FLOW_ID = "11111111-1111-4111-8111-111111111111";
const PREVIEW_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const UPDATED_AT = "2026-11-04T10:00:00.000Z";
const EXPIRES_AT = "2026-11-04T10:05:00.000Z";
const DIGEST = "a".repeat(64);

const access: AccessSummary = {
  organizationId: "44444444-4444-4444-8444-444444444444",
  isAdmin: true,
  dataScope: "all",
  automationsEnabled: true,
};

const flow: FlowSummary = {
  id: FLOW_ID,
  name: "Cobranças",
  status: "draft",
  triggerType: "configured_workflow",
  version: 3,
  updatedAt: UPDATED_AT,
};

const previewSnapshot = {
  digest: DIGEST,
  scannedRecords: 7,
  eligibleRecords: 2,
  eligibleStages: 3,
  observedLocalDate: "2026-11-04",
  timeZone: "Europe/Lisbon",
  stages: [
    { stageId: "email", nodeId: "email-node", eligibleRecords: 2 },
    { stageId: "whatsapp", nodeId: "whatsapp-node", eligibleRecords: 1 },
  ],
} satisfies PreviewSnapshot;

function request(body: unknown): Request {
  return new Request(
    "https://example.test/functions/v1/configured-workflow-activation",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer user-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

function dependencies(
  overrides: Partial<ActivationEndpointDependencies<string, string>> = {},
): ActivationEndpointDependencies<string, string> {
  return {
    authenticate: async () => ({
      ok: true,
      actorId: ACTOR_ID,
      token: "actor-token",
    }),
    loadCandidate: async () => ({
      ok: true,
      access,
      flow,
      token: "candidate-token",
    }),
    prepareSnapshot: async () => ({ ok: true, snapshot: previewSnapshot }),
    recordProof: async () => ({
      ok: true,
      previewId: PREVIEW_ID,
      expiresAt: EXPIRES_AT,
    }),
    activate: async () => ({
      ok: true,
      flow: {
        ...flow,
        status: "active",
        version: 4,
        updatedAt: "2026-11-04T10:01:00.000Z",
      },
    }),
    ...overrides,
  };
}

async function json(
  response: Response,
): Promise<Readonly<Record<string, unknown>>> {
  const body: unknown = await response.json();
  if (!isRecord(body)) {
    throw new Error("Expected an object response");
  }
  return body;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)}`);
  }
}

Deno.test("prepare returns only aggregate preview data for an MFA admin without an Otto grant", async () => {
  const calls: string[] = [];
  const response = await handleConfiguredWorkflowActivation(
    request({
      action: "prepare",
      flow_id: FLOW_ID,
      expected_version: 3,
      expected_updated_at: UPDATED_AT,
    }),
    dependencies({
      authenticate: async () => {
        calls.push("authenticate");
        return { ok: true, actorId: ACTOR_ID, token: "actor-token" };
      },
      loadCandidate: async () => {
        calls.push("candidate");
        return { ok: true, access, flow, token: "candidate-token" };
      },
      prepareSnapshot: async () => {
        calls.push("snapshot");
        return (await dependencies().prepareSnapshot("candidate-token"));
      },
      recordProof: async () => {
        calls.push("proof");
        return { ok: true, previewId: PREVIEW_ID, expiresAt: EXPIRES_AT };
      },
    }),
  );
  const body = await json(response);
  if (response.status !== 200) {
    throw new Error(`Expected 200, received ${response.status}`);
  }
  equal(
    calls,
    ["authenticate", "candidate", "snapshot", "proof"],
    "Unexpected prepare order",
  );
  if (
    JSON.stringify(body).includes("record_id") ||
    JSON.stringify(body).includes("candidate-token")
  ) {
    throw new Error("Prepared response exposed record or internal token data");
  }
  equal(body.action, "prepared", "Unexpected action");
});

Deno.test("prepare cannot cross organizations and never records a proof", async () => {
  let recorded = false;
  const response = await handleConfiguredWorkflowActivation(
    request({
      action: "prepare",
      flow_id: FLOW_ID,
      expected_version: 3,
      expected_updated_at: UPDATED_AT,
    }),
    dependencies({
      loadCandidate: async () => ({ ok: false, reason: "flow_not_found" }),
      recordProof: async () => {
        recorded = true;
        return { ok: true, previewId: PREVIEW_ID, expiresAt: EXPIRES_AT };
      },
    }),
  );
  const body = await json(response);
  if (
    response.status !== 404 || body.reason_code !== "flow_not_found" || recorded
  ) {
    throw new Error(
      `Cross-organization flow was not denied safely: ${JSON.stringify(body)}`,
    );
  }
});

Deno.test("prepare rejects non-admin, restricted-scope, disabled-module and stale-flow requests", async () => {
  const cases = [
    [{ ...access, isAdmin: false }, 403, "admin_required"],
    [{ ...access, dataScope: "own" as const }, 403, "admin_required"],
    [{ ...access, automationsEnabled: false }, 403, "module_disabled"],
  ] as const;
  for (const [candidateAccess, status, reason] of cases) {
    const response = await handleConfiguredWorkflowActivation(
      request({
        action: "prepare",
        flow_id: FLOW_ID,
        expected_version: 3,
        expected_updated_at: UPDATED_AT,
      }),
      dependencies({
        loadCandidate: async () => ({
          ok: true,
          access: candidateAccess,
          flow,
          token: "candidate-token",
        }),
      }),
    );
    const body = await json(response);
    if (response.status !== status || body.reason_code !== reason) {
      throw new Error(`Gate failed for ${reason}`);
    }
  }
  const stale = await handleConfiguredWorkflowActivation(
    request({
      action: "prepare",
      flow_id: FLOW_ID,
      expected_version: 2,
      expected_updated_at: UPDATED_AT,
    }),
    dependencies(),
  );
  if (
    stale.status !== 409 || (await json(stale)).reason_code !== "flow_stale"
  ) throw new Error("Stale flow was previewed");
});

Deno.test("activate rejects an expired or consumed proof without returning a flow", async () => {
  const response = await handleConfiguredWorkflowActivation(
    request({
      action: "activate",
      flow_id: FLOW_ID,
      preview_id: PREVIEW_ID,
      snapshot_digest: DIGEST,
    }),
    dependencies({
      activate: async () => ({ ok: false, reason: "activation_rejected" }),
    }),
  );
  const body = await json(response);
  if (
    response.status !== 409 || body.reason_code !== "activation_rejected" ||
    "flow" in body
  ) {
    throw new Error(
      `Expired proof response was unsafe: ${JSON.stringify(body)}`,
    );
  }
});

Deno.test("activate returns a redacted active flow and rejects client-supplied organization identity", async () => {
  const response = await handleConfiguredWorkflowActivation(
    request({
      action: "activate",
      flow_id: FLOW_ID,
      preview_id: PREVIEW_ID,
      snapshot_digest: DIGEST,
    }),
    dependencies(),
  );
  const body = await json(response);
  if (response.status !== 200 || body.action !== "activated") {
    throw new Error("Activation result missing");
  }
  if (
    JSON.stringify(body).includes("graph") ||
    JSON.stringify(body).includes(access.organizationId)
  ) {
    throw new Error(
      "Activation response exposed internal flow or organization data",
    );
  }
  const forged = await handleConfiguredWorkflowActivation(
    request({
      action: "activate",
      flow_id: FLOW_ID,
      preview_id: PREVIEW_ID,
      snapshot_digest: DIGEST,
      organization_id: access.organizationId,
    }),
    dependencies(),
  );
  if (forged.status !== 400) {
    throw new Error("Client-supplied organization identity was accepted");
  }
});

Deno.test("activate revalidates the full snapshot and never consumes a changed preview", async () => {
  let activated = false;
  const response = await handleConfiguredWorkflowActivation(
    request({
      action: "activate",
      flow_id: FLOW_ID,
      preview_id: PREVIEW_ID,
      snapshot_digest: DIGEST,
    }),
    dependencies({
      prepareSnapshot: async () => ({
        ok: true,
        snapshot: { ...previewSnapshot, digest: "b".repeat(64) },
      }),
      activate: async () => {
        activated = true;
        return { ok: false, reason: "activation_rejected" };
      },
    }),
  );
  const body = await json(response);
  if (
    response.status !== 409 || body.reason_code !== "activation_rejected" ||
    activated
  ) {
    throw new Error("Changed snapshot reached the activation RPC");
  }
});

Deno.test("MFA failure is returned before any workflow lookup", async () => {
  let loaded = false;
  const response = await handleConfiguredWorkflowActivation(
    request({
      action: "prepare",
      flow_id: FLOW_ID,
      expected_version: 3,
      expected_updated_at: UPDATED_AT,
    }),
    dependencies({
      authenticate: async () => ({ ok: false, reason: "mfa_required" }),
      loadCandidate: async () => {
        loaded = true;
        return { ok: false, reason: "flow_not_found" };
      },
    }),
  );
  if (
    response.status !== 403 ||
    (await json(response)).reason_code !== "mfa_required" || loaded
  ) {
    throw new Error("MFA gate did not fail closed");
  }
});

Deno.test("HTTP surface completes the prepare and activate handshake without exposing workflow internals", async () => {
  const controller = new AbortController();
  const server = Deno.serve(
    {
      hostname: "127.0.0.1",
      port: 0,
      signal: controller.signal,
      onListen() {},
    },
    (incoming) => handleConfiguredWorkflowActivation(incoming, dependencies()),
  );
  const endpoint =
    `http://127.0.0.1:${server.addr.port}/configured-workflow-activation`;
  try {
    const prepared = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer user-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "prepare",
        flow_id: FLOW_ID,
        expected_version: 3,
        expected_updated_at: UPDATED_AT,
      }),
    });
    const preparedBody = await json(prepared);
    if (
      prepared.status !== 200 || preparedBody.action !== "prepared" ||
      prepared.headers.get("cache-control") !== "no-store"
    ) {
      throw new Error(`HTTP prepare failed: ${prepared.status}`);
    }
    const activated = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer user-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "activate",
        flow_id: FLOW_ID,
        preview_id: PREVIEW_ID,
        snapshot_digest: DIGEST,
      }),
    });
    const activatedBody = await json(activated);
    if (
      activated.status !== 200 || activatedBody.action !== "activated" ||
      JSON.stringify(activatedBody).includes("graph")
    ) {
      throw new Error(`HTTP activate failed: ${activated.status}`);
    }
  } finally {
    controller.abort();
    await server.finished;
  }
});
