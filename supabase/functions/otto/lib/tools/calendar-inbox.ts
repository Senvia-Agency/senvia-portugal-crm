import type { Tool } from "../types.ts";
import { calendarEventCreateTools } from "./calendar-inbox-event-create.ts";
import { calendarEventDeleteTools } from "./calendar-inbox-event-delete.ts";
import { calendarEventReadTools } from "./calendar-inbox-event-read.ts";
import { calendarEventUpdateTools } from "./calendar-inbox-event-update.ts";
import { calendarInboxTaskReadTools } from "./calendar-inbox-task-read.ts";
import { calendarInboxTaskWriteTools } from "./calendar-inbox-task-write.ts";

export const calendarInboxTools: Tool[] = [
  ...calendarEventReadTools,
  ...calendarEventCreateTools,
  ...calendarEventUpdateTools,
  ...calendarEventDeleteTools,
  ...calendarInboxTaskReadTools,
  ...calendarInboxTaskWriteTools,
];
