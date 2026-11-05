import { handleConfiguredWorkflowActivation } from "./handler.ts";
import { runtimeDependencies } from "./runtime.ts";

const ERROR_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
} as const;

export async function handleRequest(request: Request): Promise<Response> {
  try {
    return await handleConfiguredWorkflowActivation(
      request,
      runtimeDependencies,
    );
  } catch (error) {
    console.error(
      "[configured-workflow-activation] request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return new Response(
      JSON.stringify({
        error: "Serviço temporariamente indisponível.",
        reason_code: "database_unavailable",
      }),
      { status: 503, headers: ERROR_HEADERS },
    );
  }
}

if (import.meta.main) Deno.serve(handleRequest);
