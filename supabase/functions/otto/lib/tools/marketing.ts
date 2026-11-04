import type { Tool } from "../types.ts";
import { marketingCampaignReadTools } from "./marketing-campaigns-read.ts";
import { marketingCampaignWriteTools } from "./marketing-campaigns-write.ts";
import { marketingContactCreate } from "./marketing-contact-create.ts";
import { marketingListTools } from "./marketing-lists.ts";
import { marketingReportTools } from "./marketing-reports.ts";
import { marketingTemplateTools } from "./marketing-templates.ts";

export const marketingTools: Tool[] = [
  marketingContactCreate,
  ...marketingTemplateTools,
  ...marketingListTools,
  ...marketingCampaignReadTools,
  ...marketingCampaignWriteTools,
  ...marketingReportTools,
];
