import { createClient } from 'npm:@supabase/supabase-js@2.57.2';

Deno.serve(async (req: Request): Promise<Response> => {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', key, { auth: { persistSession: false } });
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let authorized = key.length > 0 && bearer === key;
  const secret = req.headers.get('x-automation-secret');
  if (!authorized && secret) {
    const { data, error } = await db.rpc('verify_automation_secret', { p_secret: secret });
    authorized = !error && data === true;
  }
  if (!authorized) return Response.json({ error: 'Não autorizado' }, { status: 401 });
  const { data, error } = await db.rpc('dispatch_automation_lifecycle_events');
  return error ? Response.json({ error: 'Não foi possível verificar os eventos comerciais.' }, { status: 500 })
    : Response.json({ dispatched: data ?? 0 });
});
