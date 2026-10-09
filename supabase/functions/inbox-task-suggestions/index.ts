import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { z } from 'npm:zod@3.25.76';
import { analyzeConversation, conversationSchema, matchesServiceKey, SuggestionError } from '../_shared/inbox-task-suggestions.ts';
import { requestMfaResponse } from '../_shared/user-authorization.ts';
import { rateLimit } from '../_shared/security.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const inputSchema = z.object({ conversation_id: z.string().uuid() }).strict();

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!bearer || bearer.length > 4096) return response({ error: 'UNAUTHORIZED' }, 401);
  const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return response({ error: 'SERVER_NOT_CONFIGURED' }, 503);
  try {
    let body: unknown;
    try { body = await req.json(); } catch { return response({ error: 'INVALID_INPUT' }, 400); }
    const input = inputSchema.safeParse(body);
    if (!input.success) return response({ error: 'INVALID_INPUT' }, 400);
    const internal = await matchesServiceKey(bearer, service);
    const userClient = createClient(url, internal ? service : anon, { global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    if (!internal) {
      const identity = await userClient.auth.getUser();
      if (identity.error || !identity.data.user) return response({ error: 'UNAUTHORIZED' }, 401);
      const policy = await requestMfaResponse(req, identity.data.user.id, cors);
      if (policy) return policy;
      if (!rateLimit(`inbox-task-suggestions:${identity.data.user.id}`, 10, 60_000).allowed) return response({ error: 'RATE_LIMITED' }, 429);
    }
    // User requests must prove access through the existing conversation RLS before admin work.
    const readable = await userClient.from('meta_conversations').select('id,organization_id,channel_id,contact_ref,contact_name').eq('id', input.data.conversation_id).maybeSingle();
    if (readable.error) return response({ error: 'CONVERSATION_READ_FAILED' }, 500);
    if (!readable.data) return response({ error: 'CONVERSATION_NOT_FOUND' }, 404);
    const conversation = conversationSchema.safeParse(readable.data);
    if (!conversation.success) return response({ error: 'CONVERSATION_INVALID' }, 500);
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    return response(await analyzeConversation(admin, conversation.data));
  } catch (error) {
    return response({ error: error instanceof SuggestionError ? error.code : 'ANALYSIS_FAILED' }, error instanceof SuggestionError ? error.status : 502);
  }
}

if (import.meta.main) Deno.serve(handleRequest);
