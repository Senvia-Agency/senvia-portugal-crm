-- Automatic KeyInvoice receipts (RC) for non-recurring sales.
--
-- The client sets the default ("Recibos automáticos ao marcar como pago" and
-- "Enviar por email"); every sale follows it unless the sale sets its own value.
-- When a payment of such a sale becomes paid, a receipt job is queued in the same
-- durable ledger the recurring sales use (public.invoices) and the
-- keyinvoice-fiscal-worker issues it against the sale's issued Fatura (FT), then
-- emails it. Only payments that become paid after the option is on are covered:
-- nothing is issued for payments that were already paid.
--
-- The job uses the manual receipt key ("receipt:<payment id>"), so the "Gerar
-- recibo" button and the automatic flow can never issue two receipts for one
-- payment. The decision is taken when the payment becomes paid: switching the option off
-- afterwards does not withdraw a receipt already queued. Recurring sales keep their own
-- recurrence settings and are skipped.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. Settings --------------------------------------------------------------------------------

ALTER TABLE public.crm_clients
  ADD COLUMN IF NOT EXISTS fiscal_auto_receipts boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fiscal_auto_email boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.crm_clients.fiscal_auto_receipts IS
  'Default for this client''s sales: issue the KeyInvoice receipt automatically when a payment is marked as paid.';
COMMENT ON COLUMN public.crm_clients.fiscal_auto_email IS
  'Default for this client''s sales: email the automatic receipt to the client.';

-- NULL = follow the client; true/false = this sale's own choice.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS fiscal_auto_receipts boolean,
  ADD COLUMN IF NOT EXISTS fiscal_auto_email boolean,
  ADD COLUMN IF NOT EXISTS fiscal_email_recipient text;

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_fiscal_email_recipient_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_fiscal_email_recipient_check CHECK (
  fiscal_email_recipient IS NULL
  OR (char_length(fiscal_email_recipient) <= 254
      AND fiscal_email_recipient ~ '^[^[:space:]@<>,;]+@[^[:space:]@<>,;]+\.[^[:space:]@<>,;]+$')
);

COMMENT ON COLUMN public.sales.fiscal_auto_receipts IS
  'Automatic receipt for this sale. NULL follows crm_clients.fiscal_auto_receipts.';
COMMENT ON COLUMN public.sales.fiscal_auto_email IS
  'Email the automatic receipt. NULL follows crm_clients.fiscal_auto_email.';
COMMENT ON COLUMN public.sales.fiscal_email_recipient IS
  'Optional address for this sale''s automatic receipts instead of the client''s email.';

-- 2. Alerts (best effort, never blocks a payment) ---------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_sale_receipt_alert(
  p_organization_id uuid,
  p_title text,
  p_body text,
  p_tag text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF v_key IS NULL THEN RETURN; END IF;
  PERFORM extensions.net.http_post(
    url := 'https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object(
      'organization_id', p_organization_id,
      'title', p_title,
      'body', left(p_body, 300),
      'url', '/financeiro/pagamentos',
      'tag', p_tag
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_sale_receipt_alert: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_sale_receipt_alert(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- 3. Queue ------------------------------------------------------------------------------------

-- Returns what happened (queued, skipped:<reason> or blocked:<reason>). A "blocked" payment
-- gets no job, so "Gerar recibo" stays available, and the organization receives an alert.
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

  IF NOT coalesce(v_sale.fiscal_auto_receipts, v_client.fiscal_auto_receipts, false) THEN
    RETURN 'skipped:manual';
  END IF;
  -- Recurring sales issue through their own recurrence settings.
  IF EXISTS (SELECT 1 FROM public.sale_recurrences r WHERE r.sale_id = v_sale.id) THEN
    RETURN 'skipped:recurring';
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

  SELECT * INTO v_source FROM public.invoices i
  WHERE i.organization_id = v_payment.organization_id
    AND i.sale_id = v_sale.id
    AND i.provider = 'keyinvoice'
    AND i.document_type = 'invoice'
    AND i.status = 'final'
    AND i.processing_status = 'issued'
    AND coalesce(i.total, 0) > 0
  ORDER BY i.issued_at DESC NULLS LAST, i.created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
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

  -- Email: the sale's own address, else the client's current email.
  v_email := coalesce(v_sale.fiscal_auto_email, v_client.fiscal_auto_email, false);
  v_custom := nullif(btrim(v_sale.fiscal_email_recipient), '');
  v_to := coalesce(v_custom, nullif(btrim(v_client.email), ''), nullif(btrim(v_source_client ->> 'email'), ''));

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
        'config', jsonb_build_object(
          'recipient_mode', CASE WHEN v_custom IS NOT NULL THEN 'custom' ELSE 'client' END,
          'recipient_email', coalesce(v_custom, ''),
          'fallback_email', ''))
    ),
    v_key, v_name, 'not_requested', now(), now()
  )
  ON CONFLICT (organization_id, fiscal_idempotency_key) DO NOTHING;

  RETURN CASE WHEN FOUND THEN 'queued' ELSE 'skipped:has_document' END;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_automatic_sale_receipt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_automatic_sale_receipt(uuid) TO service_role;

-- Marking a payment as paid must never fail because of the automatic receipt.
CREATE OR REPLACE FUNCTION public.queue_automatic_sale_receipt_after_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'paid'
     AND NEW.recurring_cycle_id IS NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    BEGIN
      PERFORM public.queue_automatic_sale_receipt(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'queue_automatic_sale_receipt: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_automatic_sale_receipt_after_payment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_queue_automatic_sale_receipt_trg ON public.sale_payments;
CREATE TRIGGER zz_queue_automatic_sale_receipt_trg
AFTER INSERT OR UPDATE OF status ON public.sale_payments
FOR EACH ROW
EXECUTE FUNCTION public.queue_automatic_sale_receipt_after_payment();

-- 4. Worker claim -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_automatic_sale_receipts(
  p_limit integer DEFAULT 25,
  p_worker_id uuid DEFAULT gen_random_uuid()
)
RETURNS SETOF public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT invoice.id
    FROM public.invoices invoice
    WHERE invoice.recurring_cycle_id IS NULL
      AND invoice.document_type = 'receipt'
      AND invoice.provider = 'keyinvoice'
      AND invoice.fiscal_snapshot ->> 'origin' = 'automatic_sale_receipt'
      AND invoice.processing_status IN ('pending', 'retry')
      AND coalesce(invoice.processing_next_retry_at, '-infinity'::timestamptz) <= now()
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices active
        WHERE active.related_invoice_id = invoice.related_invoice_id
          AND active.id <> invoice.id
          AND active.processing_status IN ('processing', 'reconciliation_required', 'reconciling')
      )
    ORDER BY invoice.created_at, invoice.id
    LIMIT greatest(1, least(coalesce(p_limit, 25), 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.invoices invoice
  SET
    processing_status = 'processing',
    processing_attempts = processing_attempts + 1,
    processing_claim_token = p_worker_id,
    processing_claimed_at = now(),
    processing_next_retry_at = NULL,
    processing_last_error = NULL,
    updated_at = now()
  FROM candidates
  WHERE invoice.id = candidates.id
  RETURNING invoice.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_automatic_sale_receipts(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automatic_sale_receipts(integer, uuid) TO service_role;

-- 5. Issued receipt shows on its payment ------------------------------------------------------
-- The Financeiro reads sale_payments.invoice_reference to know a payment already has its
-- document (and to hide "Gerar recibo").
CREATE OR REPLACE FUNCTION public.link_automatic_sale_receipt_to_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.processing_status = 'issued'
     AND OLD.processing_status IS DISTINCT FROM 'issued'
     AND NEW.payment_id IS NOT NULL
     AND NEW.fiscal_snapshot ->> 'origin' = 'automatic_sale_receipt' THEN
    UPDATE public.sale_payments
    SET invoice_reference = NEW.reference, updated_at = now()
    WHERE id = NEW.payment_id AND invoice_reference IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.link_automatic_sale_receipt_to_payment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS link_automatic_sale_receipt_to_payment_trg ON public.invoices;
CREATE TRIGGER link_automatic_sale_receipt_to_payment_trg
AFTER UPDATE OF processing_status ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.link_automatic_sale_receipt_to_payment();

NOTIFY pgrst, 'reload schema';
COMMIT;
