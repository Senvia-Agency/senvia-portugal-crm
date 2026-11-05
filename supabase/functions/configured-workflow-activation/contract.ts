import { z } from "npm:zod@3.25.76";

const uuid = z.string().uuid();
const prepareSchema = z.object({
  action: z.literal("prepare"),
  flow_id: uuid,
  expected_version: z.number().int().positive(),
  expected_updated_at: z.string().datetime({ offset: true }),
}).strict();
const activateSchema = z.object({
  action: z.literal("activate"),
  flow_id: uuid,
  preview_id: uuid,
  snapshot_digest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const activationRequestSchema = z.discriminatedUnion("action", [
  prepareSchema,
  activateSchema,
]);

export const ACTIVATION_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
} as const;

export type AccessSummary = {
  readonly organizationId: string;
  readonly isAdmin: boolean;
  readonly dataScope: "own" | "team" | "all";
  readonly automationsEnabled: boolean;
};

export type FlowSummary = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly triggerType: string;
  readonly version: number;
  readonly updatedAt: string;
};

export type PreviewSnapshot = {
  readonly digest: string;
  readonly scannedRecords: number;
  readonly eligibleRecords: number;
  readonly eligibleStages: number;
  readonly observedLocalDate: string;
  readonly timeZone: string;
  readonly stages: readonly {
    readonly stageId: string;
    readonly nodeId: string;
    readonly eligibleRecords: number;
  }[];
};

type AuthFailure =
  | "unauthorized"
  | "mfa_required"
  | "authorization_unavailable";
type CandidateFailure =
  | "flow_not_found"
  | "admin_required"
  | "module_disabled"
  | "authorization_unavailable"
  | "database_unavailable";
type SnapshotFailure =
  | "graph_invalid"
  | "preview_unavailable"
  | "database_unavailable";
type ProofFailure = "preview_unavailable" | "database_unavailable";
type ActivationFailure = "activation_rejected" | "database_unavailable";
export type EndpointFailure =
  | AuthFailure
  | CandidateFailure
  | SnapshotFailure
  | ProofFailure
  | ActivationFailure;

export type ActivationEndpointDependencies<ActorToken, CandidateToken> = {
  readonly authenticate: (request: Request) => Promise<
    | {
      readonly ok: true;
      readonly actorId: string;
      readonly token: ActorToken;
    }
    | { readonly ok: false; readonly reason: AuthFailure }
  >;
  readonly loadCandidate: (
    request: Request,
    actor: ActorToken,
    flowId: string,
  ) => Promise<
    | {
      readonly ok: true;
      readonly access: AccessSummary;
      readonly flow: FlowSummary;
      readonly token: CandidateToken;
    }
    | { readonly ok: false; readonly reason: CandidateFailure }
  >;
  readonly prepareSnapshot: (candidate: CandidateToken) => Promise<
    | { readonly ok: true; readonly snapshot: PreviewSnapshot }
    | { readonly ok: false; readonly reason: SnapshotFailure }
  >;
  readonly recordProof: (
    candidate: CandidateToken,
    snapshot: PreviewSnapshot,
  ) => Promise<
    | {
      readonly ok: true;
      readonly previewId: string;
      readonly expiresAt: string;
    }
    | { readonly ok: false; readonly reason: ProofFailure }
  >;
  readonly activate: (
    actor: ActorToken,
    previewId: string,
    digest: string,
  ) => Promise<
    | { readonly ok: true; readonly flow: FlowSummary }
    | { readonly ok: false; readonly reason: ActivationFailure }
  >;
};
