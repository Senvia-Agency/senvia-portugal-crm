-- Automatic fiscal issuance starts after existing and current cycles.
-- Previously issued documents are never altered. Existing automatic
-- recurrences receive a conservative boundary at deployment so an older
-- unpaid or externally invoiced cycle cannot be issued retroactively.
BEGIN;

ALTER TABLE public.sale_recurrences
  ADD COLUMN IF NOT EXISTS fiscal_auto_start_after date;

COMMENT ON COLUMN public.sale_recurrences.fiscal_auto_start_after IS
  'The last cycle period start already present, or the Lisbon date, when automatic fiscal issuance was enabled. Only later cycle periods may be issued automatically.';

CREATE OR REPLACE FUNCTION public.set_recurring_fiscal_activation_start()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_latest_period date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.fiscal_mode IS DISTINCT FROM 'automatic' THEN RETURN NEW; END IF;
  ELSIF NEW.fiscal_mode IS DISTINCT FROM 'automatic'
     OR OLD.fiscal_mode IS NOT DISTINCT FROM 'automatic' THEN
    RETURN NEW;
  END IF;

  SELECT max(cycle.period_start) INTO v_latest_period
  FROM public.sale_recurring_cycles cycle
  WHERE cycle.recurrence_id = NEW.id;

  NEW.fiscal_auto_start_after := greatest(
    (clock_timestamp() AT TIME ZONE 'Europe/Lisbon')::date,
    coalesce(v_latest_period, '-infinity'::date)
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_recurring_fiscal_activation_start()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS set_recurring_fiscal_activation_start_trg
  ON public.sale_recurrences;
CREATE TRIGGER set_recurring_fiscal_activation_start_trg
BEFORE INSERT OR UPDATE OF fiscal_mode ON public.sale_recurrences
FOR EACH ROW
EXECUTE FUNCTION public.set_recurring_fiscal_activation_start();

-- Fail closed for recurrences that were already automatic before this guard.
-- An existing cycle may have been invoiced outside Senvia; the local ledger
-- cannot prove otherwise. Only periods created after this boundary qualify.
UPDATE public.sale_recurrences recurrence
SET fiscal_auto_start_after = greatest(
  (clock_timestamp() AT TIME ZONE 'Europe/Lisbon')::date,
  coalesce((
    SELECT max(cycle.period_start)
    FROM public.sale_recurring_cycles cycle
    WHERE cycle.recurrence_id = recurrence.id
  ), '-infinity'::date)
)
WHERE recurrence.fiscal_mode = 'automatic'
  AND recurrence.fiscal_auto_start_after IS NULL;

-- Keep unissued work visible for manual reconciliation instead of leaving a
-- pending job that will never be claimed. Issued documents remain untouched.
UPDATE public.invoices invoice
SET processing_status = 'manual_review',
    processing_last_error = 'O ciclo já existia antes da proteção da emissão automática; confirmar documentos externos manualmente.',
    processing_next_retry_at = NULL,
    updated_at = now()
FROM public.sale_recurring_cycles cycle
JOIN public.sale_recurrences recurrence ON recurrence.id = cycle.recurrence_id
WHERE invoice.recurring_cycle_id = cycle.id
  AND recurrence.fiscal_mode = 'automatic'
  AND cycle.period_start <= recurrence.fiscal_auto_start_after
  AND invoice.processing_status IN ('pending', 'retry');

UPDATE public.sale_recurring_cycles cycle
SET fiscal_status = 'manual_review',
    fiscal_last_error = 'O ciclo já existia antes da proteção da emissão automática; confirmar documentos externos manualmente.',
    fiscal_next_retry_at = NULL
FROM public.sale_recurrences recurrence
WHERE recurrence.id = cycle.recurrence_id
  AND recurrence.fiscal_mode = 'automatic'
  AND cycle.period_start <= recurrence.fiscal_auto_start_after
  AND cycle.fiscal_status IN ('pending', 'retry');

CREATE OR REPLACE FUNCTION public.schedule_recurring_fiscal_documents_for_cycle(
  p_cycle_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cycle public.sale_recurring_cycles%rowtype;
  v_recurrence public.sale_recurrences%rowtype;
  v_org public.organizations%rowtype;
  v_primary public.invoices%rowtype;
  v_payment public.sale_payments%rowtype;
  v_net_paid numeric(12, 2);
  v_today date := (clock_timestamp() AT TIME ZONE 'Europe/Lisbon')::date;
BEGIN
  SELECT * INTO v_cycle
  FROM public.sale_recurring_cycles
  WHERE id = p_cycle_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO STRICT v_recurrence
  FROM public.sale_recurrences
  WHERE id = v_cycle.recurrence_id;
  IF v_recurrence.fiscal_mode <> 'automatic' OR v_cycle.due_date > v_today
     OR (v_recurrence.fiscal_auto_start_after IS NOT NULL
         AND v_cycle.period_start <= v_recurrence.fiscal_auto_start_after) THEN
    RETURN;
  END IF;

  SELECT * INTO STRICT v_org
  FROM public.organizations
  WHERE id = v_cycle.organization_id;

  IF v_org.billing_provider IS DISTINCT FROM 'keyinvoice' THEN
    UPDATE public.sale_recurring_cycles
    SET fiscal_status = 'manual_review',
        fiscal_last_error = 'A integração fiscal ativa não é KeyInvoice.'
    WHERE id = v_cycle.id;
    RETURN;
  END IF;

  -- A money reversal does not by itself prove fiscal cancellation. Until the
  -- KeyInvoice demo contract for partial NCs is homologated, every reversal,
  -- including a confirmed refund, requires human review. The commercial cycle
  -- remains paid; this only blocks further automatic fiscal actions.
  IF EXISTS (
    SELECT 1 FROM public.sale_payments payment
    WHERE payment.recurring_cycle_id = v_cycle.id
      AND payment.reversal_status <> 'none'
  ) THEN
    UPDATE public.sale_recurring_cycles
    SET
      fiscal_status = 'manual_review',
      fiscal_last_error = 'Existe um reembolso, reversão ou chargeback que exige revisão fiscal; nenhuma NC foi emitida automaticamente.',
      fiscal_snapshot = CASE WHEN fiscal_snapshot = '{}'::jsonb THEN
        jsonb_build_object(
          'schema_version', 1,
          'captured_at', clock_timestamp(),
          'pending_adjustment', jsonb_build_object('requires_manual_review', true)
        ) ELSE fiscal_snapshot END
    WHERE id = v_cycle.id;
    RETURN;
  END IF;

  SELECT coalesce(sum(
    CASE
      WHEN payment.status = 'paid' THEN
        payment.amount - CASE
          WHEN payment.reversal_status IN ('refunded', 'chargeback', 'reversed')
            THEN payment.reversed_amount
          ELSE 0
        END
      ELSE 0
    END
  ), 0)
  INTO v_net_paid
  FROM public.sale_payments payment
  WHERE payment.recurring_cycle_id = v_cycle.id;

  SELECT * INTO v_primary
  FROM public.invoices invoice
  WHERE invoice.recurring_cycle_id = v_cycle.id
    AND invoice.document_type IN ('invoice', 'invoice_receipt')
    AND invoice.processing_status NOT IN ('cancelled', 'void')
  ORDER BY invoice.created_at, invoice.id
  LIMIT 1;

  IF v_recurrence.fiscal_document_policy = 'invoice_then_receipt' THEN
    IF v_primary.id IS NULL THEN
      v_primary := public._queue_recurring_fiscal_document(
        v_cycle.id, 'invoice', NULL, NULL, '{}'::jsonb
      );
    END IF;

    -- Receipts can only be queued after the source FT has a definitive fiscal
    -- identity. A completion trigger calls this scheduler again.
    IF v_primary.document_type = 'invoice' AND v_primary.processing_status = 'issued' THEN
      FOR v_payment IN
        SELECT * FROM public.sale_payments payment
        WHERE payment.recurring_cycle_id = v_cycle.id
          AND payment.status = 'paid'
          AND payment.reversal_status = 'none'
        ORDER BY payment.payment_date, payment.id
      LOOP
        PERFORM public._queue_recurring_fiscal_document(
          v_cycle.id, 'receipt', v_payment.id, v_primary.id, '{}'::jsonb
        );
      END LOOP;
    END IF;
  ELSE
    IF v_primary.id IS NOT NULL AND v_primary.document_type = 'invoice' THEN
      UPDATE public.sale_recurring_cycles
      SET fiscal_status = 'manual_review',
          fiscal_last_error = 'Já existe uma FT; não é permitido emitir FR para o mesmo ciclo.'
      WHERE id = v_cycle.id;
      RETURN;
    END IF;

    IF v_net_paid >= v_cycle.amount AND v_cycle.status = 'paid' AND v_primary.id IS NULL THEN
      PERFORM public._queue_recurring_fiscal_document(
        v_cycle.id, 'invoice_receipt', NULL, NULL, '{}'::jsonb
      );
    END IF;
  END IF;

  PERFORM public.refresh_recurring_cycle_fiscal_status(v_cycle.id);
EXCEPTION
  WHEN OTHERS THEN
    UPDATE public.sale_recurring_cycles
    SET fiscal_status = 'manual_review',
        fiscal_last_error = left(SQLERRM, 2000)
    WHERE id = p_cycle_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_due_recurring_fiscal_documents(
  p_limit integer DEFAULT 250
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cycle record;
  v_scheduled integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  FOR v_cycle IN
    SELECT cycle.id
    FROM public.sale_recurring_cycles cycle
    JOIN public.sale_recurrences recurrence
      ON recurrence.id = cycle.recurrence_id
     AND recurrence.organization_id = cycle.organization_id
     AND recurrence.sale_id = cycle.sale_id
    WHERE recurrence.fiscal_mode = 'automatic'
      AND (recurrence.fiscal_auto_start_after IS NULL
           OR cycle.period_start > recurrence.fiscal_auto_start_after)
      AND cycle.due_date <= (clock_timestamp() AT TIME ZONE 'Europe/Lisbon')::date
      AND cycle.fiscal_status <> 'manual_review'
      AND (
        recurrence.fiscal_document_policy = 'invoice_then_receipt'
        OR (
          recurrence.fiscal_document_policy = 'invoice_receipt_when_paid'
          AND cycle.status = 'paid'
          AND NOT EXISTS (
            SELECT 1
            FROM public.sale_payments reversed_payment
            WHERE reversed_payment.recurring_cycle_id = cycle.id
              AND reversed_payment.reversal_status <> 'none'
          )
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.invoices invoice
        WHERE invoice.recurring_cycle_id = cycle.id
          AND invoice.document_type IN ('invoice', 'invoice_receipt')
          AND invoice.processing_status NOT IN ('cancelled', 'void')
      )
    ORDER BY cycle.due_date, cycle.id
    LIMIT greatest(1, least(coalesce(p_limit, 250), 1000))
    FOR UPDATE OF cycle SKIP LOCKED
  LOOP
    PERFORM public.schedule_recurring_fiscal_documents_for_cycle(v_cycle.id);
    v_scheduled := v_scheduled + 1;
  END LOOP;

  RETURN v_scheduled;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_recurring_fiscal_documents(
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
    JOIN public.sale_recurring_cycles cycle
      ON cycle.id = invoice.recurring_cycle_id
    JOIN public.sale_recurrences recurrence
      ON recurrence.id = cycle.recurrence_id
    WHERE invoice.recurring_cycle_id IS NOT NULL
      AND recurrence.fiscal_mode = 'automatic'
      AND (recurrence.fiscal_auto_start_after IS NULL
           OR cycle.period_start > recurrence.fiscal_auto_start_after)
      AND cycle.fiscal_status <> 'manual_review'
      AND invoice.processing_status IN ('pending', 'retry')
      AND coalesce(invoice.processing_next_retry_at, '-infinity'::timestamptz) <= now()
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices active
        WHERE active.recurring_cycle_id = invoice.recurring_cycle_id
          AND active.processing_status IN (
            'processing', 'reconciliation_required', 'reconciling'
          )
      )
      AND invoice.id = (
        SELECT queued.id
        FROM public.invoices queued
        WHERE queued.recurring_cycle_id = invoice.recurring_cycle_id
          AND queued.processing_status IN ('pending', 'retry')
          AND coalesce(queued.processing_next_retry_at, '-infinity'::timestamptz) <= now()
        ORDER BY
          CASE queued.document_type
            WHEN 'invoice' THEN 0
            WHEN 'invoice_receipt' THEN 0
            WHEN 'receipt' THEN 1
            WHEN 'credit_note' THEN 2
            ELSE 3
          END,
          queued.created_at,
          queued.id
        LIMIT 1
      )
    ORDER BY invoice.created_at, invoice.id
    LIMIT greatest(1, least(coalesce(p_limit, 25), 100))
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
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
    RETURNING invoice.*
  ), cycles AS (
    UPDATE public.sale_recurring_cycles cycle
    SET
      fiscal_status = 'processing',
      fiscal_attempts = fiscal_attempts + 1,
      fiscal_claim_token = p_worker_id,
      fiscal_claimed_at = now(),
      fiscal_next_retry_at = NULL,
      fiscal_last_error = NULL
    WHERE cycle.id IN (SELECT recurring_cycle_id FROM claimed)
    RETURNING cycle.id
  )
  SELECT claimed.* FROM claimed;
END;
$$;
REVOKE ALL ON FUNCTION public.schedule_recurring_fiscal_documents_for_cycle(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_recurring_fiscal_documents_for_cycle(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.schedule_due_recurring_fiscal_documents(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_due_recurring_fiscal_documents(integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.claim_recurring_fiscal_documents(integer,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_recurring_fiscal_documents(integer,uuid)
  TO service_role;

COMMIT;
