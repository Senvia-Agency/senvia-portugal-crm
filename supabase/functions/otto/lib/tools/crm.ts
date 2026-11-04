import type { Tool } from "../types.ts";
import { crmClientTools } from "./crm-client.ts";
import { crmLeadImportTools } from "./crm-lead-import.ts";
import { crmLeadLifecycleTools } from "./crm-lead-lifecycle.ts";
import { crmLeadTools } from "./crm-lead.ts";
import { crmProspectImportTools } from "./crm-prospect-import.ts";
import { crmProspectTools } from "./crm-prospect.ts";

export const crmTools: Tool[] = [
  ...crmLeadTools,
  ...crmLeadLifecycleTools,
  ...crmLeadImportTools,
  ...crmClientTools,
  ...crmProspectTools,
  ...crmProspectImportTools,
];
