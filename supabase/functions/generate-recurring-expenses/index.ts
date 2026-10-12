import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Most periods booked for one expense in a single run.
const MAX_CATCH_UP = 24;

serve(async (req: Request): Promise<Response> => {
  const denied = await internalJobGuard(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const today = new Date().toISOString().split("T")[0];

    // Find all recurring expenses due for generation
    const { data: expenses, error: fetchErr } = await supabase
      .from("expenses")
      .select("*")
      .eq("is_recurring", true)
      .lte("next_recurrence_date", today)
      .not("next_recurrence_date", "is", null);

    if (fetchErr) throw fetchErr;
    if (!expenses || expenses.length === 0) {
      return new Response(JSON.stringify({ success: true, generated: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let generated = 0;

    for (const expense of expenses) {
      // Book every period that has fallen due, not just one: after a missed
      // run a weekly expense can owe several. Capped so a schedule dated far
      // in the past cannot flood the books in one go.
      let due: string | null = expense.next_recurrence_date;
      for (let booked = 0; due && due <= today && booked < MAX_CATCH_UP; booked++) {
        const { error: insertErr } = await supabase
          .from("expenses")
          .insert({
            organization_id: expense.organization_id,
            category_id: expense.category_id,
            description: expense.description,
            amount: expense.amount,
            expense_date: due,
            is_recurring: false, // Generated copy is not recurring itself
            notes: expense.notes,
            created_by: expense.created_by,
            bank_account_id: expense.bank_account_id,
          });

        if (insertErr) {
          console.error(`Error generating expense for ${expense.id}:`, insertErr);
          break;
        }
        generated++;

        // The schedule (weekly/monthly/quarterly/yearly, due day) lives in
        // the database: expense_recurrence_next is the one place that knows it.
        const { data: next, error: nextErr } = await supabase.rpc("expense_recurrence_next", {
          p_after: due,
          p_frequency: expense.recurrence_frequency ?? "monthly",
          p_day: expense.recurrence_day,
          p_month: expense.recurrence_month,
        });
        if (nextErr || !next) {
          console.error(`Error computing next date for ${expense.id}:`, nextErr);
          break;
        }

        // Saved after each copy, so a failure halfway never books one twice.
        const { error: updateErr } = await supabase
          .from("expenses")
          .update({ next_recurrence_date: next })
          .eq("id", expense.id);
        if (updateErr) {
          console.error(`Error updating next_recurrence_date for ${expense.id}:`, updateErr);
          break;
        }
        due = next as string;
      }
    }

    return new Response(JSON.stringify({ success: true, generated }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in generate-recurring-expenses:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
import { internalJobGuard } from "../_shared/internal-auth.ts";
