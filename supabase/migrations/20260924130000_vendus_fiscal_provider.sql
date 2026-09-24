-- Vendus credentials and document defaults for the existing fiscal ledger.
-- Apply after 20260924120000_keyinvoice_recurring_fiscal_ledger.sql.
-- No new table or RLS policy is needed: organizations and invoices retain
-- their existing tenant isolation.

BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS vendus_api_key text,
  ADD COLUMN IF NOT EXISTS tem_vendus_api_key boolean
    GENERATED ALWAYS AS (vendus_api_key IS NOT NULL AND vendus_api_key <> '') STORED,
  ADD COLUMN IF NOT EXISTS vendus_register_id integer,
  ADD COLUMN IF NOT EXISTS vendus_payment_method_id integer;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_vendus_register_id_check,
  DROP CONSTRAINT IF EXISTS organizations_vendus_payment_method_id_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_vendus_register_id_check
    CHECK (vendus_register_id IS NULL OR vendus_register_id > 0),
  ADD CONSTRAINT organizations_vendus_payment_method_id_check
    CHECK (vendus_payment_method_id IS NULL OR vendus_payment_method_id > 0);

COMMENT ON COLUMN public.organizations.vendus_api_key IS
  'Server-side Vendus API credential. Do not grant browser roles SELECT on this column.';
COMMENT ON COLUMN public.organizations.tem_vendus_api_key IS
  'Whether a Vendus API key is configured; safe for the browser to read.';
COMMENT ON COLUMN public.organizations.vendus_register_id IS
  'Default Vendus register_id for issuing fiscal documents.';
COMMENT ON COLUMN public.organizations.vendus_payment_method_id IS
  'Default Vendus payments[].id for invoice-receipts and receipts.';
COMMENT ON COLUMN public.organizations.billing_provider IS
  'Active billing provider: invoicexpress, keyinvoice or vendus.';

-- The 20260826140000 hardening removed table-level SELECT and grants safe
-- columns individually. Grant the new non-secret columns without exposing the
-- API key. The existing organization RLS still controls which rows are visible.
GRANT SELECT (tem_vendus_api_key, vendus_register_id, vendus_payment_method_id)
  ON public.organizations TO authenticated, anon;

-- The preceding fiscal-ledger migration introduced this provider constraint.
-- Its provider identity check and unique index already cover Vendus rows.
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_provider_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_provider_check CHECK (
    provider IN ('invoicexpress', 'keyinvoice', 'vendus')
  );

CREATE UNIQUE INDEX IF NOT EXISTS invoices_vendus_payment_receipt_uidx
  ON public.invoices (organization_id, payment_id)
  WHERE provider = 'vendus'
    AND document_type = 'receipt'
    AND payment_id IS NOT NULL
    AND processing_status NOT IN ('cancelled', 'void');

-- Reserve a manual RG before contacting Vendus. Locking the source FT makes
-- the cap check safe when distinct payments are issued concurrently. A
-- processing row also prevents the KeyInvoice recurring worker from claiming
-- this Vendus document while the external request is in flight.
CREATE OR REPLACE FUNCTION public.reserve_manual_vendus_receipt(
  p_organization_id uuid,
  p_sale_id uuid,
  p_payment_id uuid,
  p_related_invoice_id uuid,
  p_amount numeric,
  p_fiscal_date date,
  p_snapshot jsonb,
  p_client_name text,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source public.invoices%rowtype;
  v_payment public.sale_payments%rowtype;
  v_existing public.invoices%rowtype;
  v_job public.invoices%rowtype;
  v_reserved_total numeric;
  v_idempotency_key text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NULL OR p_sale_id IS NULL OR p_payment_id IS NULL
     OR p_related_invoice_id IS NULL OR p_claim_token IS NULL
     OR p_fiscal_date IS NULL OR p_amount IS NULL OR p_amount <= 0
     OR jsonb_typeof(coalesce(p_snapshot, '{}'::jsonb)) <> 'object'
     OR p_snapshot #>> '{payment,status}' IS DISTINCT FROM 'paid'
     OR p_snapshot #>> '{payment,reversalStatus}' IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'vendus_receipt_invalid_arguments' USING ERRCODE = '23514';
  END IF;

  v_idempotency_key := 'vendus:RG:' || p_payment_id::text;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('vendus-manual-receipt:' || p_related_invoice_id::text, 0)
  );

  SELECT * INTO v_existing
  FROM public.invoices
  WHERE organization_id = p_organization_id
    AND fiscal_idempotency_key = v_idempotency_key;
  IF FOUND THEN
    IF v_existing.payment_id IS DISTINCT FROM p_payment_id
       OR v_existing.related_invoice_id IS DISTINCT FROM p_related_invoice_id
       OR v_existing.provider IS DISTINCT FROM 'vendus'
       OR v_existing.document_type IS DISTINCT FROM 'receipt' THEN
      RAISE EXCEPTION 'vendus_receipt_idempotency_conflict' USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object(
      'job_id', v_existing.id,
      'created', false,
      'processing_status', v_existing.processing_status,
      'reference', v_existing.reference
    );
  END IF;

  SELECT * INTO v_source
  FROM public.invoices
  WHERE id = p_related_invoice_id
    AND organization_id = p_organization_id
    AND sale_id = p_sale_id
  FOR UPDATE;
  IF NOT FOUND OR v_source.provider IS DISTINCT FROM 'vendus'
     OR v_source.document_type IS DISTINCT FROM 'invoice'
     OR v_source.provider_document_type_code IS DISTINCT FROM 'FT'
     OR nullif(btrim(v_source.reference), '') IS NULL
     OR v_source.status IS DISTINCT FROM 'final'
     OR v_source.processing_status IS DISTINCT FROM 'issued'
     OR coalesce(v_source.total, 0) <= 0 THEN
    RAISE EXCEPTION 'vendus_receipt_source_invoice_invalid' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_payment
  FROM public.sale_payments
  WHERE id = p_payment_id
    AND organization_id = p_organization_id
    AND sale_id = p_sale_id
  FOR UPDATE;
  IF NOT FOUND OR v_payment.status IS DISTINCT FROM 'paid'
     OR coalesce(v_payment.reversal_status, 'none') <> 'none'
     OR coalesce(v_payment.reversed_amount, 0) > 0
     OR nullif(btrim(coalesce(v_payment.invoice_reference, '')), '') IS NOT NULL
     OR abs(coalesce(v_payment.amount, 0) - p_amount) > 0.005
     OR v_payment.recurring_cycle_id IS DISTINCT FROM v_source.recurring_cycle_id THEN
    RAISE EXCEPTION 'vendus_receipt_payment_not_eligible' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoices invoice
    WHERE invoice.organization_id = p_organization_id
      AND invoice.payment_id = p_payment_id
      AND invoice.document_type = 'receipt'
      AND invoice.processing_status NOT IN ('cancelled', 'void')
  ) THEN
    RAISE EXCEPTION 'vendus_receipt_already_reserved' USING ERRCODE = '23505';
  END IF;

  SELECT coalesce(sum(invoice.total), 0) INTO v_reserved_total
  FROM public.invoices invoice
  WHERE invoice.organization_id = p_organization_id
    AND invoice.related_invoice_id = p_related_invoice_id
    AND invoice.document_type = 'receipt'
    -- Ambiguous remote outcomes continue to reserve their amount.
    AND invoice.processing_status NOT IN ('failed', 'cancelled', 'void');
  IF round(v_reserved_total + p_amount, 2) > round(v_source.total, 2) THEN
    RAISE EXCEPTION 'vendus_receipt_amount_exceeds_invoice' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.invoices (
    organization_id, sale_id, payment_id, recurring_cycle_id,
    related_invoice_id, invoicexpress_id, provider, document_type,
    reference, total, status, processing_status, processing_attempts,
    processing_claim_token, processing_claimed_at, date, raw_data,
    fiscal_snapshot, fiscal_idempotency_key, client_name, email_status
  ) VALUES (
    p_organization_id, p_sale_id, p_payment_id, v_payment.recurring_cycle_id,
    p_related_invoice_id, NULL, 'vendus', 'receipt', NULL, p_amount,
    'pending', 'processing', 1, p_claim_token, now(), p_fiscal_date,
    jsonb_build_object('source', 'vendus', 'snapshot', p_snapshot),
    p_snapshot, v_idempotency_key, nullif(btrim(p_client_name), ''),
    'not_requested'
  ) RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'created', true,
    'processing_status', v_job.processing_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_manual_vendus_receipt(
  uuid,uuid,uuid,uuid,numeric,date,jsonb,text,uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_manual_vendus_receipt(
  uuid,uuid,uuid,uuid,numeric,date,jsonb,text,uuid
) TO service_role;

COMMIT;
