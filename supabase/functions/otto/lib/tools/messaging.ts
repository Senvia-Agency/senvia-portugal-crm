import type { Tool } from "../types.ts";
import { messagingConversationReadTools } from "./messaging-conversation-read.ts";
import { messagingConversationSendTools } from "./messaging-conversation-send.ts";
import { messagingEmailDraftTools } from "./messaging-email-drafts.ts";
import { messagingEmailReadTools } from "./messaging-email-read.ts";
import { messagingEmailSendTools } from "./messaging-email-send.ts";

export const messagingTools: Tool[] = [
  ...messagingConversationReadTools,
  ...messagingConversationSendTools,
  ...messagingEmailReadTools,
  ...messagingEmailDraftTools,
  ...messagingEmailSendTools,
];
