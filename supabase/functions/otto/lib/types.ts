// Core types shared across the Otto tool system.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

export type OttoMode = "support" | "onboarding";

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
  // Real-world checks, independent of the stored row.
  checks: {
    company_info: boolean;
    invoicing: boolean;
    integrations: boolean;
    pipeline: boolean;
    team: boolean;
    leads: boolean;
  };
}

export interface ToolContext {
  orgId: string;
  userId: string | null;
  supabaseAdmin: SupabaseClient;
  isAdmin: boolean;
  permissions: Record<string, any> | null;
  dataScope: "own" | "team" | "all";
  effectiveUserIds: string[] | null;
  org: OrgInfo;
  onboarding: OnboardingState;
  mode: OttoMode;
  attachmentPaths?: string[];
}

// A tool returns a plain object; the registry stringifies it for the model.
export type ToolResult = Record<string, any>;

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema
  // Permission gate for non-admins. Admins bypass it. Omit for tools everyone
  // may use (e.g. support ticket, onboarding status).
  permission?: { module: string; subarea: string; action: string };
  // Only admins/super_admins may use this tool (configuration, team, etc.).
  adminOnly?: boolean;
  // Marks a mutating tool — logged to otto_action_log.
  isWrite?: boolean;
  execute: (args: Record<string, any>, ctx: ToolContext) => Promise<ToolResult>;
}
