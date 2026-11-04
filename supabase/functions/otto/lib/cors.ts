// Shared CORS headers + small response helpers for the Otto function.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export function jsonError(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Build a Server-Sent-Events stream that emits `text` progressively in small
// chunks (so the client renders it word-by-word) followed by [DONE]. The wire
// format matches the OpenAI/Gemini delta shape the frontend already parses.
export function streamText(text: string, extraHeaders?: Record<string, string>): Response {
  const encoder = new TextEncoder();
  // Split on word boundaries but keep the separators so spacing is preserved.
  const chunks = text.match(/\S+\s*/g) ?? [text];
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`;
        controller.enqueue(encoder.encode(frame));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream", ...(extraHeaders ?? {}) },
  });
}

export function streamActionEvent(
  event: "action_preview" | "action_result",
  payload: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream", ...(extraHeaders ?? {}) },
  });
}
