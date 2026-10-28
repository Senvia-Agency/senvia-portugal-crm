-- Automatic Fatura (FT) for non-recurring sales.
--
-- The client's "Documentos automáticos" now also issue the sale's own Fatura: an FT as soon
-- as the sale is created, or a Fatura-Recibo (FR) when the sale is already fully paid by
-- then. The receipts of its payments and the email follow the existing settings
-- (20261027100000). The keyinvoice-fiscal-worker issues the document with the same code and
-- idempotency key as the "Emitir Fatura" button, so the two can never issue twice.
--
-- The choice is taken when the sale is created (the client's default, copied to the sale);
-- the sale can still switch it. Sales created before this migration keep NULL and are
-- never issued unless someone turns it on for that sale. Recurring sales follow their
-- recurrence (20261027120000) and telecom organizations are not covered.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. Settings --------------------------------------------------------------------------------

ALTER TABLE public.crm_clients
  ADD COLUMN IF NOT EXISTS fiscal_auto_invoices boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.crm_clients.fiscal_auto_invoices IS
  'Default for this client''s new sales: issue the sale''s KeyInvoice Fatura (or Fatura-Recibo when already paid) automatically.';

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS fiscal_auto_invoices boolean,
  ADD COLUMN IF NOT EXISTS fiscal_invoice_last_error text;
COMMENT ON COLUMN public.sales.fiscal_auto_invoices IS
  'Issue this sale''s Fatura automatically. Copied from the client when the sale is created; NULL on older sales (never automatic).';
COMMENT ON COLUMN public.sales.fiscal_invoice_last_error IS
  'Why the automatic Fatura of this sale stopped. While set, the worker does not try again.';

-- The client's default, copied while the sale is created. Recurring sales are left alone:
-- their first month follows the recurrence.
CREATE OR REPLACE FUNCTION public.copy_client_auto_invoice_to_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.fiscal_auto_invoices IS NULL
     AND NEW.client_id IS NOT NULL
     AND NEW.has_recurring IS NOT TRUE THEN
    SELECT client.fiscal_auto_invoices INTO NEW.fiscal_auto_invoices
    FROM public.crm_clients client
    WHERE client.id = NEW.client_id AND client.organization_id = NEW.organization_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.copy_client_auto_invoice_to_sale() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS copy_client_auto_invoice_to_sale_trg ON public.sales;
CREATE TRIGGER copy_client_auto_invoice_to_sale_trg
BEFORE INSERT ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.copy_client_auto_invoice_to_sale();

-- After a review (missing NIF fixed, KeyInvoice back online...), try the sale's Fatura again.
CREATE OR REPLACE FUNCTION public.retry_automatic_sale_invoice(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id uuid;
BEGIN
  SELECT organization_id INTO v_organization_id FROM public.sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.meets_mfa_policy(auth.uid())
     OR NOT public.has_module_permission(auth.uid(), v_organization_id, 'finance', 'invoices', 'issue') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.sales SET fiscal_invoice_last_error = NULL WHERE id = p_sale_id;
END;
$$;
REVOKE ALL ON FUNCTION public.retry_automatic_sale_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_automatic_sale_invoice(uuid) TO authenticated;

-- 2. Worker: sales whose Fatura is due ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_due_automatic_sale_invoices(p_limit integer DEFAULT 25)
RETURNS TABLE (
  sale_id uuid,
  organization_id uuid,
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
    sale.id,
    sale.organization_id,
    coalesce(sale.fiscal_auto_email, client.fiscal_auto_email, false),
    jsonb_build_object(
      'recipient_mode', CASE WHEN nullif(btrim(sale.fiscal_email_recipient), '') IS NOT NULL THEN 'custom' ELSE 'client' END,
      'recipient_email', coalesce(nullif(btrim(sale.fiscal_email_recipient), ''), ''),
      'fallback_email', '')
  FROM public.sales sale
  JOIN public.organizations org ON org.id = sale.organization_id
  LEFT JOIN public.crm_clients client
    ON client.id = sale.client_id AND client.organization_id = sale.organization_id
  WHERE sale.fiscal_auto_invoices
    AND sale.fiscal_invoice_last_error IS NULL
    -- Let the creation finish (items and payments) before issuing.
    AND sale.created_at <= now() - interval '2 minutes'
    AND coalesce(sale.status, '') NOT IN ('cancelled', 'canceled')
    AND sale.invoicexpress_id IS NULL
    AND coalesce(sale.gross_value, sale.total_value, 0) > 0
    AND org.billing_provider = 'keyinvoice'
    AND org.niche IS DISTINCT FROM 'telecom'
    AND NOT EXISTS (SELECT 1 FROM public.sale_recurrences recurrence WHERE recurrence.sale_id = sale.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.invoices invoice
      WHERE invoice.organization_id = sale.organization_id
        AND invoice.sale_id = sale.id
        AND invoice.recurring_cycle_id IS NULL
        AND invoice.document_type IN ('invoice', 'invoice_receipt')
        AND invoice.processing_status NOT IN ('void', 'cancelled')
    )
  ORDER BY sale.created_at, sale.id
  LIMIT greatest(1, least(coalesce(p_limit, 25), 100));
END;
$$;
REVOKE ALL ON FUNCTION public.list_due_automatic_sale_invoices(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_due_automatic_sale_invoices(integer) TO service_role;

-- 3. Receipts ---------------------------------------------------------------------------------
-- A payment of an automatic-invoice sale may be paid before its Fatura exists: it waits
-- quietly ('waiting:invoice') instead of alerting, and is queued when the Fatura is issued.

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
    -- The Fatura is on its way (first month, or an automatic-invoice sale); issuing it
    -- queues this receipt.
    IF v_first_month OR v_sale.fiscal_auto_invoices IS TRUE THEN RETURN 'waiting:invoice'; END IF;
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

-- When the sale's own Fatura is issued (by the worker or the "Emitir Fatura" button), the
-- receipts of the payments already paid follow — for the first month of an automatic
-- recurring sale and for automatic-invoice sales. Older sales are never touched.
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
     AND (
       EXISTS (
         SELECT 1 FROM public.sale_recurrences recurrence
         WHERE recurrence.sale_id = NEW.sale_id
           AND recurrence.organization_id = NEW.organization_id
           AND recurrence.fiscal_include_sale
       )
       OR EXISTS (
         SELECT 1 FROM public.sales sale
         WHERE sale.id = NEW.sale_id
           AND sale.organization_id = NEW.organization_id
           AND sale.fiscal_auto_invoices
       )
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

NOTIFY pgrst, 'reload schema';
COMMIT;
