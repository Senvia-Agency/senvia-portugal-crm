import { z } from "zod";

import {
  OTTO_ACTION_STATUSES,
  type OttoActionPreview,
  type OttoActionResult,
  type OttoActionStatus,
} from "@/stores/useOttoStore";

const actionPreviewSchema = z.object({
  confirmationId: z.string().uuid(),
  expiresAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  title: z.string().min(1),
  summary: z.string().min(1),
  destination: z.string().min(1),
}).strict();

const actionResultSchema = z.object({
  status: z.enum(OTTO_ACTION_STATUSES),
  summary: z.string().min(1),
  error: z.string().min(1).optional(),
  operation: z.string().min(1).optional(),
  resource: z.object({
    type: z.string().min(1),
    id: z.string().min(1),
    route: z.string().regex(/^\/(?!\/)/),
  }).strict().optional(),
  invalidateQueryKeys: z.array(z.array(z.string().min(1)).min(1)).optional(),
}).strict();

const streamedTextSchema = z.union([
  z.object({ content: z.string() }).strict(),
  z.object({
    choices: z.array(z.object({
      delta: z.object({ content: z.string().optional() }).optional(),
    }).passthrough()).optional(),
  }).passthrough(),
]);

const errorPayloadSchema = z.object({ error: z.string().min(1) }).passthrough();

export type OttoActionDecision = "confirm" | "cancel";

export type OttoRequestBody =
  | {
      readonly messages: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
      readonly organization_id: string;
      readonly attachment_paths?: readonly string[];
    }
  | {
      readonly organization_id: string;
      readonly confirmation_id: string;
      readonly decision: OttoActionDecision;
    };

export type OttoStreamHandlers = {
  readonly onText?: (content: string) => void;
  readonly onPreview?: (preview: OttoActionPreview) => void;
  readonly onResult?: (result: OttoActionResult) => void;
};

interface OttoStreamRequest {
  readonly token: string;
  readonly body: OttoRequestBody;
  readonly signal: AbortSignal;
  readonly handlers: OttoStreamHandlers;
}

class OttoRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OttoRequestError";
    this.status = status;
  }
}

const OTTO_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/otto`;

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isActionStatus(value: unknown): value is OttoActionStatus {
  return OTTO_ACTION_STATUSES.some((status) => status === value);
}

function isQueryKeyList(value: unknown): value is string[][] {
  return Array.isArray(value) && value.every((queryKey: unknown) =>
    Array.isArray(queryKey)
    && queryKey.length > 0
    && queryKey.every((entry: unknown) => typeof entry === "string" && entry.length > 0));
}

function parsePreview(payload: unknown): OttoActionPreview | null {
  if (!actionPreviewSchema.safeParse(payload).success || !isRecord(payload)) return null;
  const { confirmationId, expiresAt, title, summary, destination } = payload;
  if (typeof confirmationId !== "string" || typeof expiresAt !== "string"
    || typeof title !== "string" || typeof summary !== "string" || typeof destination !== "string") return null;
  return { confirmationId, expiresAt, title, summary, destination };
}

function parseResult(payload: unknown): OttoActionResult | null {
  if (!actionResultSchema.safeParse(payload).success || !isRecord(payload)) return null;
  if (!isActionStatus(payload.status) || typeof payload.summary !== "string") return null;
  const resourceValue = payload.resource;
  const resource = isRecord(resourceValue)
    && typeof resourceValue.type === "string"
    && typeof resourceValue.id === "string"
    && typeof resourceValue.route === "string"
    ? { type: resourceValue.type, id: resourceValue.id, route: resourceValue.route }
    : undefined;
  return {
    status: payload.status,
    summary: payload.summary,
    ...(typeof payload.error === "string" ? { error: payload.error } : {}),
    ...(typeof payload.operation === "string" ? { operation: payload.operation } : {}),
    ...(resource ? { resource } : {}),
    ...(isQueryKeyList(payload.invalidateQueryKeys) ? { invalidateQueryKeys: payload.invalidateQueryKeys } : {}),
  };
}

function handleFrame(eventName: string, data: string, handlers: OttoStreamHandlers): void {
  if (data === "[DONE]") return;
  const payload = parseJson(data);
  if (payload === null) return;

  if (eventName === "action_preview") {
    const preview = parsePreview(payload);
    if (preview) handlers.onPreview?.(preview);
    return;
  }
  if (eventName === "action_result") {
    const result = parseResult(payload);
    if (result) handlers.onResult?.(result);
    return;
  }
  if (eventName !== "message" && eventName !== "content") return;

  const parsed = streamedTextSchema.safeParse(payload);
  if (!parsed.success || !isRecord(payload)) return;
  if (typeof payload.content === "string") {
    handlers.onText?.(payload.content);
    return;
  }
  const firstChoice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const delta = isRecord(firstChoice) && isRecord(firstChoice.delta) ? firstChoice.delta : null;
  const content = delta && typeof delta.content === "string" ? delta.content : null;
  if (content) handlers.onText?.(content);
}

async function consumeSse(body: ReadableStream<Uint8Array>, handlers: OttoStreamHandlers): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frameLines: string[] = [];
  let buffer = "";
  let completed = false;

  const consumeLine = (rawLine: string): void => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line !== "") {
      frameLines.push(line);
      return;
    }
    let eventName = "message";
    const dataLines: string[] = [];
    for (const frameLine of frameLines) {
      if (frameLine.startsWith(":")) continue;
      const separator = frameLine.indexOf(":");
      const field = separator === -1 ? frameLine : frameLine.slice(0, separator);
      let value = separator === -1 ? "" : frameLine.slice(separator + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") eventName = value;
      if (field === "data") dataLines.push(value);
    }
    frameLines.length = 0;
    const data = dataLines.join("\n");
    if (data === "[DONE]") completed = true;
    else if (dataLines.length > 0) handleFrame(eventName, data, handlers);
  };

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      consumeLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      if (completed) {
        void reader.cancel().catch(() => undefined);
        return;
      }
      newlineIndex = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.length > 0) consumeLine(buffer);
  if (frameLines.length > 0) consumeLine("");
}

async function responseErrorMessage(response: Response): Promise<string> {
  const raw = await response.text();
  const parsed = parseJson(raw);
  const errorPayload = errorPayloadSchema.safeParse(parsed);
  return errorPayload.success ? errorPayload.data.error : "Erro ao contactar o Otto.";
}

export async function requestOttoStream(request: OttoStreamRequest): Promise<void> {
  const response = await fetch(OTTO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${request.token}`,
    },
    body: JSON.stringify(request.body),
    signal: request.signal,
  });
  if (!response.ok) throw new OttoRequestError(await responseErrorMessage(response), response.status);
  if (!response.body) throw new OttoRequestError("O Otto devolveu uma resposta vazia.", response.status);
  await consumeSse(response.body, request.handlers);
}
