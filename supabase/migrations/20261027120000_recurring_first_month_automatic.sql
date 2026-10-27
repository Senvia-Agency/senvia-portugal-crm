-- The first month of a recurring sale is automatic too.
--
-- A recurring sale's first month is the sale itself (its own payments plus any one-off
-- items); only the renewals are cycles. Until now only cycles were issued automatically,
-- so a sale created with automatic issuance still needed its first Fatura by hand.
--
-- A recurrence marked fiscal_include_sale (only while the sale is being created with
-- automatic issuance) now issues the sale's own documents with the same policy and email
-- settings as its cycles:
--   invoice_then_receipt       the sale's Fatura (FT) as soon as the sale starts, then a
--                              Recibo (RC) for each of its payments marked as paid;
--   invoice_receipt_when_paid  the sale's Fatura-Recibo (FR) once its payments are paid.
-- The keyinvoice-fiscal-worker issues the FT/FR with the same idempotency key as the
-- "Emitir Fatura" button, so the two can never issue twice. Existing recurrences are never
-- marked, so nothing is issued retroactively.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. Settings --------------------------------------------------------------------------------

ALTER TABLE public.sale_recurrences
  ADD COLUMN IF NOT EXISTS fiscal_include_sale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fiscal_sale_last_error text;

COMMENT ON COLUMN public.sale_recurrences.fiscal_include_sale IS
  'The sale itself (first month and one-off items) is issued automatically like the cycles. Set only when the sale is created with automatic issuance.';
COMMENT ON COLUMN public.sale_recurrences.fiscal_sale_last_error IS
  'Why the automatic document of the sale itself stopped. While set, the worker does not try again.';

-- 2. Marked while the sale is created ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.include_sale_in_recurring_fiscal(p_recurrence_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recurrence public.sale_recurrences%rowtype;
  v_sale public.sales%rowtype;
BEGIN
  SELECT * INTO v_recurrence FROM public.sale_recurrences WHERE id = p_recurrence_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale recurrence not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.meets_mfa_policy(auth.uid())
     OR NOT public.has_module_permission(
       auth.uid(), v_recurrence.organization_id, 'finance', 'invoices', 'issue'
     ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_recurrence.fiscal_include_sale THEN RETURN true; END IF;
  IF v_recurrence.fiscal_mode IS DISTINCT FROM 'automatic' THEN RETURN false; END IF;

  SELECT * INTO v_sale FROM public.sales
  WHERE id = v_recurrence.sale_id AND organization_id = v_recurrence.organization_id;
  -- Only a sale being created right now. An older sale may already have been invoiced,
  -- here or outside Senvia, and must never be issued again.
  IF NOT FOUND
     OR coalesce(v_sale.status, '') IN ('cancelled', 'canceled')
     OR v_sale.created_at < now() - interval '1 hour'
     OR v_sale.invoicexpress_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.sale_recurring_cycles cycle WHERE cycle.recurrence_id = v_recurrence.id)
     OR EXISTS (
       SELECT 1 FROM public.invoices invoice
       WHERE invoice.organization_id = v_sale.organization_id
         AND invoice.sale_id = v_sale.id
         AND invoice.recurring_cycle_id IS NULL
         AND invoice.document_type IN ('invoice', 'invoice_receipt')
         AND invoice.processing_status NOT IN ('void', 'cancelled')
     ) THEN
    RETURN false;
  END IF;

  UPDATE public.sale_recurrences
  SET fiscal_include_sale = true, fiscal_sale_last_error = NULL
  WHERE id = v_recurrence.id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.include_sale_in_recurring_fiscal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.include_sale_in_recurring_fiscal(uuid) TO authenticated;

-- After a review (missing NIF fixed, KeyInvoice back online...), try the sale's document again.
CREATE OR REPLACE FUNCTION public.retry_recurring_sale_document(p_recurrence_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id uuid;
BEGIN
  SELECT organization_id INTO v_organization_id FROM public.sale_recurrences WHERE id = p_recurrence_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale recurrence not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.meets_mfa_policy(auth.uid())
     OR NOT public.has_module_permission(auth.uid(), v_organization_id, 'finance', 'invoices', 'issue') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.sale_recurrences
  SET fiscal_sale_last_error = NULL
  WHERE id = p_recurrence_id AND fiscal_include_sale;
END;
$$;
REVOKE ALL ON FUNCTION public.retry_recurring_sale_document(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_recurring_sale_document(uuid) TO authenticated;

-- 3. Worker: sales whose own document is due -------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_due_recurring_sale_documents(p_limit integer DEFAULT 25)
RETURNS TABLE (
  recurrence_id uuid,
  sale_id uuid,
  organization_id uuid,
  document_kind text,
  auto_email boolean,
  email_config jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    recurrence.id,
    recurrence.sale_id,
    recurrence.organization_id,
    CASE WHEN recurrence.fiscal_document_policy = 'invoice_receipt_when_paid' THEN 'invoice_receipt' ELSE 'invoice' END,
    recurrence.fiscal_auto_email,
    coalesce(recurrence.fiscal_email_config, '{}'::jsonb)
  FROM public.sale_recurrences recurrence
  JOIN public.sales sale
    ON sale.id = recurrence.sale_id AND sale.organization_id = recurrence.organization_id
  WHERE recurrence.fiscal_include_sale
    AND recurrence.fiscal_mode = 'automatic'
    AND recurrence.fiscal_sale_last_error IS NULL
    AND recurrence.anchor_date <= (clock_timestamp() AT TIME ZONE 'Europe/Lisbon')::date
    AND coalesce(sale.status, '') NOT IN ('cancelled', 'canceled')
    AND sale.invoicexpress_id IS NULL
    AND coalesce(sale.gross_value, sale.total_value, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.invoices invoice
      WHERE invoice.organization_id = sale.organization_id
        AND invoice.sale_id = sale.id
        AND invoice.recurring_cycle_id IS NULL
        AND invoice.document_type IN ('invoice', 'invoice_receipt')
        AND invoice.processing_status NOT IN ('void', 'cancelled')
    )
    AND (
      recurrence.fiscal_document_policy = 'invoice_then_receipt'
      -- A Fatura-Recibo only once the sale's own payments cover it.
      OR (
        SELECT coalesce(sum(payment.amount - coalesce(payment.reversed_amount, 0)), 0)
        FROM public.sale_payments payment
        WHERE payment.organization_id = sale.organization_id
          AND payment.sale_id = sale.id
          AND payment.recurring_cycle_id IS NULL
          AND payment.status = 'paid'
          AND coalesce(payment.reversal_status, 'none') = 'none'
      ) >= coalesce(sale.gross_value, sale.total_value)
    )
  ORDER BY recurrence.created_at, recurrence.id
  LIMIT greatest(1, least(coalesce(p_limit, 25), 100));
END;
$$;
REVOKE ALL ON FUNCTION public.list_due_recurring_sale_documents(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_due_recurring_sale_documents(integer) TO service_role;

-- 4. Receipts of the first month --------------------------------------------------------------
-- Same queue as the non-recurring sales (20261027100000). A recurring sale is covered only
-- when its recurrence includes the sale with the Fatura + Recibo policy, and then the
-- recurrence's email settings apply.

CREATE OR REPLACE FUNCTION public.queue_automatic_sale_receipt(p_payment_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.sale_payments%rowtype;
  v_sale public.sales%rowtype;
  v_client public.crm_clients%rowtype;
  v_recurrence public.sale_recurrences%rowtype;
  v_first_month boolean := false;
  v_org public.organizations%rowtype;
  v_source public.invoices%rowtype;
  v_series jsonb;
  v_key text;
  v_reserved numeric(12, 2);
  v_source_client jsonb;
  v_name text;
  v_vatin text;
  v_custom text;
  v_to text;
  v_email boolean;
  v_email_config jsonb;
  v_today date := (clock_timestamp() AT TIME ZONE 'Europe/Lisbon')::date;
  v_fiscal_date date;
  v_label text;
BEGIN
  SELECT * INTO v_payment FROM public.sale_payments WHERE id = p_payment_id;
  IF NOT FOUND
     OR v_payment.status IS DISTINCT FROM 'paid'
     OR v_payment.recurring_cycle_id IS NOT NULL
     OR coalesce(v_payment.reversal_status, 'none') <> 'none'
     OR coalesce(v_payment.reversed_amount, 0) > 0
     OR coalesce(v_payment.amount, 0) <= 0 THEN
    RETURN 'skipped:payment';
  END IF;
  IF v_payment.invoice_reference IS NOT NULL THEN RETURN 'skipped:has_document'; END IF;

  SELECT * INTO v_sale FROM public.sales
  WHERE id = v_payment.sale_id AND organization_id = v_payment.organization_id;
  IF NOT FOUND THEN RETURN 'skipped:sale'; END IF;
  IF v_sale.client_id IS NOT NULL THEN
    SELECT * INTO v_client FROM public.crm_clients WHERE id = v_sale.client_id;
  END IF;

  SELECT * INTO v_recurrence FROM public.sale_recurrences r
  WHERE r.sale_id = v_sale.id
  ORDER BY r.created_at DESC
  LIMIT 1;
  IF FOUND THEN
    -- Recurring sales issue through their recurrence settings: renewals as cycles, and the
    -- sale itself only when it was created with automatic issuance.
    IF NOT (v_recurrence.fiscal_include_sale
            AND v_recurrence.fiscal_mode = 'automatic'
            AND v_recurrence.fiscal_document_policy = 'invoice_then_receipt') THEN
      RETURN 'skipped:recurring';
    END IF;
    v_first_month := true;
  ELSIF NOT coalesce(v_sale.fiscal_auto_receipts, v_client.fiscal_auto_receipts, false) THEN
    RETURN 'skipped:manual';
  END IF;

  v_key := 'receipt:' || v_payment.id::text;
  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.organization_id = v_payment.organization_id
      AND (i.fiscal_idempotency_key = v_key
           OR (i.payment_id = v_payment.id
               AND i.document_type IN ('receipt', 'invoice_receipt')
               AND i.processing_status NOT IN ('failed', 'cancelled', 'void')))
  ) THEN
    RETURN 'skipped:has_document';
  END IF;
  -- A sale settled by a Fatura-Recibo needs no receipt.
  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.sale_id = v_sale.id AND i.document_type = 'invoice_receipt'
      AND i.recurring_cycle_id IS NULL
      AND i.processing_status NOT IN ('failed', 'cancelled', 'void')
  ) THEN
    RETURN 'skipped:invoice_receipt';
  END IF;

  v_label := coalesce(nullif(btrim(v_client.company), ''), nullif(btrim(v_client.name), ''), 'Cliente')
    || ' · venda ' || coalesce(v_sale.code, '');

  SELECT * INTO v_org FROM public.organizations WHERE id = v_payment.organization_id;
  IF v_org.billing_provider IS DISTINCT FROM 'keyinvoice'
     OR v_org.integrations_enabled -> 'keyinvoice' IS DISTINCT FROM 'true'::jsonb
     OR v_org.tem_keyinvoice_password IS NOT TRUE THEN
    PERFORM public.notify_sale_receipt_alert(v_org.id, 'Recibo automático não emitido',
      v_label || ': a integração KeyInvoice não está ativa. Emita o recibo manualmente.', 'sale-receipt-' || v_payment.id);
    RETURN 'blocked:provider';
  END IF;
  v_series := v_org.keyinvoice_series_config -> 'receipt';
  IF jsonb_typeof(v_series) IS DISTINCT FROM 'object'
     OR nullif(btrim(v_series ->> 'series'), '') IS NULL
     OR nullif(btrim(v_series ->> 'provider_document_type_code'), '') IS NULL THEN
    PERFORM public.notify_sale_receipt_alert(v_org.id, 'Recibo automático não emitido',
      v_label || ': a série de recibos do KeyInvoice não está configurada.', 'sale-receipt-' || v_payment.id);
    RETURN 'blocked:series';
  END IF;

  -- The sale's own Fatura, never a renewal's.
  SELECT * INTO v_source FROM public.invoices i
  WHERE i.organization_id = v_payment.organization_id
    AND i.sale_id = v_sale.id
    AND i.recurring_cycle_id IS NULL
    AND i.provider = 'keyinvoice'
    AND i.document_type = 'invoice'
    AND i.status = 'final'
    AND i.processing_status = 'issued'
    AND coalesce(i.total, 0) > 0
  ORDER BY i.issued_at DESC NULLS LAST, i.created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    -- The first month's Fatura is on its way; issuing it queues this receipt.
    IF v_first_month THEN RETURN 'waiting:invoice'; END IF;
    PERFORM public.notify_sale_receipt_alert(v_org.id, 'Recibo automático não emitido',
      v_label || ': a venda não tem Fatura KeyInvoice emitida. Emita a Fatura e depois o recibo.', 'sale-receipt-' || v_payment.id);
    RETURN 'blocked:no_invoice';
  END IF;

  -- Same lock as the manual "Gerar recibo": the two never reserve the same Fatura at once.
  PERFORM pg_advisory_xact_lock(hashtextextended('keyinvoice-manual-receipt:' || v_source.id::text, 0));

  SELECT coalesce(sum(i.total), 0) INTO v_reserved
  FROM public.invoices i
  WHERE i.organization_id = v_payment.organization_id
    AND i.related_invoice_id = v_source.id
    AND i.document_type = 'receipt'
    AND i.processing_status NOT IN ('failed', 'cancelled', 'void');
  IF round(v_reserved + v_payment.amount, 2) > round(v_source.total, 2) THEN
    PERFORM public.notify_sale_receipt_alert(v_org.id, 'Recibo automático não emitido',
      v_label || ': o valor excede o que falta liquidar na Fatura ' || coalesce(v_source.reference, '') || '.', 'sale-receipt-' || v_payment.id);
    RETURN 'blocked:amount';
  END IF;

  -- The receipt goes to the Fatura's fiscal recipient (name and NIF as issued).
  v_source_client := coalesce(v_source.raw_data #> '{snapshot,client}', v_source.fiscal_snapshot -> 'client', '{}'::jsonb);
  v_name := coalesce(nullif(btrim(v_source_client ->> 'name'), ''), nullif(btrim(v_source.client_name), ''));
  v_vatin := coalesce(nullif(btrim(v_source_client ->> 'vatin'), ''), nullif(btrim(v_source_client ->> 'nif'), ''));
  IF v_name IS NULL OR v_vatin IS NULL THEN
    PERFORM public.notify_sale_receipt_alert(v_org.id, 'Recibo automático não emitido',
      v_label || ': a Fatura de origem não tem nome e NIF do cliente.', 'sale-receipt-' || v_payment.id);
    RETURN 'blocked:client';
  END IF;

  IF v_first_month THEN
    -- Exactly as the recurrence emails its cycles.
    v_email := coalesce(v_recurrence.fiscal_auto_email, false);
    v_email_config := coalesce(v_recurrence.fiscal_email_config, '{}'::jsonb);
    v_custom := CASE WHEN v_email_config ->> 'recipient_mode' = 'custom'
      THEN nullif(btrim(v_email_config ->> 'recipient_email'), '') END;
    v_to := coalesce(v_custom, nullif(btrim(v_client.email), ''), nullif(btrim(v_source_client ->> 'email'), ''),
      nullif(btrim(v_email_config ->> 'fallback_email'), ''));
  ELSE
    -- The sale's own address, else the client's current email.
    v_email := coalesce(v_sale.fiscal_auto_email, v_client.fiscal_auto_email, false);
    v_custom := nullif(btrim(v_sale.fiscal_email_recipient), '');
    v_to := coalesce(v_custom, nullif(btrim(v_client.email), ''), nullif(btrim(v_source_client ->> 'email'), ''));
    v_email_config := jsonb_build_object(
      'recipient_mode', CASE WHEN v_custom IS NOT NULL THEN 'custom' ELSE 'client' END,
      'recipient_email', coalesce(v_custom, ''),
      'fallback_email', '');
  END IF;

  -- Never before the Fatura, never in the future.
  v_fiscal_date := least(greatest(coalesce(v_payment.payment_date, v_today), coalesce(v_source.date, v_payment.payment_date, v_today)), v_today);

  INSERT INTO public.invoices (
    organization_id, sale_id, payment_id, recurring_cycle_id, related_invoice_id, invoicexpress_id,
    provider, provider_document_type_code, provider_series, document_type, reference, total, status,
    processing_status, processing_attempts, date, raw_data, fiscal_snapshot, fiscal_idempotency_key,
    client_name, email_status, created_at, updated_at
  ) VALUES (
    v_payment.organization_id, v_sale.id, v_payment.id, NULL, v_source.id, NULL,
    'keyinvoice', v_series ->> 'provider_document_type_code', v_series ->> 'series', 'receipt', NULL, v_payment.amount, 'queued',
    'pending', 0, v_fiscal_date,
    jsonb_build_object('source', 'keyinvoice', 'origin', 'automatic_sale_receipt'),
    jsonb_build_object(
      'schemaVersion', 1,
      'origin', 'automatic_sale_receipt',
      'kind', 'receipt',
      'fiscalDate', v_fiscal_date,
      'currency', 'EUR',
      'amount', v_payment.amount,
      'paymentId', v_payment.id,
      'saleId', v_sale.id,
      'recurringCycleId', NULL,
      'recurrenceId', CASE WHEN v_first_month THEN v_recurrence.id END,
      'originalDocument', jsonb_build_object(
        'invoiceId', v_source.id, 'reference', v_source.reference,
        'docType', v_source.provider_document_type_code, 'docSeries', v_source.provider_series,
        'docNum', v_source.provider_document_number),
      'payment', jsonb_build_object(
        'id', v_payment.id, 'status', v_payment.status, 'amount', v_payment.amount,
        'reversalStatus', coalesce(v_payment.reversal_status, 'none'),
        'reversedAmount', coalesce(v_payment.reversed_amount, 0)),
      'client', jsonb_build_object(
        'name', v_name, 'company', v_name, 'vatin', v_vatin, 'email', v_to,
        'address', v_source_client -> 'address', 'postalCode', coalesce(v_source_client -> 'postalCode', v_source_client -> 'postal_code'),
        'locality', v_source_client -> 'locality', 'countryCode', coalesce(v_source_client -> 'countryCode', v_source_client -> 'country_code')),
      'email', jsonb_build_object(
        'enabled', v_email,
        'recipientFallback', v_to,
        'config', v_email_config)
    ),
    v_key, v_name, 'not_requested', now(), now()
  )
  ON CONFLICT (organization_id, fiscal_idempotency_key) DO NOTHING;

  RETURN CASE WHEN FOUND THEN 'queued' ELSE 'skipped:has_document' END;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_automatic_sale_receipt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_automatic_sale_receipt(uuid) TO service_role;

-- A first-month payment may be paid before its Fatura exists (paid at the sale's creation,
-- or the Fatura stopped for review). When the sale's Fatura is issued, by the worker or the
-- "Emitir Fatura" button, the receipts of the payments already paid follow.
CREATE OR REPLACE FUNCTION public.queue_first_month_receipts_after_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment_id uuid;
BEGIN
  IF NEW.processing_status = 'issued'
     AND OLD.processing_status IS DISTINCT FROM 'issued'
     AND NEW.document_type = 'invoice'
     AND NEW.provider = 'keyinvoice'
     AND NEW.recurring_cycle_id IS NULL
     AND NEW.sale_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.sale_recurrences recurrence
       WHERE recurrence.sale_id = NEW.sale_id
         AND recurrence.organization_id = NEW.organization_id
         AND recurrence.fiscal_include_sale
     ) THEN
    FOR v_payment_id IN
      SELECT payment.id FROM public.sale_payments payment
      WHERE payment.organization_id = NEW.organization_id
        AND payment.sale_id = NEW.sale_id
        AND payment.recurring_cycle_id IS NULL
        AND payment.status = 'paid'
        AND payment.invoice_reference IS NULL
      ORDER BY payment.payment_date, payment.created_at
    LOOP
      BEGIN
        PERFORM public.queue_automatic_sale_receipt(v_payment_id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'queue_first_month_receipts_after_invoice: %', SQLERRM;
      END;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_first_month_receipts_after_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_queue_first_month_receipts_after_invoice_trg ON public.invoices;
CREATE TRIGGER zz_queue_first_month_receipts_after_invoice_trg
AFTER UPDATE OF processing_status ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.queue_first_month_receipts_after_invoice();

NOTIFY pgrst, 'reload schema';
COMMIT;
