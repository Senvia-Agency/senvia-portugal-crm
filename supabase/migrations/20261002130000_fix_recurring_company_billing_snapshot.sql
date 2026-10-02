-- Use the billing recipient selected on the sale when building a recurring fiscal snapshot.
-- The client profile may retain a personal default while this specific sale bills a company.

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
        WHEN coalesce(nullif(sale.billing_target, ''), client.billing_target) = 'company'
          THEN coalesce(nullif(client.company, ''), client.name)
        ELSE client.name
      END,
      'vatin', CASE
        WHEN coalesce(nullif(sale.billing_target, ''), client.billing_target) = 'company'
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

