-- Durable fiscal ledger for recurring KeyInvoice billing.
--
-- This migration deliberately reuses sale_recurrences, sale_recurring_cycles,
-- sale_payments and invoices. No new table is introduced. Automatic issuance
-- is opt-in: every existing recurrence is backfilled as fiscal_mode=manual.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Organization and recurrence configuration
-- ---------------------------------------------------------------------------

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS keyinvoice_series_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_keyinvoice_series_config_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_keyinvoice_series_config_check CHECK (
    jsonb_typeof(keyinvoice_series_config) = 'object'
    AND octet_length(keyinvoice_series_config::text) <= 16384
  );

COMMENT ON COLUMN public.organizations.keyinvoice_series_config IS
  'Non-secret KeyInvoice series metadata keyed by invoice, invoice_receipt, receipt and credit_note. Each configured series must already exist in KeyInvoice and be communicated to AT. ATCUD is always accepted from KeyInvoice; it is never constructed locally.';

-- organizations uses an explicit safe-column allow-list. Columns added after
-- that hardening are otherwise unreadable even when RLS allows the row.
GRANT SELECT (keyinvoice_series_config) ON public.organizations TO authenticated;

ALTER TABLE public.sale_recurrences
  ADD COLUMN IF NOT EXISTS fiscal_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS fiscal_document_policy text NOT NULL DEFAULT 'invoice_then_receipt',
  ADD COLUMN IF NOT EXISTS fiscal_auto_email boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fiscal_auto_credit_note boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fiscal_email_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS fiscal_configured_at timestamptz,
  ADD COLUMN IF NOT EXISTS fiscal_configured_by uuid;

ALTER TABLE public.sale_recurrences
  DROP CONSTRAINT IF EXISTS sale_recurrences_fiscal_mode_check,
  DROP CONSTRAINT IF EXISTS sale_recurrences_fiscal_document_policy_check,
  DROP CONSTRAINT IF EXISTS sale_recurrences_fiscal_email_config_check;
ALTER TABLE public.sale_recurrences
  ADD CONSTRAINT sale_recurrences_fiscal_mode_check CHECK (
    fiscal_mode IN ('manual', 'automatic')
  ),
  ADD CONSTRAINT sale_recurrences_fiscal_document_policy_check CHECK (
    fiscal_document_policy IN ('invoice_then_receipt', 'invoice_receipt_when_paid')
  ),
  ADD CONSTRAINT sale_recurrences_fiscal_email_config_check CHECK (
    jsonb_typeof(fiscal_email_config) = 'object'
    AND octet_length(fiscal_email_config::text) <= 16384
  );

COMMENT ON COLUMN public.sale_recurrences.fiscal_document_policy IS
  'invoice_then_receipt issues FT at the cycle date and RC for every confirmed payment. invoice_receipt_when_paid waits for full payment and issues one FR.';
COMMENT ON COLUMN public.sale_recurrences.fiscal_auto_credit_note IS
  'Reserved opt-in, disabled until the KeyInvoice demo contract for partial NCs is homologated. Reversals and chargebacks currently always require manual review.';

-- ---------------------------------------------------------------------------
-- 2. Product/line fiscal data and payment reversal identity
-- ---------------------------------------------------------------------------

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS gross_value numeric(14, 2);

ALTER TABLE public.sales
  DROP CONSTRAINT IF EXISTS sales_gross_value_check;
ALTER TABLE public.sales
  ADD CONSTRAINT sales_gross_value_check CHECK (
    gross_value IS NULL OR gross_value >= 0
  );

COMMENT ON COLUMN public.sales.gross_value IS
  'Customer payment obligation including VAT. NULL on historical rows whose gross amount cannot be reconstructed without guessing; total_value remains the legacy net amount used by revenue and commission calculations.';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS keyinvoice_product_id text,
  ADD COLUMN IF NOT EXISTS price_includes_vat boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retention_rate numeric(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_keyinvoice_product_id_check,
  DROP CONSTRAINT IF EXISTS products_retention_rate_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_keyinvoice_product_id_check CHECK (
    keyinvoice_product_id IS NULL OR nullif(btrim(keyinvoice_product_id), '') IS NOT NULL
  ),
  ADD CONSTRAINT products_retention_rate_check CHECK (
    retention_rate >= 0 AND retention_rate <= 100
  );

CREATE UNIQUE INDEX IF NOT EXISTS products_keyinvoice_product_uidx
  ON public.products (organization_id, keyinvoice_product_id)
  WHERE keyinvoice_product_id IS NOT NULL;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS discount_percent numeric(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_value numeric(5, 2),
  ADD COLUMN IF NOT EXISTS tax_exemption_reason text,
  ADD COLUMN IF NOT EXISTS price_includes_vat boolean,
  ADD COLUMN IF NOT EXISTS retention_rate numeric(5, 2),
  ADD COLUMN IF NOT EXISTS stripe_price_id text;

ALTER TABLE public.sale_items
  DROP CONSTRAINT IF EXISTS sale_items_discount_percent_check,
  DROP CONSTRAINT IF EXISTS sale_items_tax_value_check,
  DROP CONSTRAINT IF EXISTS sale_items_retention_rate_check;
ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_discount_percent_check CHECK (
    discount_percent >= 0 AND discount_percent <= 100
  ),
  ADD CONSTRAINT sale_items_tax_value_check CHECK (
    tax_value IS NULL OR (tax_value >= 0 AND tax_value <= 100)
  ),
  ADD CONSTRAINT sale_items_retention_rate_check CHECK (
    retention_rate IS NULL OR (retention_rate >= 0 AND retention_rate <= 100)
  );

CREATE OR REPLACE FUNCTION public.initialize_sale_item_fiscal_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product public.products%rowtype;
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = NEW.product_id;

  IF FOUND THEN
    NEW.tax_value := coalesce(NEW.tax_value, v_product.tax_value);
    NEW.tax_exemption_reason := coalesce(
      nullif(NEW.tax_exemption_reason, ''),
      v_product.tax_exemption_reason
    );
    NEW.price_includes_vat := coalesce(
      NEW.price_includes_vat,
      v_product.price_includes_vat
    );
    NEW.retention_rate := coalesce(NEW.retention_rate, v_product.retention_rate);
    IF NEW.stripe_price_id IS NULL THEN
      SELECT mapping.stripe_price_id INTO NEW.stripe_price_id
      FROM public.stripe_product_mappings mapping
      WHERE mapping.organization_id = v_product.organization_id
        AND mapping.product_id = v_product.id
        AND mapping.active = true
      LIMIT 1;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS initialize_sale_item_fiscal_fields_trg
  ON public.sale_items;
CREATE TRIGGER initialize_sale_item_fiscal_fields_trg
BEFORE INSERT OR UPDATE OF product_id ON public.sale_items
FOR EACH ROW
EXECUTE FUNCTION public.initialize_sale_item_fiscal_fields();

COMMENT ON COLUMN public.products.keyinvoice_product_id IS
  'Exact KeyInvoice product identifier. Automatic fiscal issuance never falls back to an arbitrary first product.';
COMMENT ON COLUMN public.sale_items.tax_value IS
  'Fiscal tax snapshot source for this sale line. Existing rows remain NULL and resolve at queue time; new product-backed rows copy the then-current product value.';
COMMENT ON COLUMN public.sale_items.stripe_price_id IS
  'Stripe Price frozen when the sale line is created. Checkout validates this exact Price against the recurrence amount instead of silently charging a later catalog price.';

ALTER TABLE public.sale_payments
  ADD COLUMN IF NOT EXISTS reversal_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS reversed_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reversal_reference text,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS original_payment_id uuid,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_charge_id text;

ALTER TABLE public.sale_payments
  DROP CONSTRAINT IF EXISTS sale_payments_reversal_status_check,
  DROP CONSTRAINT IF EXISTS sale_payments_reversed_amount_check,
  DROP CONSTRAINT IF EXISTS sale_payments_reversal_state_check,
  DROP CONSTRAINT IF EXISTS sale_payments_original_payment_check,
  DROP CONSTRAINT IF EXISTS sale_payments_payment_intent_check,
  DROP CONSTRAINT IF EXISTS sale_payments_charge_check,
  DROP CONSTRAINT IF EXISTS sale_payments_original_payment_fkey;

ALTER TABLE public.sale_payments
  ADD CONSTRAINT sale_payments_fiscal_identity_key
    UNIQUE (id, sale_id, organization_id);

ALTER TABLE public.sale_payments
  ADD CONSTRAINT sale_payments_reversal_status_check CHECK (
    reversal_status IN ('none', 'refund_pending', 'refunded', 'chargeback', 'reversed')
  ),
  ADD CONSTRAINT sale_payments_reversed_amount_check CHECK (
    reversed_amount >= 0 AND reversed_amount <= amount
  ),
  ADD CONSTRAINT sale_payments_reversal_state_check CHECK (
    (reversal_status = 'none' AND reversed_amount = 0 AND reversed_at IS NULL)
    OR (reversal_status = 'refund_pending' AND reversed_amount > 0)
    OR (
      reversal_status IN ('refunded', 'chargeback', 'reversed')
      AND reversed_amount > 0
      AND reversed_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT sale_payments_original_payment_check CHECK (
    original_payment_id IS NULL OR original_payment_id <> id
  ),
  ADD CONSTRAINT sale_payments_payment_intent_check CHECK (
    stripe_payment_intent_id IS NULL OR stripe_payment_intent_id LIKE 'pi\_%' ESCAPE '\'
  ),
  ADD CONSTRAINT sale_payments_charge_check CHECK (
    stripe_charge_id IS NULL OR stripe_charge_id LIKE 'ch\_%' ESCAPE '\'
  ),
  ADD CONSTRAINT sale_payments_original_payment_fkey
    FOREIGN KEY (original_payment_id, sale_id, organization_id)
    REFERENCES public.sale_payments(id, sale_id, organization_id)
    ON DELETE RESTRICT;

-- A cycle can be settled by several partial payments. The previous unique
-- index silently made partial RCs impossible.
DROP INDEX IF EXISTS public.sale_payments_recurring_cycle_idx;
CREATE INDEX IF NOT EXISTS sale_payments_recurring_cycle_idx
  ON public.sale_payments (recurring_cycle_id, payment_date, id)
  WHERE recurring_cycle_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sale_payments_stripe_payment_intent_uidx
  ON public.sale_payments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sale_payments_stripe_charge_uidx
  ON public.sale_payments (stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sale_payments_reversal_reference_uidx
  ON public.sale_payments (organization_id, reversal_reference)
  WHERE reversal_reference IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Per-cycle state and durable invoice/document ledger
-- ---------------------------------------------------------------------------

ALTER TABLE public.sale_recurring_cycles
  ADD COLUMN IF NOT EXISTS fiscal_status text NOT NULL DEFAULT 'not_scheduled',
  ADD COLUMN IF NOT EXISTS fiscal_idempotency_key text,
  ADD COLUMN IF NOT EXISTS fiscal_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS fiscal_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fiscal_next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS fiscal_claim_token uuid,
  ADD COLUMN IF NOT EXISTS fiscal_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS fiscal_last_error text,
  ADD COLUMN IF NOT EXISTS fiscal_primary_invoice_id uuid,
  ADD COLUMN IF NOT EXISTS fiscal_email_status text NOT NULL DEFAULT 'not_requested';

UPDATE public.sale_recurring_cycles
SET fiscal_idempotency_key = 'fiscal:cycle:' || id::text
WHERE fiscal_idempotency_key IS NULL;

ALTER TABLE public.sale_recurring_cycles
  ALTER COLUMN fiscal_idempotency_key SET NOT NULL,
  DROP CONSTRAINT IF EXISTS sale_recurring_cycles_fiscal_status_check,
  DROP CONSTRAINT IF EXISTS sale_recurring_cycles_fiscal_email_status_check,
  DROP CONSTRAINT IF EXISTS sale_recurring_cycles_fiscal_attempts_check,
  DROP CONSTRAINT IF EXISTS sale_recurring_cycles_fiscal_snapshot_check,
  DROP CONSTRAINT IF EXISTS sale_recurring_cycles_fiscal_claim_check;
ALTER TABLE public.sale_recurring_cycles
  ADD CONSTRAINT sale_recurring_cycles_fiscal_status_check CHECK (
    fiscal_status IN (
      'not_scheduled', 'pending', 'processing', 'partial', 'completed',
      'retry', 'failed', 'manual_review'
    )
  ),
  ADD CONSTRAINT sale_recurring_cycles_fiscal_email_status_check CHECK (
    fiscal_email_status IN (
      'not_requested', 'pending', 'processing', 'partial', 'sent',
      'delivered', 'bounced', 'blocked', 'retry', 'failed', 'suppressed'
    )
  ),
  ADD CONSTRAINT sale_recurring_cycles_fiscal_attempts_check CHECK (fiscal_attempts >= 0),
  ADD CONSTRAINT sale_recurring_cycles_fiscal_snapshot_check CHECK (
    jsonb_typeof(fiscal_snapshot) = 'object'
  ),
  ADD CONSTRAINT sale_recurring_cycles_fiscal_claim_check CHECK (
    (fiscal_claim_token IS NULL) = (fiscal_claimed_at IS NULL)
  ),
  ADD CONSTRAINT sale_recurring_cycles_fiscal_idempotency_key
    UNIQUE (organization_id, fiscal_idempotency_key);

CREATE OR REPLACE FUNCTION public.ensure_recurring_cycle_fiscal_idempotency_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Defaults are applied before BEFORE triggers. Keep the explicit fallback so
  -- legacy insert paths that provide a null id still receive a stable key.
  IF NEW.id IS NULL THEN
    NEW.id := gen_random_uuid();
  END IF;

  IF nullif(btrim(NEW.fiscal_idempotency_key), '') IS NULL THEN
    NEW.fiscal_idempotency_key := 'fiscal:cycle:' || NEW.id::text;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_recurring_cycle_fiscal_idempotency_key()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ensure_recurring_cycle_fiscal_idempotency_key_trg
  ON public.sale_recurring_cycles;
CREATE TRIGGER ensure_recurring_cycle_fiscal_idempotency_key_trg
BEFORE INSERT OR UPDATE OF fiscal_idempotency_key, id
ON public.sale_recurring_cycles
FOR EACH ROW
EXECUTE FUNCTION public.ensure_recurring_cycle_fiscal_idempotency_key();

ALTER TABLE public.invoices
  ALTER COLUMN invoicexpress_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'invoicexpress',
  ADD COLUMN IF NOT EXISTS provider_document_type_code text,
  ADD COLUMN IF NOT EXISTS provider_series text,
  ADD COLUMN IF NOT EXISTS provider_document_number text,
  ADD COLUMN IF NOT EXISTS provider_atcud text,
  ADD COLUMN IF NOT EXISTS recurring_cycle_id uuid,
  ADD COLUMN IF NOT EXISTS related_invoice_id uuid,
  ADD COLUMN IF NOT EXISTS fiscal_idempotency_key text,
  ADD COLUMN IF NOT EXISTS fiscal_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS processing_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_claim_token uuid,
  ADD COLUMN IF NOT EXISTS processing_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_last_error text,
  ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_claim_token uuid,
  ADD COLUMN IF NOT EXISTS email_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_last_error text,
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_message_id text,
  ADD COLUMN IF NOT EXISTS email_last_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_event_data jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Safe legacy backfill. Unknown series are explicitly marked legacy instead of
-- guessed from a reference. New KeyInvoice rows use the exact API response.
UPDATE public.invoices
SET
  provider = CASE
    WHEN lower(coalesce(raw_data ->> 'source', raw_data ->> 'provider', '')) = 'keyinvoice'
      THEN 'keyinvoice'
    ELSE 'invoicexpress'
  END,
  provider_document_type_code = coalesce(
    nullif(raw_data ->> 'docType', ''),
    nullif(raw_data ->> 'provider_document_type_code', ''),
    nullif(document_type, ''),
    'legacy'
  ),
  provider_series = coalesce(
    nullif(raw_data ->> 'docSeries', ''),
    nullif(raw_data ->> 'provider_series', ''),
    '__legacy__'
  ),
  provider_document_number = coalesce(
    nullif(raw_data ->> 'docNum', ''),
    nullif(raw_data ->> 'provider_document_number', ''),
    invoicexpress_id::text
  ),
  provider_atcud = coalesce(
    nullif(raw_data ->> 'atcud', ''),
    nullif(raw_data ->> 'ATCUD', '')
  ),
  fiscal_idempotency_key = coalesce(
    nullif(fiscal_idempotency_key, ''),
    'legacy:invoice:' || id::text
  ),
  fiscal_snapshot = CASE
    WHEN fiscal_snapshot = '{}'::jsonb THEN jsonb_build_object(
      'schema_version', 1,
      'legacy_import', true,
      'captured_at', coalesce(created_at, now()),
      'raw_data', coalesce(raw_data, '{}'::jsonb)
    )
    ELSE fiscal_snapshot
  END,
  issued_at = coalesce(issued_at, created_at)
WHERE processing_status = 'legacy';

ALTER TABLE public.invoices
  ALTER COLUMN fiscal_idempotency_key SET DEFAULT ('fiscal:document:' || gen_random_uuid()::text);
UPDATE public.invoices
SET fiscal_idempotency_key = 'legacy:invoice:' || id::text
WHERE fiscal_idempotency_key IS NULL;
ALTER TABLE public.invoices
  ALTER COLUMN fiscal_idempotency_key SET NOT NULL;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_provider_check,
  DROP CONSTRAINT IF EXISTS invoices_processing_status_check,
  DROP CONSTRAINT IF EXISTS invoices_processing_attempts_check,
  DROP CONSTRAINT IF EXISTS invoices_processing_claim_check,
  DROP CONSTRAINT IF EXISTS invoices_email_status_check,
  DROP CONSTRAINT IF EXISTS invoices_email_attempts_check,
  DROP CONSTRAINT IF EXISTS invoices_email_claim_check,
  DROP CONSTRAINT IF EXISTS invoices_email_event_data_check,
  DROP CONSTRAINT IF EXISTS invoices_fiscal_snapshot_check,
  DROP CONSTRAINT IF EXISTS invoices_fiscal_document_kind_check,
  DROP CONSTRAINT IF EXISTS invoices_provider_identity_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_provider_check CHECK (
    provider IN ('invoicexpress', 'keyinvoice')
  ),
  ADD CONSTRAINT invoices_processing_status_check CHECK (
    processing_status IN (
      'legacy', 'pending', 'processing', 'issued', 'retry', 'failed',
      'reconciliation_required', 'reconciling', 'manual_review',
      'cancelled', 'void'
    )
  ),
  ADD CONSTRAINT invoices_processing_attempts_check CHECK (processing_attempts >= 0),
  ADD CONSTRAINT invoices_processing_claim_check CHECK (
    (processing_claim_token IS NULL) = (processing_claimed_at IS NULL)
  ),
  ADD CONSTRAINT invoices_email_status_check CHECK (
    email_status IN (
      'not_requested', 'pending', 'processing', 'sent', 'delivered',
      'bounced', 'blocked', 'retry', 'failed', 'suppressed'
    )
  ),
  ADD CONSTRAINT invoices_email_attempts_check CHECK (email_attempts >= 0),
  ADD CONSTRAINT invoices_email_claim_check CHECK (
    (email_claim_token IS NULL) = (email_claimed_at IS NULL)
  ),
  ADD CONSTRAINT invoices_email_event_data_check CHECK (
    jsonb_typeof(email_event_data) = 'object'
  ),
  ADD CONSTRAINT invoices_fiscal_snapshot_check CHECK (
    jsonb_typeof(fiscal_snapshot) = 'object'
  ),
  ADD CONSTRAINT invoices_fiscal_document_kind_check CHECK (
    processing_status = 'legacy'
    OR document_type IN ('invoice', 'invoice_receipt', 'receipt', 'credit_note')
  ),
  ADD CONSTRAINT invoices_provider_identity_check CHECK (
    processing_status NOT IN ('issued', 'void')
    OR (
      nullif(provider_document_type_code, '') IS NOT NULL
      AND nullif(provider_series, '') IS NOT NULL
      AND nullif(provider_document_number, '') IS NOT NULL
      AND issued_at IS NOT NULL
    )
  );

-- The legacy uniqueness was wrong for fiscal providers: DocNum is only unique
-- inside provider + document type + series. Existing callers must upsert on the
-- new identity (or on fiscal_idempotency_key for a pre-issue job).
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_organization_id_invoicexpress_id_key;
CREATE INDEX IF NOT EXISTS invoices_org_legacy_id_idx
  ON public.invoices (organization_id, invoicexpress_id)
  WHERE invoicexpress_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_provider_fiscal_identity_uidx
  ON public.invoices (
    organization_id,
    provider,
    provider_document_type_code,
    provider_series,
    provider_document_number
  )
  WHERE provider_document_type_code IS NOT NULL
    AND provider_series IS NOT NULL
    AND provider_document_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_fiscal_idempotency_uidx
  ON public.invoices (organization_id, fiscal_idempotency_key);
CREATE INDEX IF NOT EXISTS invoices_fiscal_queue_idx
  ON public.invoices (processing_status, processing_next_retry_at, created_at)
  WHERE processing_status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS invoices_fiscal_reconcile_idx
  ON public.invoices (processing_claimed_at, created_at)
  WHERE processing_status IN ('processing', 'reconciliation_required', 'reconciling');
CREATE INDEX IF NOT EXISTS invoices_fiscal_email_queue_idx
  ON public.invoices (email_status, email_next_retry_at, email_claimed_at, issued_at)
  WHERE email_status IN ('pending', 'retry', 'processing');
CREATE UNIQUE INDEX IF NOT EXISTS invoices_email_message_uidx
  ON public.invoices (email_message_id)
  WHERE email_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_cycle_primary_document_uidx
  ON public.invoices (recurring_cycle_id)
  WHERE recurring_cycle_id IS NOT NULL
    AND document_type IN ('invoice', 'invoice_receipt')
    AND processing_status NOT IN ('cancelled', 'void');
CREATE UNIQUE INDEX IF NOT EXISTS invoices_cycle_payment_receipt_uidx
  ON public.invoices (recurring_cycle_id, payment_id)
  WHERE recurring_cycle_id IS NOT NULL
    AND payment_id IS NOT NULL
    AND document_type = 'receipt'
    AND processing_status NOT IN ('cancelled', 'void');

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_id_org_key UNIQUE (id, organization_id);

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_recurring_cycle_fkey,
  DROP CONSTRAINT IF EXISTS invoices_related_invoice_fkey,
  DROP CONSTRAINT IF EXISTS invoices_fiscal_payment_scope_fkey;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_recurring_cycle_fkey
    FOREIGN KEY (recurring_cycle_id, sale_id, organization_id)
    REFERENCES public.sale_recurring_cycles(id, sale_id, organization_id)
    ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT invoices_related_invoice_fkey
    FOREIGN KEY (related_invoice_id, organization_id)
    REFERENCES public.invoices(id, organization_id)
    ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT invoices_fiscal_payment_scope_fkey
    FOREIGN KEY (payment_id, sale_id, organization_id)
    REFERENCES public.sale_payments(id, sale_id, organization_id)
    ON DELETE RESTRICT NOT VALID;

ALTER TABLE public.sale_recurring_cycles
  DROP CONSTRAINT IF EXISTS sale_recurring_cycles_primary_invoice_fkey;
ALTER TABLE public.sale_recurring_cycles
  ADD CONSTRAINT sale_recurring_cycles_primary_invoice_fkey
    FOREIGN KEY (fiscal_primary_invoice_id, organization_id)
    REFERENCES public.invoices(id, organization_id)
    ON DELETE RESTRICT NOT VALID;

CREATE INDEX IF NOT EXISTS sale_recurring_cycles_fiscal_queue_idx
  ON public.sale_recurring_cycles (fiscal_status, fiscal_next_retry_at, period_start)
  WHERE fiscal_status IN ('pending', 'retry', 'manual_review');

-- ---------------------------------------------------------------------------
-- 4. Immutable snapshots and fiscal invariants
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_recurring_fiscal_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.fiscal_snapshot <> '{}'::jsonb
     AND NEW.fiscal_snapshot IS DISTINCT FROM OLD.fiscal_snapshot THEN
    RAISE EXCEPTION 'A fiscal cycle snapshot is immutable after scheduling'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.fiscal_idempotency_key IS DISTINCT FROM OLD.fiscal_idempotency_key THEN
    RAISE EXCEPTION 'A fiscal cycle idempotency key is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_recurring_fiscal_snapshot()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_recurring_fiscal_snapshot_trg
  ON public.sale_recurring_cycles;
CREATE TRIGGER protect_recurring_fiscal_snapshot_trg
BEFORE UPDATE ON public.sale_recurring_cycles
FOR EACH ROW
EXECUTE FUNCTION public.protect_recurring_fiscal_snapshot();

CREATE OR REPLACE FUNCTION public.protect_invoice_fiscal_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.fiscal_snapshot <> '{}'::jsonb
     AND NEW.fiscal_snapshot IS DISTINCT FROM OLD.fiscal_snapshot THEN
    RAISE EXCEPTION 'The queued fiscal snapshot is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.fiscal_idempotency_key IS DISTINCT FROM OLD.fiscal_idempotency_key
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.sale_id IS DISTINCT FROM OLD.sale_id
     OR NEW.recurring_cycle_id IS DISTINCT FROM OLD.recurring_cycle_id
     OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.related_invoice_id IS DISTINCT FROM OLD.related_invoice_id
     OR NEW.document_type IS DISTINCT FROM OLD.document_type
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR (
       OLD.provider_document_type_code IS NOT NULL
       AND NEW.provider_document_type_code IS DISTINCT FROM OLD.provider_document_type_code
     )
     OR (
       OLD.provider_series IS NOT NULL
       AND NEW.provider_series IS DISTINCT FROM OLD.provider_series
     )
     OR NEW.total IS DISTINCT FROM OLD.total
     OR NEW.date IS DISTINCT FROM OLD.date
     OR NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    IF OLD.processing_status <> 'legacy' THEN
      RAISE EXCEPTION 'Fiscal document identity and amounts are immutable after queueing'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF (
    OLD.provider_document_number IS NOT NULL AND (
      NEW.provider_document_type_code IS DISTINCT FROM OLD.provider_document_type_code
      OR NEW.provider_series IS DISTINCT FROM OLD.provider_series
      OR NEW.provider_document_number IS DISTINCT FROM OLD.provider_document_number
    )
  ) OR (
    OLD.provider_atcud IS NOT NULL
    AND NEW.provider_atcud IS DISTINCT FROM OLD.provider_atcud
  ) THEN
    RAISE EXCEPTION 'Provider fiscal identity is immutable after assignment'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_invoice_fiscal_snapshot()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_invoice_fiscal_snapshot_trg ON public.invoices;
CREATE TRIGGER protect_invoice_fiscal_snapshot_trg
BEFORE UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.protect_invoice_fiscal_snapshot();

CREATE OR REPLACE FUNCTION public.enforce_recurring_fiscal_document_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cycle public.sale_recurring_cycles%rowtype;
  v_payment public.sale_payments%rowtype;
  v_related public.invoices%rowtype;
  v_receipted numeric(12, 2);
  v_credited numeric(12, 2);
BEGIN
  -- Delivery/PDF/webhook updates to an already-issued row must remain possible
  -- after a later refund or dispute. Re-run fiscal issuance invariants only on
  -- the transition that first records an issued document.
  IF TG_OP = 'UPDATE'
     AND OLD.processing_status = NEW.processing_status THEN
    RETURN NEW;
  END IF;

  IF NEW.processing_status <> 'issued'
     OR NEW.recurring_cycle_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO STRICT v_cycle
  FROM public.sale_recurring_cycles
  WHERE id = NEW.recurring_cycle_id
    AND sale_id = NEW.sale_id
    AND organization_id = NEW.organization_id;

  IF NEW.document_type = 'invoice_receipt' THEN
    -- As with RC, use the immutable pre-call state. A reversal arriving after
    -- KeyInvoice accepted the FR must not make the local completion disappear.
    IF coalesce(NEW.fiscal_snapshot #>> '{cycle,status}', '') <> 'paid'
       OR coalesce(public._safe_numeric(
         NEW.fiscal_snapshot #>> '{totals,paidNet}'
       ), 0) < v_cycle.amount
       OR coalesce(public._safe_numeric(
         NEW.fiscal_snapshot #>> '{totals,reversedAmount}'
       ), 0) > 0 THEN
      RAISE EXCEPTION 'Fatura-recibo requires a fully paid, undisputed cycle'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.invoices invoice
      WHERE invoice.recurring_cycle_id = v_cycle.id
        AND invoice.id <> NEW.id
        AND invoice.document_type = 'invoice'
        AND invoice.processing_status NOT IN ('cancelled', 'void')
    ) THEN
      RAISE EXCEPTION 'Fatura-recibo cannot be issued after an invoice for the same cycle'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.document_type = 'receipt' THEN
    IF NEW.payment_id IS NULL OR NEW.related_invoice_id IS NULL THEN
      RAISE EXCEPTION 'Receipt requires a payment and its source invoice'
        USING ERRCODE = '23514';
    END IF;

    SELECT * INTO STRICT v_payment
    FROM public.sale_payments
    WHERE id = NEW.payment_id
      AND recurring_cycle_id = v_cycle.id
      AND sale_id = v_cycle.sale_id
      AND organization_id = v_cycle.organization_id;

    SELECT * INTO STRICT v_related
    FROM public.invoices
    WHERE id = NEW.related_invoice_id
      AND organization_id = NEW.organization_id;

    -- The immutable snapshot proves that the payment was valid when this RC
    -- was queued. A refund/chargeback may arrive after the remote API accepted
    -- the RC but before our completion write; that later event must start a
    -- separate fiscal review and must never prevent recording the real remote
    -- document identity locally.
    IF v_payment.status <> 'paid'
       OR coalesce(NEW.fiscal_snapshot #>> '{payment,status}', '') <> 'paid'
       OR coalesce(NEW.fiscal_snapshot #>> '{payment,reversalStatus}', 'none') <> 'none'
       OR v_related.recurring_cycle_id IS DISTINCT FROM v_cycle.id
       OR v_related.document_type <> 'invoice'
       OR v_related.processing_status <> 'issued' THEN
      RAISE EXCEPTION 'Receipt requires a confirmed payment and an issued invoice from the same cycle'
        USING ERRCODE = '23514';
    END IF;

    SELECT coalesce(sum(invoice.total), 0)
    INTO v_receipted
    FROM public.invoices invoice
    WHERE invoice.related_invoice_id = v_related.id
      AND invoice.document_type = 'receipt'
      AND invoice.processing_status = 'issued'
      AND invoice.id <> NEW.id;

    IF v_receipted + coalesce(NEW.total, 0) > coalesce(v_related.total, 0) THEN
      RAISE EXCEPTION 'Receipts exceed the source invoice total'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.document_type = 'credit_note' THEN
    IF NEW.related_invoice_id IS NULL OR NEW.total IS NULL OR NEW.total <= 0 THEN
      RAISE EXCEPTION 'Credit note requires an issued source document and a confirmed positive amount'
        USING ERRCODE = '23514';
    END IF;

    SELECT * INTO STRICT v_related
    FROM public.invoices
    WHERE id = NEW.related_invoice_id
      AND organization_id = NEW.organization_id;

    IF v_related.recurring_cycle_id IS DISTINCT FROM v_cycle.id
       OR v_related.processing_status <> 'issued'
       OR v_related.document_type NOT IN ('invoice', 'invoice_receipt', 'receipt') THEN
      RAISE EXCEPTION 'Credit note source document is invalid'
        USING ERRCODE = '23514';
    END IF;

    SELECT coalesce(sum(invoice.total), 0)
    INTO v_credited
    FROM public.invoices invoice
    WHERE invoice.related_invoice_id = v_related.id
      AND invoice.document_type = 'credit_note'
      AND invoice.processing_status = 'issued'
      AND invoice.id <> NEW.id;

    IF v_credited + NEW.total > coalesce(v_related.total, 0) THEN
      RAISE EXCEPTION 'Credit notes exceed the source document total'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_recurring_fiscal_document_rules()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_recurring_fiscal_document_rules_trg
  ON public.invoices;
CREATE TRIGGER enforce_recurring_fiscal_document_rules_trg
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.enforce_recurring_fiscal_document_rules();

-- ---------------------------------------------------------------------------
-- 5. Payment aggregation and snapshot construction
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refresh_recurring_cycle_payment_status(
  p_cycle_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_amount numeric(12, 2);
  v_net_paid numeric(12, 2);
  v_paid_at timestamptz;
  v_has_reversal boolean;
BEGIN
  IF p_cycle_id IS NULL THEN
    RETURN;
  END IF;

  SELECT amount INTO v_amount
  FROM public.sale_recurring_cycles
  WHERE id = p_cycle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    coalesce(sum(
      CASE
        WHEN payment.status = 'paid' THEN
          payment.amount - CASE
            WHEN payment.reversal_status IN ('refunded', 'chargeback', 'reversed')
              THEN payment.reversed_amount
            ELSE 0
          END
        ELSE 0
      END
    ), 0),
    max(
      CASE WHEN payment.status = 'paid'
        THEN payment.payment_date::timestamp AT TIME ZONE 'Europe/Lisbon'
      END
    ),
    bool_or(payment.reversal_status <> 'none')
  INTO v_net_paid, v_paid_at, v_has_reversal
  FROM public.sale_payments payment
  WHERE payment.recurring_cycle_id = p_cycle_id;

  -- A refund/dispute is a fiscal review event, not permission to reopen the
  -- customer's debt. Keep the commercial payment state until a human decides
  -- the accounting outcome; the fiscal scheduler marks manual_review.
  IF coalesce(v_has_reversal, false) THEN
    RETURN;
  END IF;

  UPDATE public.sale_recurring_cycles
  SET
    status = CASE WHEN v_net_paid >= v_amount THEN 'paid' ELSE 'pending' END,
    paid_at = CASE WHEN v_net_paid >= v_amount THEN v_paid_at ELSE NULL END
  WHERE id = p_cycle_id;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_recurring_cycle_payment_status(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_recurring_cycle_payment_status(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.sync_recurring_cycle_from_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_cycle_id uuid;
  v_old_cycle_id uuid;
BEGIN
  v_new_cycle_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.recurring_cycle_id END;
  v_old_cycle_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.recurring_cycle_id END;

  IF v_old_cycle_id IS NOT NULL THEN
    PERFORM public.refresh_recurring_cycle_payment_status(v_old_cycle_id);
  END IF;
  IF v_new_cycle_id IS NOT NULL AND v_new_cycle_id IS DISTINCT FROM v_old_cycle_id THEN
    PERFORM public.refresh_recurring_cycle_payment_status(v_new_cycle_id);
  ELSIF v_new_cycle_id IS NOT NULL AND v_old_cycle_id IS NULL THEN
    PERFORM public.refresh_recurring_cycle_payment_status(v_new_cycle_id);
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_recurring_cycle_from_payment()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_recurring_cycle_from_payment_trg
  ON public.sale_payments;
CREATE TRIGGER sync_recurring_cycle_from_payment_trg
AFTER INSERT OR UPDATE OF status, amount, payment_date, recurring_cycle_id,
  reversal_status, reversed_amount, reversed_at OR DELETE
ON public.sale_payments
FOR EACH ROW
EXECUTE FUNCTION public.sync_recurring_cycle_from_payment();

CREATE OR REPLACE FUNCTION public.build_recurring_fiscal_snapshot(
  p_cycle_id uuid,
  p_document_kind text,
  p_payment_id uuid DEFAULT NULL,
  p_related_invoice_id uuid DEFAULT NULL,
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'capturedAt', clock_timestamp(),
    'fiscalTimezone', 'Europe/Lisbon',
    'fiscalDate', (clock_timestamp() AT TIME ZONE 'Europe/Lisbon')::date,
    'provider', 'keyinvoice',
    'kind', p_document_kind,
    'amount', CASE
      WHEN p_document_kind IN ('receipt', 'credit_note')
        THEN coalesce(public._safe_numeric(p_extra ->> 'confirmed_amount'), payment.amount)
      ELSE cycle.amount
    END,
    'currency', cycle.currency,
    'ids', jsonb_build_object(
      'organizationId', organization.id,
      'recurrenceId', recurrence.id,
      'cycleId', cycle.id,
      'saleId', sale.id,
      'paymentId', payment.id,
      'relatedInvoiceId', related_document.id
    ),
    'organization', jsonb_build_object(
      'id', organization.id,
      'name', organization.name,
      'taxConfig', coalesce(organization.tax_config, '{}'::jsonb)
    ),
    'sale', jsonb_build_object(
      'id', sale.id,
      'code', sale.code,
      'saleDate', sale.sale_date,
      'subtotal', sale.subtotal,
      'discount', sale.discount,
      'total', sale.total_value
    ),
    'cycle', jsonb_build_object(
      'id', cycle.id,
      'status', cycle.status,
      'periodStart', cycle.period_start,
      'periodEnd', cycle.period_end,
      'dueDate', cycle.due_date,
      'amount', cycle.amount,
      'currency', cycle.currency,
      'paidAt', cycle.paid_at
    ),
    'client', CASE WHEN client.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
      'id', client.id,
      'name', CASE
        WHEN client.billing_target = 'company'
          THEN coalesce(nullif(client.company, ''), client.name)
        ELSE client.name
      END,
      'vatin', CASE
        WHEN client.billing_target = 'company'
          THEN coalesce(nullif(client.company_nif, ''), client.nif)
        ELSE client.nif
      END,
      'email', client.email,
      'phone', client.phone,
      'address', concat_ws(', ', nullif(client.address_line1, ''), nullif(client.address_line2, '')),
      'postalCode', client.postal_code,
      'locality', client.city,
      'countryCode', upper(coalesce(nullif(client.country, ''), 'PT'))
    ) END,
    'lines', CASE
      WHEN coalesce((
        SELECT sum(
          recurring_item.unit_price * recurring_item.quantity
          * (1 - recurring_item.discount_percent / 100.0)
        )
        FROM public.sale_items recurring_item
        JOIN public.products recurring_product ON recurring_product.id = recurring_item.product_id
        WHERE recurring_item.sale_id = sale.id
          AND recurring_product.is_recurring = true
      ), 0) > 0 THEN (
      WITH base_lines AS (
        SELECT
          item.id AS item_id,
          product.id AS product_id,
          product.keyinvoice_product_id AS provider_product_id,
          coalesce(nullif(product.code, ''), nullif(product.sku, '')) AS code,
          coalesce(nullif(item.name, ''), product.name) AS description,
          item.quantity,
          item.unit_price AS source_unit_price,
          item.discount_percent,
          coalesce(
            item.tax_value,
            product.tax_value,
            public._safe_numeric(organization.tax_config ->> 'tax_value')
          ) AS tax_rate,
          coalesce(
            nullif(item.tax_exemption_reason, ''),
            nullif(product.tax_exemption_reason, ''),
            nullif(organization.tax_config ->> 'tax_exemption_reason', '')
          ) AS tax_exemption_reason,
          coalesce(item.price_includes_vat, product.price_includes_vat, false)
            AS price_includes_vat,
          coalesce(item.retention_rate, product.retention_rate, 0)
            AS retention_rate,
          item.unit_price * item.quantity
            * (1 - item.discount_percent / 100.0) AS source_weight,
          sum(
            item.unit_price * item.quantity
            * (1 - item.discount_percent / 100.0)
          ) OVER () AS total_weight,
          row_number() OVER (ORDER BY item.id) AS line_number,
          count(*) OVER () AS line_count
        FROM public.sale_items item
        JOIN public.products product ON product.id = item.product_id
        WHERE item.sale_id = sale.id
          AND product.is_recurring = true
      ), rounded_lines AS (
        SELECT
          base_lines.*,
          CASE
            WHEN total_weight > 0
              THEN round(source_weight * cycle.amount / total_weight, 6)
            ELSE 0::numeric
          END AS rounded_line_total
        FROM base_lines
      ), frozen_lines AS (
        SELECT
          rounded_lines.*,
          CASE
            -- Put the sub-cent proportional residue on the final deterministic
            -- line, making sum(sourceLineTotal) exactly equal cycle.amount.
            WHEN line_number = line_count THEN cycle.amount - coalesce(
              sum(rounded_line_total) OVER (
                ORDER BY item_id
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ),
              0
            )
            ELSE rounded_line_total
          END AS source_line_total
        FROM rounded_lines
      )
      SELECT jsonb_agg(
        jsonb_build_object(
          'saleItemId', frozen.item_id,
          'productId', frozen.product_id,
          'providerProductId', frozen.provider_product_id,
          'code', frozen.code,
          'description', frozen.description,
          'quantity', frozen.quantity,
          -- unitPrice preserves the adjusted pre-discount gross unit value for
          -- audit. cycle.amount/sourceLineTotal are the gross amount charged.
          -- Workers must send billedUnitPrice, which has the discount allocated
          -- and removes IVA exactly once before KeyInvoice reapplies the tax.
          'unitPrice', CASE
            WHEN frozen.quantity > 0 AND frozen.discount_percent < 100 THEN
              frozen.source_line_total / frozen.quantity
                / (1 - frozen.discount_percent / 100.0)
            ELSE frozen.source_line_total / nullif(frozen.quantity, 0)
          END,
          'sourceUnitPrice', frozen.source_unit_price,
          'sourceLineTotal', frozen.source_line_total,
          'billedUnitPrice', round(
            frozen.source_line_total / nullif(frozen.quantity, 0)
              / CASE
                  WHEN coalesce(frozen.tax_rate, 0) > 0
                    THEN 1 + frozen.tax_rate / 100.0
                  ELSE 1
                END,
            6
          ),
          'taxRate', frozen.tax_rate,
          'taxExemptionReason', frozen.tax_exemption_reason,
          'discountPercent', frozen.discount_percent,
          'discountAmount', CASE
            WHEN frozen.discount_percent > 0 AND frozen.discount_percent < 100 THEN
              frozen.source_line_total / (1 - frozen.discount_percent / 100.0)
                - frozen.source_line_total
            ELSE 0
          END,
          'priceIncludesVat', frozen.price_includes_vat,
          'retentionRate', frozen.retention_rate
        ) ORDER BY frozen.item_id
      )
      FROM frozen_lines frozen
      )
      ELSE jsonb_build_array(jsonb_build_object(
        'saleItemId', NULL,
        'productId', NULL,
        'providerProductId', NULL,
        'code', 'SENVIA-REC-' || left(recurrence.id::text, 8),
        'description', 'Renovação recorrente' || CASE
          WHEN nullif(sale.code, '') IS NOT NULL THEN ' — ' || sale.code ELSE '' END,
        'quantity', 1,
        'unitPrice', cycle.amount,
        'sourceUnitPrice', cycle.amount,
        'sourceLineTotal', cycle.amount,
        'billedUnitPrice', round(
          cycle.amount / CASE
            WHEN coalesce(public._safe_numeric(organization.tax_config ->> 'tax_value'), 0) > 0
              THEN 1 + public._safe_numeric(organization.tax_config ->> 'tax_value') / 100.0
            ELSE 1
          END,
          6
        ),
        'taxRate', public._safe_numeric(organization.tax_config ->> 'tax_value'),
        'taxExemptionReason', nullif(organization.tax_config ->> 'tax_exemption_reason', ''),
        'discountPercent', 0,
        'discountAmount', 0,
        'priceIncludesVat', coalesce(
          organization.tax_config -> 'prices_include_vat',
          organization.tax_config -> 'prices_include_tax',
          'false'::jsonb
        ) = 'true'::jsonb,
        'retentionRate', 0,
        'synthetic', true
      ))
    END,
    'payment', CASE WHEN payment.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
      'id', payment.id,
      'amount', payment.amount,
      'date', payment.payment_date,
      'method', payment.payment_method,
      'status', payment.status,
      'reversalStatus', payment.reversal_status,
      'reversedAmount', payment.reversed_amount,
      'reversalReference', payment.reversal_reference,
      'reversedAt', payment.reversed_at
    ) END,
    'relatedDocument', CASE WHEN related_document.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
      'id', related_document.id,
      'kind', related_document.document_type,
      'providerDocumentTypeCode', related_document.provider_document_type_code,
      'series', related_document.provider_series,
      'number', related_document.provider_document_number,
      'reference', related_document.reference,
      'amount', related_document.total,
      'atcud', related_document.provider_atcud
    ) END,
    'totals', jsonb_build_object(
      'cycleAmount', cycle.amount,
      'recurringAmount', recurrence.amount,
      'saleSubtotal', sale.subtotal,
      'saleDiscount', sale.discount,
      'saleTotal', sale.total_value,
      'sourceLinesTotal', coalesce((
        SELECT sum(item.unit_price * item.quantity)
        FROM public.sale_items item
        JOIN public.products product ON product.id = item.product_id
        WHERE item.sale_id = sale.id AND product.is_recurring = true
      ), cycle.amount),
      'frozenLinesNetTotal', cycle.amount,
      'documentTotal', CASE
        WHEN p_document_kind IN ('receipt', 'credit_note')
          THEN coalesce(public._safe_numeric(p_extra ->> 'confirmed_amount'), payment.amount)
        ELSE cycle.amount
      END,
      'paidGross', (
        SELECT coalesce(sum(CASE WHEN cycle_payment.status = 'paid'
          THEN cycle_payment.amount ELSE 0 END), 0)
        FROM public.sale_payments cycle_payment
        WHERE cycle_payment.recurring_cycle_id = cycle.id
      ),
      'reversedAmount', (
        SELECT coalesce(sum(CASE
          WHEN cycle_payment.reversal_status IN ('refunded', 'chargeback', 'reversed')
            THEN cycle_payment.reversed_amount ELSE 0 END), 0)
        FROM public.sale_payments cycle_payment
        WHERE cycle_payment.recurring_cycle_id = cycle.id
      ),
      'paidNet', (
        SELECT coalesce(sum(
          CASE
            WHEN cycle_payment.status = 'paid' THEN
              cycle_payment.amount - CASE
                WHEN cycle_payment.reversal_status IN ('refunded', 'chargeback', 'reversed')
                  THEN cycle_payment.reversed_amount
                ELSE 0
              END
            ELSE 0
          END
        ), 0)
        FROM public.sale_payments cycle_payment
        WHERE cycle_payment.recurring_cycle_id = cycle.id
      )
    ),
    'series', organization.keyinvoice_series_config -> p_document_kind,
    'email', jsonb_build_object(
      'enabled', recurrence.fiscal_auto_email,
      'config', recurrence.fiscal_email_config,
      'recipientFallback', client.email
    ),
    'mappingComplete', coalesce((
      SELECT sum(
        recurring_item.unit_price * recurring_item.quantity
        * (1 - recurring_item.discount_percent / 100.0)
      )
      FROM public.sale_items recurring_item
      JOIN public.products recurring_product ON recurring_product.id = recurring_item.product_id
      WHERE recurring_item.sale_id = sale.id
        AND recurring_product.is_recurring = true
    ), 0) > 0 AND NOT EXISTS (
      SELECT 1
      FROM public.sale_items item
      JOIN public.products product ON product.id = item.product_id
      WHERE item.sale_id = sale.id
        AND product.is_recurring = true
        AND product.keyinvoice_product_id IS NULL
    ),
    'extra', coalesce(p_extra, '{}'::jsonb)
  )
  FROM public.sale_recurring_cycles cycle
  JOIN public.sale_recurrences recurrence
    ON recurrence.id = cycle.recurrence_id
   AND recurrence.sale_id = cycle.sale_id
   AND recurrence.organization_id = cycle.organization_id
  JOIN public.sales sale
    ON sale.id = cycle.sale_id
   AND sale.organization_id = cycle.organization_id
  JOIN public.organizations organization
    ON organization.id = cycle.organization_id
  LEFT JOIN public.crm_clients client ON client.id = sale.client_id
  LEFT JOIN public.sale_payments payment
    ON payment.id = p_payment_id
   AND payment.recurring_cycle_id = cycle.id
  LEFT JOIN public.invoices related_document
    ON related_document.id = p_related_invoice_id
   AND related_document.organization_id = cycle.organization_id
  WHERE cycle.id = p_cycle_id;
$$;

REVOKE ALL ON FUNCTION public.build_recurring_fiscal_snapshot(uuid,text,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_recurring_fiscal_snapshot(uuid,text,uuid,uuid,jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Queueing and aggregate cycle status
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refresh_recurring_cycle_fiscal_status(
  p_cycle_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recurrence public.sale_recurrences%rowtype;
  v_has_primary boolean;
  v_primary_id uuid;
  v_pending integer;
  v_processing integer;
  v_retry integer;
  v_failed integer;
  v_reconciliation integer;
  v_document_manual_review integer;
  v_issued integer;
  v_required_receipts integer;
  v_issued_receipts integer;
  v_email_pending integer;
  v_email_processing integer;
  v_email_retry integer;
  v_email_failed integer;
  v_email_sent integer;
  v_email_delivered integer;
  v_email_bounced integer;
  v_email_blocked integer;
  v_email_suppressed integer;
  v_email_total integer;
  v_manual_review boolean;
BEGIN
  SELECT recurrence.* INTO v_recurrence
  FROM public.sale_recurring_cycles cycle
  JOIN public.sale_recurrences recurrence ON recurrence.id = cycle.recurrence_id
  WHERE cycle.id = p_cycle_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    count(*) FILTER (WHERE processing_status = 'pending'),
    count(*) FILTER (WHERE processing_status = 'processing'),
    count(*) FILTER (WHERE processing_status = 'retry'),
    count(*) FILTER (WHERE processing_status = 'failed'),
    count(*) FILTER (WHERE processing_status IN ('reconciliation_required', 'reconciling')),
    count(*) FILTER (WHERE processing_status = 'manual_review'),
    count(*) FILTER (WHERE processing_status = 'issued'),
    bool_or(document_type IN ('invoice', 'invoice_receipt') AND processing_status = 'issued'),
    min(id::text) FILTER (
      WHERE document_type IN ('invoice', 'invoice_receipt') AND processing_status = 'issued'
    )::uuid,
    count(*) FILTER (WHERE document_type = 'receipt' AND processing_status = 'issued'),
    count(*) FILTER (WHERE processing_status = 'issued' AND email_status IN (
      'pending', 'retry', 'processing', 'failed', 'sent', 'delivered', 'bounced',
      'blocked', 'suppressed'
    )),
    count(*) FILTER (WHERE processing_status = 'issued' AND email_status = 'pending'),
    count(*) FILTER (WHERE processing_status = 'issued' AND email_status = 'processing'),
    count(*) FILTER (WHERE processing_status = 'issued' AND email_status = 'retry'),
    count(*) FILTER (WHERE processing_status = 'issued' AND email_status = 'failed'),
    count(*) FILTER (WHERE processing_status = 'issued' AND email_status = 'sent'),
    count(*) FILTER (WHERE processing_status = 'issued' AND email_status = 'delivered'),
    count(*) FILTER (WHERE processing_status = 'issued' AND email_status = 'bounced'),
    count(*) FILTER (WHERE processing_status = 'issued' AND email_status = 'blocked'),
    count(*) FILTER (WHERE processing_status = 'issued' AND email_status = 'suppressed')
  INTO
    v_pending, v_processing, v_retry, v_failed, v_reconciliation,
    v_document_manual_review, v_issued,
    v_has_primary, v_primary_id, v_issued_receipts,
    v_email_total, v_email_pending, v_email_processing,
    v_email_retry, v_email_failed, v_email_sent, v_email_delivered,
    v_email_bounced, v_email_blocked, v_email_suppressed
  FROM public.invoices invoice
  WHERE invoice.recurring_cycle_id = p_cycle_id
    AND invoice.processing_status NOT IN ('cancelled', 'void');

  SELECT count(*) INTO v_required_receipts
  FROM public.sale_payments payment
  WHERE payment.recurring_cycle_id = p_cycle_id
    AND payment.status = 'paid'
    AND payment.reversal_status = 'none';

  SELECT fiscal_status = 'manual_review'
  INTO v_manual_review
  FROM public.sale_recurring_cycles
  WHERE id = p_cycle_id;

  UPDATE public.sale_recurring_cycles
  SET
    fiscal_primary_invoice_id = coalesce(v_primary_id, fiscal_primary_invoice_id),
    fiscal_status = CASE
      WHEN v_recurrence.fiscal_mode = 'manual' THEN 'not_scheduled'
      WHEN v_manual_review OR v_document_manual_review > 0 OR v_reconciliation > 0
        THEN 'manual_review'
      WHEN v_processing > 0 THEN 'processing'
      WHEN v_failed > 0 THEN 'failed'
      WHEN v_retry > 0 THEN 'retry'
      WHEN v_pending > 0 THEN 'pending'
      WHEN v_recurrence.fiscal_document_policy = 'invoice_receipt_when_paid'
        AND v_has_primary THEN 'completed'
      WHEN v_recurrence.fiscal_document_policy = 'invoice_then_receipt'
        AND v_has_primary AND v_issued_receipts >= v_required_receipts THEN
          CASE WHEN v_required_receipts > 0 THEN 'completed' ELSE 'partial' END
      WHEN v_issued > 0 THEN 'partial'
      ELSE 'pending'
    END,
    fiscal_email_status = CASE
      WHEN NOT v_recurrence.fiscal_auto_email THEN 'suppressed'
      WHEN v_email_processing > 0 THEN 'processing'
      WHEN v_email_blocked > 0 THEN 'blocked'
      WHEN v_email_bounced > 0 THEN 'bounced'
      WHEN v_email_failed > 0 THEN 'failed'
      WHEN v_email_retry > 0 THEN 'retry'
      WHEN v_email_pending > 0 THEN 'pending'
      WHEN v_email_total > 0 AND v_email_suppressed = v_email_total THEN 'suppressed'
      WHEN v_email_total > 0 AND v_email_delivered = v_email_total THEN 'delivered'
      WHEN v_email_total > 0 AND v_email_sent + v_email_delivered = v_email_total THEN 'sent'
      WHEN v_email_sent + v_email_delivered + v_email_suppressed > 0 THEN 'partial'
      ELSE 'not_requested'
    END
  WHERE id = p_cycle_id;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_recurring_cycle_fiscal_status(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_recurring_cycle_fiscal_status(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_cycle_after_fiscal_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_cycle_id uuid;
  v_old_cycle_id uuid;
BEGIN
  v_new_cycle_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.recurring_cycle_id END;
  v_old_cycle_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.recurring_cycle_id END;

  IF v_old_cycle_id IS NOT NULL THEN
    PERFORM public.refresh_recurring_cycle_fiscal_status(v_old_cycle_id);
  END IF;
  IF v_new_cycle_id IS NOT NULL AND v_new_cycle_id IS DISTINCT FROM v_old_cycle_id THEN
    PERFORM public.refresh_recurring_cycle_fiscal_status(v_new_cycle_id);
  ELSIF v_new_cycle_id IS NOT NULL AND v_old_cycle_id IS NULL THEN
    PERFORM public.refresh_recurring_cycle_fiscal_status(v_new_cycle_id);
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_cycle_after_fiscal_document()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS refresh_cycle_after_fiscal_document_trg ON public.invoices;
CREATE TRIGGER refresh_cycle_after_fiscal_document_trg
AFTER INSERT OR UPDATE OR DELETE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.refresh_cycle_after_fiscal_document();

CREATE OR REPLACE FUNCTION public._queue_recurring_fiscal_document(
  p_cycle_id uuid,
  p_document_kind text,
  p_payment_id uuid DEFAULT NULL,
  p_related_invoice_id uuid DEFAULT NULL,
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cycle public.sale_recurring_cycles%rowtype;
  v_recurrence public.sale_recurrences%rowtype;
  v_org public.organizations%rowtype;
  v_payment public.sale_payments%rowtype;
  v_related public.invoices%rowtype;
  v_snapshot jsonb;
  v_document_total numeric(12, 2);
  v_net_paid numeric(12, 2);
  v_has_reversal boolean;
  v_idempotency_key text;
  v_invoice public.invoices%rowtype;
  v_series_config jsonb;
BEGIN
  IF p_document_kind NOT IN ('invoice', 'invoice_receipt', 'receipt', 'credit_note') THEN
    RAISE EXCEPTION 'Unsupported fiscal document kind'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO STRICT v_cycle
  FROM public.sale_recurring_cycles
  WHERE id = p_cycle_id
  FOR UPDATE;

  SELECT * INTO STRICT v_recurrence
  FROM public.sale_recurrences
  WHERE id = v_cycle.recurrence_id;

  SELECT * INTO STRICT v_org
  FROM public.organizations
  WHERE id = v_cycle.organization_id;

  IF v_recurrence.fiscal_mode <> 'automatic' THEN
    RAISE EXCEPTION 'Automatic fiscal issuance is not enabled for this recurrence'
      USING ERRCODE = '23514';
  END IF;
  IF v_org.billing_provider IS DISTINCT FROM 'keyinvoice' THEN
    RAISE EXCEPTION 'The organization fiscal provider is not KeyInvoice'
      USING ERRCODE = '23514';
  END IF;
  IF v_org.integrations_enabled -> 'keyinvoice' IS DISTINCT FROM 'true'::jsonb
     OR v_org.tem_keyinvoice_password IS NOT TRUE THEN
    RAISE EXCEPTION 'The KeyInvoice integration is disabled or has no configured credential'
      USING ERRCODE = '23514';
  END IF;

  v_series_config := v_org.keyinvoice_series_config -> p_document_kind;
  IF jsonb_typeof(v_series_config) IS DISTINCT FROM 'object'
     OR nullif(btrim(v_series_config ->> 'series'), '') IS NULL
     OR nullif(btrim(v_series_config ->> 'provider_document_type_code'), '') IS NULL THEN
    RAISE EXCEPTION 'KeyInvoice series is not configured for %', p_document_kind
      USING ERRCODE = '23514';
  END IF;
  IF p_document_kind = 'invoice'
     AND v_series_config ->> 'provider_document_type_code' <> '4' THEN
    RAISE EXCEPTION 'KeyInvoice invoice document type must be 4 (FT)'
      USING ERRCODE = '23514';
  END IF;
  IF p_document_kind = 'invoice_receipt'
     AND v_series_config ->> 'provider_document_type_code' <> '34' THEN
    RAISE EXCEPTION 'KeyInvoice invoice-receipt document type must be 34 (FR)'
      USING ERRCODE = '23514';
  END IF;

  IF p_payment_id IS NOT NULL THEN
    SELECT * INTO STRICT v_payment
    FROM public.sale_payments
    WHERE id = p_payment_id
      AND recurring_cycle_id = v_cycle.id
      AND sale_id = v_cycle.sale_id
      AND organization_id = v_cycle.organization_id;
  END IF;

  IF p_related_invoice_id IS NOT NULL THEN
    SELECT * INTO STRICT v_related
    FROM public.invoices
    WHERE id = p_related_invoice_id
      AND organization_id = v_cycle.organization_id;
  END IF;

  IF p_document_kind = 'invoice_receipt' THEN
    IF p_payment_id IS NOT NULL OR p_related_invoice_id IS NOT NULL THEN
      RAISE EXCEPTION 'FR jobs cannot be tied to a single payment/source document'
        USING ERRCODE = '23514';
    END IF;

    SELECT
      coalesce(sum(CASE WHEN payment.status = 'paid'
        THEN payment.amount - CASE
          WHEN payment.reversal_status IN ('refunded', 'chargeback', 'reversed')
            THEN payment.reversed_amount
          ELSE 0
        END
        ELSE 0 END), 0),
      coalesce(bool_or(payment.reversal_status <> 'none'), false)
    INTO v_net_paid, v_has_reversal
    FROM public.sale_payments payment
    WHERE payment.recurring_cycle_id = v_cycle.id;

    IF v_cycle.status <> 'paid'
       OR v_net_paid < v_cycle.amount
       OR v_has_reversal THEN
      RAISE EXCEPTION 'Fatura-recibo requires a fully paid, undisputed cycle'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.invoices invoice
      WHERE invoice.recurring_cycle_id = v_cycle.id
        AND invoice.document_type = 'invoice'
        AND invoice.processing_status NOT IN ('cancelled', 'void')
    ) THEN
      RAISE EXCEPTION 'Fatura-recibo cannot be queued after an invoice for the same cycle'
        USING ERRCODE = '23514';
    END IF;
    v_document_total := v_cycle.amount;
    v_idempotency_key := 'fiscal:cycle:' || v_cycle.id::text || ':invoice_receipt';
  ELSIF p_document_kind = 'receipt' THEN
    IF p_payment_id IS NULL
       OR v_payment.status <> 'paid'
       OR v_payment.reversal_status <> 'none'
       OR p_related_invoice_id IS NULL
       OR v_related.document_type <> 'invoice'
       OR v_related.processing_status <> 'issued'
       OR v_related.recurring_cycle_id IS DISTINCT FROM v_cycle.id THEN
      RAISE EXCEPTION 'Receipt requires an unreversed paid payment and its issued FT'
        USING ERRCODE = '23514';
    END IF;
    v_document_total := v_payment.amount;
    v_idempotency_key := 'fiscal:cycle:' || v_cycle.id::text || ':receipt:payment:' || v_payment.id::text;
  ELSIF p_document_kind = 'credit_note' THEN
    IF p_related_invoice_id IS NULL
       OR v_related.processing_status <> 'issued'
       OR v_related.recurring_cycle_id IS DISTINCT FROM v_cycle.id
       OR coalesce((p_extra ->> 'confirmed_amount')::numeric, 0) <= 0
       OR (
         nullif(btrim(p_extra ->> 'reversal_reference'), '') IS NULL
         AND p_payment_id IS NULL
       ) THEN
      RAISE EXCEPTION 'Credit note requires an issued source document, confirmed_amount and a stable reversal/payment reference'
        USING ERRCODE = '23514';
    END IF;
    v_document_total := (p_extra ->> 'confirmed_amount')::numeric;
    IF v_document_total > coalesce(v_related.total, 0) THEN
      RAISE EXCEPTION 'Credit note amount exceeds source document total'
        USING ERRCODE = '23514';
    END IF;
    v_idempotency_key := 'fiscal:cycle:' || v_cycle.id::text || ':credit_note:'
      || coalesce(nullif(btrim(p_extra ->> 'reversal_reference'), ''), p_payment_id::text);
  ELSE
    IF p_payment_id IS NOT NULL OR p_related_invoice_id IS NOT NULL THEN
      RAISE EXCEPTION 'FT/FR jobs cannot be tied to a single payment/source document'
        USING ERRCODE = '23514';
    END IF;
    IF p_document_kind = 'invoice'
       AND v_cycle.due_date > (clock_timestamp() AT TIME ZONE 'Europe/Lisbon')::date THEN
      RAISE EXCEPTION 'Invoice cannot be queued before the recurring cycle due date'
        USING ERRCODE = '23514';
    END IF;
    v_document_total := v_cycle.amount;
    v_idempotency_key := 'fiscal:cycle:' || v_cycle.id::text || ':' || p_document_kind;
  END IF;

  v_snapshot := public.build_recurring_fiscal_snapshot(
    p_cycle_id,
    p_document_kind,
    p_payment_id,
    p_related_invoice_id,
    coalesce(p_extra, '{}'::jsonb)
  );

  IF v_snapshot IS NULL OR v_snapshot = '{}'::jsonb THEN
    RAISE EXCEPTION 'Could not build the immutable fiscal snapshot'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.invoices (
    organization_id,
    invoicexpress_id,
    document_type,
    status,
    total,
    date,
    due_date,
    sale_id,
    payment_id,
    recurring_cycle_id,
    related_invoice_id,
    provider,
    provider_document_type_code,
    provider_series,
    fiscal_idempotency_key,
    fiscal_snapshot,
    processing_status,
    email_status,
    created_at,
    updated_at
  ) VALUES (
    v_cycle.organization_id,
    NULL,
    p_document_kind,
    'queued',
    v_document_total,
    (clock_timestamp() AT TIME ZONE 'Europe/Lisbon')::date,
    v_cycle.due_date,
    v_cycle.sale_id,
    p_payment_id,
    v_cycle.id,
    p_related_invoice_id,
    'keyinvoice',
    v_series_config ->> 'provider_document_type_code',
    v_series_config ->> 'series',
    v_idempotency_key,
    v_snapshot,
    'pending',
    'not_requested',
    now(),
    now()
  )
  ON CONFLICT (organization_id, fiscal_idempotency_key)
  DO UPDATE SET fiscal_idempotency_key = EXCLUDED.fiscal_idempotency_key
  RETURNING * INTO v_invoice;

  UPDATE public.sale_recurring_cycles
  SET
    fiscal_snapshot = CASE
      WHEN fiscal_snapshot = '{}'::jsonb THEN jsonb_build_object(
        'schema_version', 1,
        'captured_at', clock_timestamp(),
        'recurrence_config', jsonb_build_object(
          'fiscal_mode', v_recurrence.fiscal_mode,
          'document_policy', v_recurrence.fiscal_document_policy,
          'auto_email', v_recurrence.fiscal_auto_email,
          'auto_credit_note', v_recurrence.fiscal_auto_credit_note,
          'email_config', v_recurrence.fiscal_email_config
        ),
        'cycle', to_jsonb(v_cycle),
        'series_config', v_org.keyinvoice_series_config
      )
      ELSE fiscal_snapshot
    END,
    fiscal_status = CASE
      WHEN fiscal_status = 'not_scheduled' THEN 'pending'
      ELSE fiscal_status
    END,
    fiscal_last_error = NULL
  WHERE id = v_cycle.id;

  RETURN v_invoice;
END;
$$;

REVOKE ALL ON FUNCTION public._queue_recurring_fiscal_document(uuid,text,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.queue_recurring_fiscal_document(
  p_cycle_id uuid,
  p_document_kind text,
  p_payment_id uuid DEFAULT NULL,
  p_related_invoice_id uuid DEFAULT NULL,
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  RETURN public._queue_recurring_fiscal_document(
    p_cycle_id, p_document_kind, p_payment_id, p_related_invoice_id, p_extra
  );
END;
$$;

REVOKE ALL ON FUNCTION public.queue_recurring_fiscal_document(uuid,text,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_recurring_fiscal_document(uuid,text,uuid,uuid,jsonb)
  TO service_role;

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
  IF v_recurrence.fiscal_mode <> 'automatic' OR v_cycle.due_date > v_today THEN
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

REVOKE ALL ON FUNCTION public.schedule_recurring_fiscal_documents_for_cycle(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_recurring_fiscal_documents_for_cycle(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.schedule_fiscal_after_cycle_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.schedule_recurring_fiscal_documents_for_cycle(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_fiscal_after_cycle_insert()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_schedule_fiscal_after_cycle_insert_trg
  ON public.sale_recurring_cycles;
CREATE TRIGGER zz_schedule_fiscal_after_cycle_insert_trg
AFTER INSERT ON public.sale_recurring_cycles
FOR EACH ROW
EXECUTE FUNCTION public.schedule_fiscal_after_cycle_insert();

CREATE OR REPLACE FUNCTION public.schedule_fiscal_after_payment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_cycle_id uuid;
  v_old_cycle_id uuid;
BEGIN
  v_new_cycle_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.recurring_cycle_id END;
  v_old_cycle_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.recurring_cycle_id END;

  IF v_old_cycle_id IS NOT NULL THEN
    PERFORM public.schedule_recurring_fiscal_documents_for_cycle(v_old_cycle_id);
  END IF;
  IF v_new_cycle_id IS NOT NULL AND v_new_cycle_id IS DISTINCT FROM v_old_cycle_id THEN
    PERFORM public.schedule_recurring_fiscal_documents_for_cycle(v_new_cycle_id);
  ELSIF v_new_cycle_id IS NOT NULL AND v_old_cycle_id IS NULL THEN
    PERFORM public.schedule_recurring_fiscal_documents_for_cycle(v_new_cycle_id);
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_fiscal_after_payment_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_schedule_fiscal_after_payment_change_trg
  ON public.sale_payments;
CREATE TRIGGER zz_schedule_fiscal_after_payment_change_trg
AFTER INSERT OR UPDATE OF status, amount, payment_date, recurring_cycle_id,
  reversal_status, reversed_amount, reversal_reference, reversed_at OR DELETE
ON public.sale_payments
FOR EACH ROW
EXECUTE FUNCTION public.schedule_fiscal_after_payment_change();

-- ---------------------------------------------------------------------------
-- 7. Customer configuration and controlled retry RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.configure_keyinvoice_series(
  p_organization_id uuid,
  p_config jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text;
  v_value jsonb;
BEGIN
  IF NOT public.is_org_admin(auth.uid(), p_organization_id)
     OR NOT public.meets_mfa_policy(auth.uid())
     OR NOT public.has_module_permission(
       auth.uid(), p_organization_id, 'finance', 'invoices', 'issue'
     ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_config) IS DISTINCT FROM 'object'
     OR octet_length(p_config::text) > 16384 THEN
    RAISE EXCEPTION 'Invalid KeyInvoice series configuration'
      USING ERRCODE = '23514';
  END IF;

  FOR v_key, v_value IN SELECT * FROM jsonb_each(p_config)
  LOOP
    IF v_key NOT IN ('invoice', 'invoice_receipt', 'receipt', 'credit_note')
       OR jsonb_typeof(v_value) IS DISTINCT FROM 'object'
       OR nullif(btrim(v_value ->> 'series'), '') IS NULL
       OR nullif(btrim(v_value ->> 'provider_document_type_code'), '') IS NULL
       OR length(v_value ->> 'series') > 100
       OR length(v_value ->> 'provider_document_type_code') > 50
       OR EXISTS (
         SELECT 1
         FROM jsonb_object_keys(v_value) AS nested(key_name)
         WHERE key_name NOT IN (
           'series', 'provider_document_type_code', 'validation_code', 'atcud_mode'
         )
       ) THEN
      RAISE EXCEPTION 'Invalid KeyInvoice series entry: %', v_key
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- API 5 uses fixed type codes for these documents. Rejecting a mismatched
  -- configuration here prevents a perfectly valid series from being used with
  -- the wrong certified document kind.
  IF p_config ? 'invoice'
     AND p_config #>> '{invoice,provider_document_type_code}' <> '4' THEN
    RAISE EXCEPTION 'KeyInvoice invoice document type must be 4 (FT)'
      USING ERRCODE = '23514';
  END IF;
  IF p_config ? 'invoice_receipt'
     AND p_config #>> '{invoice_receipt,provider_document_type_code}' <> '34' THEN
    RAISE EXCEPTION 'KeyInvoice invoice-receipt document type must be 34 (FR)'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.organizations
  SET keyinvoice_series_config = p_config
  WHERE id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN p_config;
END;
$$;

REVOKE ALL ON FUNCTION public.configure_keyinvoice_series(uuid,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.configure_keyinvoice_series(uuid,jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.configure_sale_recurrence_fiscal(
  p_recurrence_id uuid,
  p_fiscal_mode text,
  p_document_policy text,
  p_auto_email boolean,
  p_email_config jsonb DEFAULT '{}'::jsonb,
  p_auto_credit_note boolean DEFAULT false
)
RETURNS public.sale_recurrences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recurrence public.sale_recurrences%rowtype;
  v_org public.organizations%rowtype;
  v_kind text;
BEGIN
  SELECT * INTO STRICT v_recurrence
  FROM public.sale_recurrences
  WHERE id = p_recurrence_id
  FOR UPDATE;

  IF NOT public.meets_mfa_policy(auth.uid())
     OR NOT public.has_module_permission(
       auth.uid(), v_recurrence.organization_id, 'finance', 'invoices', 'issue'
     ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_fiscal_mode NOT IN ('manual', 'automatic')
     OR p_document_policy NOT IN ('invoice_then_receipt', 'invoice_receipt_when_paid')
     OR jsonb_typeof(coalesce(p_email_config, '{}'::jsonb)) IS DISTINCT FROM 'object'
     OR octet_length(coalesce(p_email_config, '{}'::jsonb)::text) > 16384 THEN
    RAISE EXCEPTION 'Invalid recurring fiscal configuration'
      USING ERRCODE = '23514';
  END IF;

  IF coalesce(p_auto_credit_note, false) THEN
    RAISE EXCEPTION 'Automatic credit notes are disabled until the KeyInvoice demo contract is homologated'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO STRICT v_org
  FROM public.organizations
  WHERE id = v_recurrence.organization_id;

  IF p_fiscal_mode = 'automatic' THEN
    IF v_org.billing_provider IS DISTINCT FROM 'keyinvoice' THEN
      RAISE EXCEPTION 'KeyInvoice must be the active fiscal provider'
        USING ERRCODE = '23514';
    END IF;
    IF v_org.integrations_enabled -> 'keyinvoice' IS DISTINCT FROM 'true'::jsonb
       OR v_org.tem_keyinvoice_password IS NOT TRUE THEN
      RAISE EXCEPTION 'Enable KeyInvoice and configure its credential before activating automatic issuance'
        USING ERRCODE = '23514';
    END IF;

    FOREACH v_kind IN ARRAY CASE
      WHEN p_document_policy = 'invoice_then_receipt'
        THEN ARRAY['invoice', 'receipt']::text[]
      ELSE ARRAY['invoice_receipt']::text[]
    END
    LOOP
      IF jsonb_typeof(v_org.keyinvoice_series_config -> v_kind) IS DISTINCT FROM 'object'
         OR nullif(btrim(v_org.keyinvoice_series_config #>> ARRAY[v_kind, 'series']), '') IS NULL
         OR nullif(btrim(v_org.keyinvoice_series_config #>> ARRAY[v_kind, 'provider_document_type_code']), '') IS NULL THEN
        RAISE EXCEPTION 'Configure the KeyInvoice % series before activating automatic issuance', v_kind
          USING ERRCODE = '23514';
      END IF;
    END LOOP;

    IF p_auto_credit_note AND (
      jsonb_typeof(v_org.keyinvoice_series_config -> 'credit_note') IS DISTINCT FROM 'object'
      OR nullif(btrim(v_org.keyinvoice_series_config #>> '{credit_note,series}'), '') IS NULL
      OR nullif(btrim(v_org.keyinvoice_series_config #>> '{credit_note,provider_document_type_code}'), '') IS NULL
    ) THEN
      RAISE EXCEPTION 'Configure the KeyInvoice credit_note series before enabling automatic credit notes'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_recurrence.fiscal_document_policy IS DISTINCT FROM p_document_policy
     AND EXISTS (
       SELECT 1
       FROM public.sale_recurring_cycles cycle
       JOIN public.invoices invoice ON invoice.recurring_cycle_id = cycle.id
       WHERE cycle.recurrence_id = v_recurrence.id
         AND invoice.processing_status NOT IN ('cancelled', 'void', 'legacy')
     ) THEN
    RAISE EXCEPTION 'Document policy cannot change after fiscal documents were queued'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.sale_recurrences
  SET
    fiscal_mode = p_fiscal_mode,
    fiscal_document_policy = p_document_policy,
    fiscal_auto_email = coalesce(p_auto_email, false),
    fiscal_auto_credit_note = coalesce(p_auto_credit_note, false),
    fiscal_email_config = coalesce(p_email_config, '{}'::jsonb),
    fiscal_configured_at = now(),
    fiscal_configured_by = auth.uid()
  WHERE id = p_recurrence_id
  RETURNING * INTO v_recurrence;

  IF p_fiscal_mode = 'manual' THEN
    -- Preserve the durable/idempotent job and immutable snapshot. The claim
    -- RPC joins the recurrence and will not claim it while mode is manual;
    -- re-enabling automatic mode safely resumes the same document.
    PERFORM public.refresh_recurring_cycle_fiscal_status(cycle.id)
    FROM public.sale_recurring_cycles cycle
    WHERE cycle.recurrence_id = v_recurrence.id
      AND cycle.period_start <= (clock_timestamp() AT TIME ZONE 'Europe/Lisbon')::date;
  ELSE
    PERFORM public.schedule_recurring_fiscal_documents_for_cycle(cycle.id)
    FROM public.sale_recurring_cycles cycle
    WHERE cycle.recurrence_id = v_recurrence.id
      AND cycle.period_start <= (clock_timestamp() AT TIME ZONE 'Europe/Lisbon')::date;
  END IF;

  RETURN v_recurrence;
END;
$$;

REVOKE ALL ON FUNCTION public.configure_sale_recurrence_fiscal(uuid,text,text,boolean,jsonb,boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.configure_sale_recurrence_fiscal(uuid,text,text,boolean,jsonb,boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.retry_recurring_fiscal_cycle(
  p_cycle_id uuid
)
RETURNS public.sale_recurring_cycles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cycle public.sale_recurring_cycles%rowtype;
BEGIN
  SELECT * INTO STRICT v_cycle
  FROM public.sale_recurring_cycles
  WHERE id = p_cycle_id
  FOR UPDATE;

  IF NOT public.meets_mfa_policy(auth.uid())
     OR NOT public.has_module_permission(
       auth.uid(), v_cycle.organization_id, 'finance', 'invoices', 'issue'
     ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.invoices
  SET processing_next_retry_at = now()
  WHERE recurring_cycle_id = p_cycle_id
    AND processing_status = 'retry';

  UPDATE public.invoices
  SET email_next_retry_at = now()
  WHERE recurring_cycle_id = p_cycle_id
    AND processing_status = 'issued'
    AND email_status = 'retry';

  IF NOT FOUND AND v_cycle.fiscal_status NOT IN ('retry')
     AND v_cycle.fiscal_email_status NOT IN ('retry') THEN
    RAISE EXCEPTION 'Only explicitly retryable work can be retried without reconciliation'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO STRICT v_cycle
  FROM public.sale_recurring_cycles
  WHERE id = p_cycle_id;
  RETURN v_cycle;
END;
$$;

REVOKE ALL ON FUNCTION public.retry_recurring_fiscal_cycle(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_recurring_fiscal_cycle(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Service-only issue, reconciliation and email claims
-- ---------------------------------------------------------------------------

-- Cycles are commonly created before their due date. Insert/update triggers
-- cannot wake themselves when Lisbon reaches that date, so the issue worker
-- first asks the database to schedule any now-due primary documents. The
-- document queue remains idempotent and is still the only place that writes a
-- fiscal job.
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

REVOKE ALL ON FUNCTION public.schedule_due_recurring_fiscal_documents(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_due_recurring_fiscal_documents(integer)
  TO service_role;

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

REVOKE ALL ON FUNCTION public.claim_recurring_fiscal_documents(integer,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_recurring_fiscal_documents(integer,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_recurring_fiscal_document(
  p_invoice_id uuid,
  p_claim_token uuid,
  p_invoicexpress_id integer,
  p_provider_document_type_code text,
  p_provider_series text,
  p_provider_document_number text,
  p_reference text,
  p_provider_status text,
  p_pdf_path text,
  p_raw_data jsonb,
  p_provider_atcud text DEFAULT NULL,
  p_issued_at timestamptz DEFAULT now()
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice public.invoices%rowtype;
  v_was_reconciling boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_provider_document_type_code), '') IS NULL
     OR nullif(btrim(p_provider_series), '') IS NULL
     OR nullif(btrim(p_provider_document_number), '') IS NULL THEN
    RAISE EXCEPTION 'Complete provider identity is required'
      USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(coalesce(p_raw_data, '{}'::jsonb)) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Provider response metadata must be a JSON object'
      USING ERRCODE = '23514';
  END IF;

  SELECT invoice.processing_status = 'reconciling'
  INTO v_was_reconciling
  FROM public.invoices invoice
  WHERE invoice.id = p_invoice_id
    AND invoice.processing_claim_token = p_claim_token;

  UPDATE public.invoices invoice
  SET
    invoicexpress_id = p_invoicexpress_id,
    provider_document_type_code = p_provider_document_type_code,
    provider_series = p_provider_series,
    provider_document_number = p_provider_document_number,
    provider_atcud = nullif(btrim(p_provider_atcud), ''),
    reference = p_reference,
    status = p_provider_status,
    pdf_path = p_pdf_path,
    raw_data = coalesce(p_raw_data, '{}'::jsonb) || jsonb_build_object(
      'source', 'keyinvoice',
      'provider', 'keyinvoice',
      'docType', p_provider_document_type_code,
      'docSeries', p_provider_series,
      'docNum', p_provider_document_number,
      'fullDocNumber', p_reference,
      'identityKey', 'keyinvoice:' || p_provider_document_type_code || ':'
        || p_provider_series || ':' || p_provider_document_number,
      'fiscalDate', invoice.fiscal_snapshot ->> 'fiscalDate',
      'snapshot', invoice.fiscal_snapshot,
      'atcud', nullif(btrim(p_provider_atcud), '')
    ),
    processing_status = 'issued',
    processing_claim_token = NULL,
    processing_claimed_at = NULL,
    processing_next_retry_at = NULL,
    processing_last_error = NULL,
    issued_at = coalesce(p_issued_at, now()),
    reconciled_at = CASE
      WHEN invoice.processing_status = 'reconciling' THEN now()
      ELSE invoice.reconciled_at
    END,
    email_status = CASE
      WHEN coalesce((invoice.fiscal_snapshot #>> '{email,enabled}')::boolean, false)
        THEN 'pending'
      ELSE 'suppressed'
    END,
    updated_at = now()
  WHERE invoice.id = p_invoice_id
    AND invoice.processing_status IN ('processing', 'reconciling')
    AND invoice.processing_claim_token = p_claim_token
    AND invoice.provider_document_type_code = p_provider_document_type_code
    AND invoice.provider_series = p_provider_series
  RETURNING * INTO v_invoice;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Fiscal document claim is missing or stale'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.sale_recurring_cycles
  SET fiscal_status = CASE WHEN v_was_reconciling THEN 'pending' ELSE fiscal_status END,
      fiscal_claim_token = NULL,
      fiscal_claimed_at = NULL,
      fiscal_last_error = NULL
  WHERE id = v_invoice.recurring_cycle_id
    AND fiscal_claim_token = p_claim_token;

  PERFORM public.schedule_recurring_fiscal_documents_for_cycle(v_invoice.recurring_cycle_id);
  PERFORM public.refresh_recurring_cycle_fiscal_status(v_invoice.recurring_cycle_id);
  RETURN v_invoice;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_recurring_fiscal_document(uuid,uuid,integer,text,text,text,text,text,text,jsonb,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_recurring_fiscal_document(uuid,uuid,integer,text,text,text,text,text,text,jsonb,text,timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fail_recurring_fiscal_document(
  p_invoice_id uuid,
  p_claim_token uuid,
  p_error text,
  p_failure_mode text DEFAULT 'manual_review',
  p_retry_after timestamptz DEFAULT NULL
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice public.invoices%rowtype;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_failure_mode NOT IN ('retry', 'reconciliation_required', 'manual_review') THEN
    RAISE EXCEPTION 'Unsupported fiscal failure mode'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.invoices invoice
  SET
    processing_status = p_failure_mode,
    processing_next_retry_at = CASE
      WHEN p_failure_mode = 'retry' THEN coalesce(p_retry_after, now() + interval '15 minutes')
      ELSE NULL
    END,
    processing_claim_token = NULL,
    processing_claimed_at = NULL,
    processing_last_error = left(coalesce(p_error, 'Unknown fiscal worker failure'), 4000),
    updated_at = now()
  WHERE invoice.id = p_invoice_id
    AND invoice.processing_status = 'processing'
    AND invoice.processing_claim_token = p_claim_token
  RETURNING * INTO v_invoice;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Fiscal document claim is missing or stale'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.sale_recurring_cycles
  SET
    fiscal_status = CASE WHEN p_failure_mode = 'retry' THEN 'retry' ELSE 'manual_review' END,
    fiscal_next_retry_at = CASE
      WHEN p_failure_mode = 'retry' THEN coalesce(p_retry_after, now() + interval '15 minutes')
      ELSE NULL
    END,
    fiscal_claim_token = NULL,
    fiscal_claimed_at = NULL,
    fiscal_last_error = left(coalesce(p_error, 'Unknown fiscal worker failure'), 4000)
  WHERE id = v_invoice.recurring_cycle_id
    AND fiscal_claim_token = p_claim_token;

  RETURN v_invoice;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_recurring_fiscal_document(uuid,uuid,text,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_recurring_fiscal_document(uuid,uuid,text,text,timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_fiscal_reconciliation(
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
    WHERE invoice.recurring_cycle_id IS NOT NULL
      AND invoice.provider = 'keyinvoice'
      AND invoice.provider_document_number IS NULL
      AND (
        invoice.processing_status = 'reconciliation_required'
         OR (
           invoice.processing_status = 'processing'
           AND invoice.processing_claimed_at < now() - interval '15 minutes'
         )
         OR (
           invoice.processing_status = 'reconciling'
           AND invoice.processing_claimed_at < now() - interval '15 minutes'
         )
       )
    ORDER BY invoice.created_at, invoice.id
    LIMIT greatest(1, least(coalesce(p_limit, 25), 100))
    FOR UPDATE SKIP LOCKED
  )
  , claimed AS (
  UPDATE public.invoices invoice
  SET
    processing_status = 'reconciling',
    processing_claim_token = p_worker_id,
    processing_claimed_at = now(),
    processing_last_error = coalesce(invoice.processing_last_error, 'Pending reconciliation'),
    updated_at = now()
  FROM candidates
  WHERE invoice.id = candidates.id
  RETURNING invoice.*
  ), cycles AS (
    UPDATE public.sale_recurring_cycles cycle
    SET fiscal_status = 'manual_review',
        fiscal_claim_token = p_worker_id,
        fiscal_claimed_at = now(),
        fiscal_last_error = 'Reconciliação fiscal em curso.'
    WHERE cycle.id IN (SELECT recurring_cycle_id FROM claimed)
    RETURNING cycle.id
  )
  SELECT claimed.* FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_fiscal_reconciliation(integer,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_fiscal_reconciliation(integer,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mark_fiscal_reconciliation_unresolved(
  p_invoice_id uuid,
  p_claim_token uuid,
  p_error text
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice public.invoices%rowtype;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.invoices invoice
  SET
    processing_status = 'manual_review',
    processing_claim_token = NULL,
    processing_claimed_at = NULL,
    processing_last_error = left(coalesce(p_error, 'Reconciliation did not find a definitive provider document'), 4000),
    reconciled_at = now(),
    updated_at = now()
  WHERE invoice.id = p_invoice_id
    AND invoice.processing_status = 'reconciling'
    AND invoice.processing_claim_token = p_claim_token
  RETURNING * INTO v_invoice;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Fiscal reconciliation claim is missing or stale'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.sale_recurring_cycles
  SET fiscal_status = 'manual_review',
      fiscal_claim_token = NULL,
      fiscal_claimed_at = NULL,
      fiscal_last_error = v_invoice.processing_last_error
  WHERE id = v_invoice.recurring_cycle_id;

  RETURN v_invoice;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_fiscal_reconciliation_unresolved(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_fiscal_reconciliation_unresolved(uuid,uuid,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_fiscal_email_deliveries(
  p_limit integer DEFAULT 50,
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

  -- A worker may have submitted the Brevo request and lost the response. The
  -- provider idempotency window is finite, so replaying a stale claim later can
  -- duplicate the PDF email. Fail closed instead of resending blindly.
  UPDATE public.invoices invoice
  SET
    email_status = 'failed',
    email_next_retry_at = NULL,
    email_claim_token = NULL,
    email_claimed_at = NULL,
    email_last_error = 'email_delivery_outcome_ambiguous_no_retry',
    updated_at = now()
  WHERE invoice.processing_status = 'issued'
    AND invoice.email_status = 'processing'
    AND invoice.email_claimed_at < now() - interval '30 minutes';

  RETURN QUERY
  WITH candidates AS (
    SELECT invoice.id
    FROM public.invoices invoice
    WHERE invoice.processing_status = 'issued'
      AND (
        (
          invoice.email_status IN ('pending', 'retry')
          AND coalesce(invoice.email_next_retry_at, '-infinity'::timestamptz) <= now()
        )
      )
    ORDER BY invoice.issued_at, invoice.id
    LIMIT greatest(1, least(coalesce(p_limit, 50), 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.invoices invoice
  SET
    email_status = 'processing',
    email_attempts = email_attempts + 1,
    email_claim_token = p_worker_id,
    email_claimed_at = now(),
    email_next_retry_at = NULL,
    email_last_error = NULL,
    updated_at = now()
  FROM candidates
  WHERE invoice.id = candidates.id
  RETURNING invoice.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_fiscal_email_deliveries(integer,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_fiscal_email_deliveries(integer,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_fiscal_email_delivery(
  p_invoice_id uuid,
  p_claim_token uuid,
  p_message_id text DEFAULT NULL
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice public.invoices%rowtype;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.invoices invoice
  SET
    email_status = 'sent',
    email_claim_token = NULL,
    email_claimed_at = NULL,
    email_next_retry_at = NULL,
    email_last_error = NULL,
    email_sent_at = now(),
    email_message_id = nullif(btrim(p_message_id), ''),
    -- Provider event timestamps may precede this local commit by milliseconds.
    -- Start ordering at the first webhook event instead of rejecting it as old.
    email_last_event_at = NULL,
    email_event_data = jsonb_build_object('event', 'sent', 'recordedAt', now()),
    updated_at = now()
  WHERE invoice.id = p_invoice_id
    AND invoice.email_status = 'processing'
    AND invoice.email_claim_token = p_claim_token
  RETURNING * INTO v_invoice;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Fiscal email claim is missing or stale'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.refresh_recurring_cycle_fiscal_status(v_invoice.recurring_cycle_id);
  RETURN v_invoice;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_fiscal_email_delivery(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_fiscal_email_delivery(uuid,uuid,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fail_fiscal_email_delivery(
  p_invoice_id uuid,
  p_claim_token uuid,
  p_error text,
  p_retryable boolean DEFAULT true,
  p_retry_after timestamptz DEFAULT NULL
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice public.invoices%rowtype;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.invoices invoice
  SET
    email_status = CASE WHEN p_retryable THEN 'retry' ELSE 'failed' END,
    email_next_retry_at = CASE
      WHEN p_retryable THEN coalesce(p_retry_after, now() + interval '15 minutes')
      ELSE NULL
    END,
    email_claim_token = NULL,
    email_claimed_at = NULL,
    email_last_error = left(coalesce(p_error, 'Unknown fiscal email failure'), 4000),
    updated_at = now()
  WHERE invoice.id = p_invoice_id
    AND invoice.email_status = 'processing'
    AND invoice.email_claim_token = p_claim_token
  RETURNING * INTO v_invoice;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Fiscal email claim is missing or stale'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.refresh_recurring_cycle_fiscal_status(v_invoice.recurring_cycle_id);
  RETURN v_invoice;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_fiscal_email_delivery(uuid,uuid,text,boolean,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_fiscal_email_delivery(uuid,uuid,text,boolean,timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_fiscal_email_event(
  p_message_id text,
  p_event_type text,
  p_event_at timestamptz DEFAULT now(),
  p_event_data jsonb DEFAULT '{}'::jsonb
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice public.invoices%rowtype;
  v_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  v_status := CASE lower(p_event_type)
    WHEN 'delivered' THEN 'delivered'
    WHEN 'hard_bounce' THEN 'bounced'
    WHEN 'soft_bounce' THEN 'bounced'
    WHEN 'bounced' THEN 'bounced'
    WHEN 'blocked' THEN 'blocked'
    WHEN 'spam' THEN 'blocked'
    WHEN 'unsubscribed' THEN 'suppressed'
    ELSE NULL
  END;
  IF v_status IS NULL OR jsonb_typeof(coalesce(p_event_data, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Unsupported fiscal email event'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.invoices invoice
  SET
    email_status = v_status,
    email_last_event_at = coalesce(p_event_at, now()),
    email_event_data = coalesce(p_event_data, '{}'::jsonb),
    email_last_error = CASE
      WHEN v_status IN ('bounced', 'blocked')
        THEN coalesce(p_event_data ->> 'reason', initcap(v_status))
      ELSE NULL
    END,
    updated_at = now()
  WHERE invoice.email_message_id = p_message_id
    AND coalesce(p_event_at, now()) >= coalesce(invoice.email_last_event_at, '-infinity'::timestamptz)
    AND invoice.email_status IN ('sent', 'delivered', 'bounced', 'blocked', 'suppressed')
  RETURNING * INTO v_invoice;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Fiscal email message was not found or event is stale'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.refresh_recurring_cycle_fiscal_status(v_invoice.recurring_cycle_id);
  RETURN v_invoice;
END;
$$;

REVOKE ALL ON FUNCTION public.record_fiscal_email_event(text,text,timestamptz,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_fiscal_email_event(text,text,timestamptz,jsonb)
  TO service_role;

-- Reserve a manually requested KeyInvoice receipt before any provider write.
-- The advisory transaction lock serializes every receipt for the same source
-- invoice, so two paid instalments cannot race past the cumulative cap.
CREATE OR REPLACE FUNCTION public.reserve_manual_keyinvoice_receipt(
  p_organization_id uuid,
  p_sale_id uuid,
  p_payment_id uuid,
  p_related_invoice_id uuid,
  p_amount numeric,
  p_fiscal_date date,
  p_snapshot jsonb,
  p_idempotency_key text,
  p_client_name text,
  p_claim_token uuid,
  p_claimed_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.sale_payments%rowtype;
  v_source public.invoices%rowtype;
  v_existing public.invoices%rowtype;
  v_job public.invoices%rowtype;
  v_reserved_total numeric(12, 2);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NULL
     OR p_sale_id IS NULL
     OR p_payment_id IS NULL
     OR p_related_invoice_id IS NULL
     OR p_claim_token IS NULL
     OR p_fiscal_date IS NULL
     OR p_amount IS NULL
     OR p_amount <= 0
     OR jsonb_typeof(coalesce(p_snapshot, '{}'::jsonb)) <> 'object'
     OR p_idempotency_key IS DISTINCT FROM ('receipt:' || p_payment_id::text) THEN
    RAISE EXCEPTION 'manual_receipt_invalid_arguments' USING ERRCODE = '23514';
  END IF;

  -- One lock key per source invoice. It lasts until this RPC commits.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('keyinvoice-manual-receipt:' || p_related_invoice_id::text, 0)
  );

  SELECT invoice.* INTO v_existing
  FROM public.invoices invoice
  WHERE invoice.organization_id = p_organization_id
    AND invoice.fiscal_idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.payment_id IS DISTINCT FROM p_payment_id
       OR v_existing.related_invoice_id IS DISTINCT FROM p_related_invoice_id
       OR v_existing.document_type IS DISTINCT FROM 'receipt' THEN
      RAISE EXCEPTION 'manual_receipt_idempotency_conflict' USING ERRCODE = '23514';
    END IF;

    RETURN jsonb_build_object(
      'job_id', v_existing.id,
      'created', false,
      'processing_status', v_existing.processing_status,
      'reference', v_existing.reference
    );
  END IF;

  SELECT invoice.* INTO v_source
  FROM public.invoices invoice
  WHERE invoice.id = p_related_invoice_id
    AND invoice.organization_id = p_organization_id
    AND invoice.sale_id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_source.provider IS DISTINCT FROM 'keyinvoice'
     OR v_source.document_type IS DISTINCT FROM 'invoice'
     OR v_source.status IS DISTINCT FROM 'final'
     OR v_source.processing_status NOT IN ('issued', 'legacy')
     OR coalesce(v_source.total, 0) <= 0 THEN
    RAISE EXCEPTION 'manual_receipt_source_invoice_invalid' USING ERRCODE = '23514';
  END IF;

  SELECT payment.* INTO v_payment
  FROM public.sale_payments payment
  WHERE payment.id = p_payment_id
    AND payment.organization_id = p_organization_id
    AND payment.sale_id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_payment.status IS DISTINCT FROM 'paid'
     OR coalesce(v_payment.reversal_status, 'none') <> 'none'
     OR coalesce(v_payment.reversed_amount, 0) > 0
     OR abs(coalesce(v_payment.amount, 0) - p_amount) > 0.005
     OR coalesce(p_snapshot #>> '{payment,status}', '') <> 'paid'
     OR coalesce(p_snapshot #>> '{payment,reversalStatus}', 'none') <> 'none' THEN
    RAISE EXCEPTION 'manual_receipt_payment_not_eligible' USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(sum(invoice.total), 0)
  INTO v_reserved_total
  FROM public.invoices invoice
  WHERE invoice.organization_id = p_organization_id
    AND invoice.related_invoice_id = p_related_invoice_id
    AND invoice.document_type = 'receipt'
    -- Processing/retry/reconciliation rows reserve their value because a
    -- provider write may already have happened. Only proven non-issued terminal
    -- states release the amount.
    AND invoice.processing_status NOT IN ('failed', 'cancelled', 'void');

  IF round(v_reserved_total + p_amount, 2) > round(v_source.total, 2) THEN
    RAISE EXCEPTION 'manual_receipt_amount_exceeds_invoice' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.invoices (
    organization_id,
    sale_id,
    payment_id,
    recurring_cycle_id,
    related_invoice_id,
    invoicexpress_id,
    provider,
    document_type,
    reference,
    total,
    status,
    processing_status,
    processing_attempts,
    processing_claim_token,
    processing_claimed_at,
    date,
    raw_data,
    fiscal_snapshot,
    fiscal_idempotency_key,
    client_name,
    email_status
  ) VALUES (
    p_organization_id,
    p_sale_id,
    p_payment_id,
    v_payment.recurring_cycle_id,
    p_related_invoice_id,
    NULL,
    'keyinvoice',
    'receipt',
    NULL,
    p_amount,
    'pending',
    'processing',
    1,
    p_claim_token,
    coalesce(p_claimed_at, now()),
    p_fiscal_date,
    jsonb_build_object('source', 'keyinvoice', 'snapshot', p_snapshot),
    p_snapshot,
    p_idempotency_key,
    nullif(btrim(p_client_name), ''),
    'not_requested'
  )
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'created', true,
    'processing_status', v_job.processing_status,
    'reference', v_job.reference
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_manual_keyinvoice_receipt(
  uuid,uuid,uuid,uuid,numeric,date,jsonb,text,text,uuid,timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_manual_keyinvoice_receipt(
  uuid,uuid,uuid,uuid,numeric,date,jsonb,text,text,uuid,timestamptz
) TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Permissions and scheduled worker calls
-- ---------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON public.invoices FROM anon, authenticated;
GRANT ALL ON public.invoices TO service_role;
GRANT ALL ON public.sale_recurrences TO service_role;
GRANT ALL ON public.sale_recurring_cycles TO service_role;

DO $$
DECLARE
  v_job_id bigint;
  v_command text;
  v_action text;
  v_schedule text;
  v_name text;
BEGIN
  IF to_regclass('cron.job') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RETURN;
  END IF;

  FOR v_name, v_schedule, v_action IN
    SELECT * FROM (VALUES
      ('keyinvoice-fiscal-issue', '*/5 * * * *', 'issue'),
      ('keyinvoice-fiscal-email', '2-59/5 * * * *', 'email'),
      ('keyinvoice-fiscal-reconcile', '50 4 * * *', 'reconcile')
    ) AS jobs(name, schedule, action)
  LOOP
    v_command := format(
      $command$
      SELECT net.http_post(
        url := 'https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/keyinvoice-fiscal-worker',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', trim(both from (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'stripe_cron_secret'
          ))
        ),
        body := jsonb_build_object('action', %L)
      );
      $command$,
      v_action
    );

    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = v_name;
    IF v_job_id IS NULL THEN
      PERFORM cron.schedule(v_name, v_schedule, v_command);
    ELSE
      PERFORM cron.alter_job(
        v_job_id,
        schedule := v_schedule,
        command := v_command,
        active := true
      );
    END IF;
  END LOOP;
END;
$$;

COMMENT ON COLUMN public.invoices.provider_atcud IS
  'ATCUD exactly as returned by the certified fiscal provider. The CRM must never calculate or concatenate it.';
COMMENT ON COLUMN public.invoices.fiscal_snapshot IS
  'Immutable customer, line, price, tax, discount, exemption, payment and series data used for the fiscal request.';
COMMENT ON FUNCTION public.claim_recurring_fiscal_documents(integer,uuid) IS
  'Atomically claims safe pending/retry jobs. Ambiguous processing failures are reconciled, never re-issued blindly.';
COMMENT ON FUNCTION public.claim_fiscal_reconciliation(integer,uuid) IS
  'Claims stale/failed KeyInvoice jobs for provider lookup only. The reconcile action must not issue a new document.';

COMMIT;
