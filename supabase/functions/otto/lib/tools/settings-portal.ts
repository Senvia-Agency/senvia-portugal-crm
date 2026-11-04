import type { Tool } from "../types.ts";
import { portalContractReadTools } from "./settings-portal-contract-tools.ts";
import { settingsTeamReadTools } from "./settings-portal-team.ts";

export const settingsPortalTools = [
  ...settingsTeamReadTools,
  ...portalContractReadTools,
] satisfies readonly Tool[];
