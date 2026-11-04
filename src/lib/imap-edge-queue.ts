import { supabase } from "@/integrations/supabase/client";

// These edge functions open their own IMAP connection for each request, on top
// of the one the email gateway keeps open per caixa. Shared hosting (cPanel)
// refuses an account's logins past a handful at once, so this browser sends at
// most two of them at a time; the rest wait their turn.
const MAX_AT_ONCE = 2;
let running = 0;
const waiting: Array<() => void> = [];

export async function invokeImapFunction<T = unknown>(name: "email-message-action" | "email-fetch-body", body: Record<string, unknown>) {
  // A freed slot is handed straight to the next in line, so the count never passes the limit.
  if (running >= MAX_AT_ONCE) await new Promise<void>(resolve => waiting.push(resolve));
  else running++;
  try {
    return await supabase.functions.invoke<T>(name, { body });
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}
