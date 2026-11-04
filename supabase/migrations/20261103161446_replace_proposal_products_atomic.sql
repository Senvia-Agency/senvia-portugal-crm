BEGIN;

CREATE OR REPLACE FUNCTION public.replace_proposal_products(
  p_organization_id uuid,
  p_proposal_id uuid,
  p_expected_updated_at timestamp with time zone,
  p_products jsonb
)
RETURNS TABLE (
  proposal_id uuid,
  total_value numeric(12, 2),
  product_count integer,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_proposal public.proposals%ROWTYPE;
  v_product_count integer;
  v_distinct_product_count integer;
  v_valid_product_count integer;
  v_product_ids uuid[];
  v_total_value numeric;
  v_updated_at timestamp with time zone;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NULL OR p_proposal_id IS NULL OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'proposal_replace_required_argument_missing' USING ERRCODE = '22004';
  END IF;

  IF NOT public.meets_mfa_policy(v_caller_id) THEN
    RAISE EXCEPTION 'mfa_required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members AS membership
    WHERE membership.user_id = v_caller_id
      AND membership.organization_id = p_organization_id
      AND membership.is_active
  ) THEN
    RAISE EXCEPTION 'organization_membership_required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_module_permission(
    v_caller_id,
    p_organization_id,
    'proposals',
    'proposals',
    'edit'
  ) THEN
    RAISE EXCEPTION 'proposal_edit_permission_required' USING ERRCODE = '42501';
  END IF;

  IF p_products IS NULL OR pg_catalog.jsonb_typeof(p_products) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'proposal_products_must_be_an_array' USING ERRCODE = '22023';
  END IF;

  v_product_count := pg_catalog.jsonb_array_length(p_products);
  IF v_product_count < 1 OR v_product_count > 100 THEN
    RAISE EXCEPTION 'proposal_products_count_out_of_range' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_products) AS source(item)
    WHERE pg_catalog.jsonb_typeof(source.item) IS DISTINCT FROM 'object'
  ) THEN
    RAISE EXCEPTION 'proposal_product_must_be_an_object' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_products) AS source(item)
    WHERE (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(source.item)) <> 4
      OR NOT (source.item ? 'product_id')
      OR NOT (source.item ? 'quantity')
      OR NOT (source.item ? 'unit_price')
      OR NOT (source.item ? 'total')
  ) THEN
    RAISE EXCEPTION 'proposal_product_fields_invalid' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_products) AS source(item)
    WHERE pg_catalog.jsonb_typeof(source.item -> 'product_id') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(source.item -> 'quantity') IS DISTINCT FROM 'number'
      OR pg_catalog.jsonb_typeof(source.item -> 'unit_price') IS DISTINCT FROM 'number'
      OR pg_catalog.jsonb_typeof(source.item -> 'total') IS DISTINCT FROM 'number'
  ) THEN
    RAISE EXCEPTION 'proposal_product_field_types_invalid' USING ERRCODE = '22023';
  END IF;

  BEGIN
    SELECT
      pg_catalog.count(*)::integer,
      pg_catalog.count(DISTINCT input.product_id)::integer,
      pg_catalog.array_agg(input.product_id ORDER BY input.product_id),
      pg_catalog.sum(pg_catalog.round(input.total, 2))
    INTO
      v_product_count,
      v_distinct_product_count,
      v_product_ids,
      v_total_value
    FROM pg_catalog.jsonb_to_recordset(p_products) AS input(
      product_id uuid,
      quantity numeric,
      unit_price numeric,
      total numeric
    );
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'proposal_product_values_invalid' USING ERRCODE = '22023';
  END;

  IF v_distinct_product_count <> v_product_count THEN
    RAISE EXCEPTION 'proposal_product_ids_must_be_unique' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_products) AS input(
      product_id uuid,
      quantity numeric,
      unit_price numeric,
      total numeric
    )
    WHERE input.quantity <= 0
      OR input.quantity > 9999999999.99
      OR input.quantity <> pg_catalog.round(input.quantity, 2)
      OR input.unit_price < 0
      OR input.unit_price > 9999999999.99
      OR input.unit_price <> pg_catalog.round(input.unit_price, 2)
      OR input.total < 0
      OR input.total > 9999999999.99
      OR input.total > pg_catalog.round(input.quantity * input.unit_price, 2)
  ) THEN
    RAISE EXCEPTION 'proposal_product_amount_out_of_range' USING ERRCODE = '23514';
  END IF;

  IF v_total_value > 9999999999.99 THEN
    RAISE EXCEPTION 'proposal_total_value_out_of_range' USING ERRCODE = '22003';
  END IF;

  SELECT proposal.*
  INTO v_proposal
  FROM public.proposals AS proposal
  WHERE proposal.id = p_proposal_id
    AND proposal.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_proposal.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'proposal_version_conflict' USING ERRCODE = '40001';
  END IF;

  IF NOT public.can_write_owned_record(
    p_organization_id,
    pg_catalog.to_jsonb(v_proposal)
  ) THEN
    RAISE EXCEPTION 'proposal_scope_denied' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.products AS catalog_product
  WHERE catalog_product.id = ANY (v_product_ids)
  ORDER BY catalog_product.id
  FOR SHARE OF catalog_product;

  SELECT pg_catalog.count(*)::integer
  INTO v_valid_product_count
  FROM public.products AS catalog_product
  WHERE catalog_product.id = ANY (v_product_ids)
    AND catalog_product.organization_id = p_organization_id
    AND catalog_product.is_active IS TRUE;

  IF v_valid_product_count <> v_product_count THEN
    RAISE EXCEPTION 'proposal_product_reference_invalid' USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.proposal_products AS existing
  WHERE existing.proposal_id = p_proposal_id;

  INSERT INTO public.proposal_products (
    proposal_id,
    product_id,
    quantity,
    unit_price,
    total
  )
  SELECT
    p_proposal_id,
    input.product_id,
    input.quantity,
    input.unit_price,
    pg_catalog.round(input.total, 2)
  FROM pg_catalog.jsonb_to_recordset(p_products) AS input(
    product_id uuid,
    quantity numeric(12, 2),
    unit_price numeric(12, 2),
    total numeric
  );

  UPDATE public.proposals AS proposal
  SET total_value = v_total_value
  WHERE proposal.id = p_proposal_id
  RETURNING proposal.updated_at INTO v_updated_at;

  RETURN QUERY
  SELECT
    p_proposal_id,
    v_total_value::numeric(12, 2),
    v_product_count,
    v_updated_at;
END;
$$;

COMMENT ON FUNCTION public.replace_proposal_products(
  uuid,
  uuid,
  timestamp with time zone,
  jsonb
) IS
  'Atomically replaces 1-100 proposal product rows, preserves UI discounted totals, synchronizes proposals.total_value, and rejects stale updated_at versions.';

REVOKE ALL ON FUNCTION public.replace_proposal_products(
  uuid,
  uuid,
  timestamp with time zone,
  jsonb
) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.replace_proposal_products(
  uuid,
  uuid,
  timestamp with time zone,
  jsonb
) TO authenticated;

COMMIT;
