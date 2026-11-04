// Core types shared across the Otto tool system.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import type { OttoModuleKey, OttoPermissionModule } from "./modules.ts";

export type OttoMode = "support" | "onboarding";
export type DataScope = "own" | "team" | "all";
export type ModulePermissions = Readonly<Record<string, unknown>>;

export interface OrgInfo {
  id: string;
  name: string;
  niche: string | null;
  trial_ends_at: string | null;
  plan: string | null;
  enabled_modules: string[];
}

// Computed view of how far the org has progressed through setup. Derived from
// real data (pipeline stages exist? invoicing configured?) so it is accurate
// even before the org_onboarding_state row is written.
export interface OnboardingState {
  current_stage: string;
  stages_completed: string[];
  dismissed: boolean;
  completed: boolean;
  // Real-world checks, independent of the stored row. Ordered as the value path:
  // configure the basics, then create the first client/sale/proposal (activation),
  // then the heavier optional config.
  checks: {
    company_info: boolean;
    pipeline: boolean;
    leads: boolean;
    clients: boolean;
    sales: boolean;
    proposals: boolean;
    invoicing: boolean;
    integrations: boolean;
    team: boolean;
  };
}

export interface ToolContext {
  orgId: string;
  userId: string;
  // Caller-scoped client created from the verified inbound bearer. Use this
  // for native RPC/Edge contracts that depend on auth.uid(), RLS, MFA, or
  // channel assignment. Never serialize or log the client or its headers.
  supabaseUser: SupabaseClient;
  supabaseAdmin: SupabaseClient;
  isAdmin: boolean;
  permissions: ModulePermissions | null;
  writeGrants: ReadonlySet<OttoModuleKey>;
  enabledModules: ReadonlySet<OttoModuleKey>;
  dataScope: DataScope;
  scopeUserIds: ReadonlySet<string>;
  org: OrgInfo;
  onboarding: OnboardingState;
  mode: OttoMode;
  attachmentPaths?: string[];
}

// A tool returns a plain object; the registry stringifies it for the model.
export type ToolResult = Record<string, any>;

export type ConfirmationPreview = {
  readonly title: string;
  readonly summary: string;
  readonly destination: `/${string}`;
  // A preview may replace model-supplied arguments with a server-derived,
  // canonical snapshot. This value is persisted for the one-time commit but
  // is never returned to the browser as part of the preview payload.
  readonly preparedArgs?: Readonly<Record<string, unknown>>;
};

export type ToolConfirmation =
  | { readonly kind: "immediate" }
  | {
    readonly kind: "confirmation_required";
    readonly preview: (
      args: Readonly<Record<string, unknown>>,
      ctx: ToolContext,
    ) => Promise<ConfirmationPreview | null>;
  };

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema
  module: OttoModuleKey;
  // Permission gate for non-admins. Admins bypass it. Omit for tools everyone
  // may use (e.g. support ticket, onboarding status).
  permission?: { module: OttoPermissionModule; subarea: string; action: string };
  // Only admins/super_admins may use this tool (configuration, team, etc.).
  adminOnly?: boolean;
  isWrite?: boolean;
  confirmation?: ToolConfirmation;
  execute: (args: Record<string, any>, ctx: ToolContext, tool: Tool) => Promise<ToolResult>;
}
