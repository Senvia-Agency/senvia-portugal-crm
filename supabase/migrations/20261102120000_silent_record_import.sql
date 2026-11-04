-- ============================================================
-- Silent import of clients, proposals and sales from a spreadsheet
-- ============================================================
-- Importing history must not behave like new business: a plain insert fires
-- the "client/proposal/sale created" automations (emails, WhatsApp) for every
-- line. notify_automation_trigger() already skips when the transaction-local
-- flag app.skip_lead_side_effects is on (set today only by import_leads_bulk);
-- this function sets the same flag around a bulk insert into one of the three
-- tables.
--
-- SECURITY INVOKER on purpose: the insert runs as the calling user, so RLS
-- (organization isolation, permissions, MFA) applies exactly as in the app.
-- Only the columns present in the first row are inserted, so every other
-- column keeps its default and the code triggers still number the records.
-- The caller sends the same keys in every row.
--
-- What the caller sets on sales to keep them quiet (not done here):
-- fiscal_auto_invoices/receipts/email = false, has_recurring = false,
-- meta_capi_purchase_sent_at = now().

CREATE OR REPLACE FUNCTION public.import_records_silently(p_table text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  _columns text;
  _inserted jsonb;
BEGIN
  IF p_table NOT IN ('crm_clients', 'proposals', 'sales') THEN
    RAISE EXCEPTION 'Importação não permitida para %', p_table;
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;
  IF jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'No máximo 500 linhas por pedido';
  END IF;

  -- id and code are always generated here, never taken from the file.
  SELECT string_agg(format('%I', key), ', ')
    INTO _columns
    FROM jsonb_object_keys(p_rows -> 0) AS key
   WHERE key NOT IN ('id', 'code');

  -- Automations off for THIS transaction only.
  PERFORM set_config('app.skip_lead_side_effects', 'on', true);

  EXECUTE format(
    'WITH inserted AS (
       INSERT INTO public.%1$I (%2$s)
       SELECT %2$s FROM jsonb_populate_recordset(NULL::public.%1$I, $1)
       RETURNING *
     )
     SELECT coalesce(jsonb_agg(to_jsonb(inserted)), ''[]''::jsonb) FROM inserted',
    p_table, _columns
  )
  INTO _inserted
  USING p_rows;

  RETURN _inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_records_silently(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_records_silently(text, jsonb) TO authenticated;
