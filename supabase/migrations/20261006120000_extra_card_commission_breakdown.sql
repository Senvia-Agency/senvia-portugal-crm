-- Keep the exact extra-card payout separate from the seller's base commission.
-- Existing rows stay NULL because the historic card rate/tier was not frozen.
ALTER TABLE public.sale_commission_splits
  ADD COLUMN IF NOT EXISTS extra_card_amount numeric;

COMMENT ON COLUMN public.sale_commission_splits.extra_card_amount IS
  'Frozen payout for extra SIM cards on this commission line. NULL means the historic split predates this breakdown.';
CREATE OR REPLACE FUNCTION public.generate_sale_commission_splits(p_sale_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org_id       uuid;
  _created_by   uuid;
  _produtos     text[];
  _details      jsonb;
  _sale_date    date;
  _catalog      jsonb;
  _produto      text;
  _cat_entry    jsonb;
  _operator_id  uuid;
  _op_basis     text;
  _op_scope     text;
  _qty_own      integer;
  _qty_for_tier numeric;
  _tier_entry   jsonb;
  _tier_price   numeric;
  _tier_bonus   numeric;
  _tier_bonus_type text;
  _bonus_amount numeric;
  _award_bonus  boolean;
  _latest_sale_id uuid;
  _is_tiered    boolean;
  _splits_arr   jsonb;
  _seller_split jsonb;
  _seller_profile uuid;
  _unit_price   numeric;
  _price        numeric;
  _seller_rate  numeric;
  _seller_amount numeric;
  _gross        numeric;
  _operator_pays numeric;
  _tech         text;
  _split_val    numeric;
  _split_type   text;
  _card_tier    jsonb;
  _op_pays_fibra numeric;
  _split_val_fibra numeric;
  _split_type_fibra text;
  _pct_base     numeric;
  _extra_rate   numeric;
  _extra_qty    numeric;
  _extra_total  numeric;
  _sum_gross    numeric := 0;
  _sum_seller   numeric := 0;
  _any_rule     boolean := false;
  _month_start  date;
  _month_end    date;
  _is_resync    boolean := COALESCE(current_setting('senvia.op_resync', true), 'false') = 'true';
  _mv_pending   jsonb := '[]'::jsonb;
  _mv_item      jsonb;
  _mv_produto   text;
  _mv_scope     text;
  _mv_month_start date;
  _mv_month_end   date;
  _sibling_id   uuid;
  _sib_sum      numeric;
BEGIN
  SELECT organization_id, COALESCE(seller_id, created_by), servicos_produtos, servicos_details, sale_date
    INTO _org_id, _created_by, _produtos, _details, _sale_date
  FROM public.sales WHERE id = p_sale_id;
  IF _org_id IS NULL THEN RETURN NULL; END IF;
  DELETE FROM public.sale_commission_splits WHERE sale_id = p_sale_id;
  IF _produtos IS NULL OR array_length(_produtos, 1) IS NULL THEN
    UPDATE public.sales SET org_commission = 0 WHERE id = p_sale_id AND org_commission <> 0;
    RETURN NULL;
  END IF;
  SELECT servicos_products_config::jsonb INTO _catalog
  FROM public.organizations WHERE id = _org_id;
  IF _catalog IS NULL OR jsonb_typeof(_catalog) <> 'array' THEN RETURN NULL; END IF;
  IF _created_by IS NOT NULL THEN
    SELECT m.profile_id INTO _seller_profile
    FROM public.organization_members m
    WHERE m.organization_id = _org_id AND m.user_id = _created_by AND m.is_active
    LIMIT 1;
  END IF;
  _month_start := date_trunc('month', COALESCE(_sale_date, CURRENT_DATE))::date;
  _month_end   := (_month_start + interval '1 month')::date;
  FOREACH _produto IN ARRAY _produtos LOOP
    _cat_entry    := NULL;
    _operator_id  := NULL;
    _op_basis     := NULL;
    _op_scope     := NULL;
    _qty_for_tier := NULL;
    _tier_entry   := NULL;
    _tier_price   := NULL;
    _tier_bonus   := 0;
    _tier_bonus_type := 'fixed';
    _bonus_amount := 0;
    _award_bonus  := false;
    _latest_sale_id := NULL;
    _is_tiered    := false;
    _splits_arr   := NULL;
    _seller_split := NULL;
    _seller_rate  := 0;
    _operator_pays := NULL;
    _op_pays_fibra := NULL;
    _card_tier := NULL;
    _tech         := NULLIF(_details->_produto->>'tecnologia', '');
    _extra_total  := 0;
    SELECT c.entry INTO _cat_entry
    FROM jsonb_array_elements(_catalog) AS c(entry)
    WHERE c.entry->>'name' = _produto
    LIMIT 1;
    CONTINUE WHEN _cat_entry IS NULL;
    _operator_id := NULLIF(_cat_entry->>'operator_id', '')::uuid;
    _price       := COALESCE(public._safe_numeric(_cat_entry->>'price'), 0);
    _qty_own     := GREATEST(1, COALESCE(public._safe_numeric(_details->_produto->>'quantidade')::int, 1));
    IF jsonb_typeof(_cat_entry->'quantity_tiers') = 'array'
       AND jsonb_array_length(_cat_entry->'quantity_tiers') > 0
       AND COALESCE((_cat_entry->>'tiered_commission')::boolean, true)
    THEN
      IF _operator_id IS NOT NULL THEN
        SELECT commission_basis, volume_scope INTO _op_basis, _op_scope
        FROM public.operators WHERE id = _operator_id;
      END IF;
      -- The product's own choice wins over the operator's.
      _op_basis := COALESCE(NULLIF(_cat_entry->>'tier_basis', ''), _op_basis);
      _op_scope := COALESCE(NULLIF(_cat_entry->>'tier_scope', ''), _op_scope, 'org_total');
      -- Bands are a property of the product, not of the operator. Without an
      -- operator (or without a basis on it) the band is read off the quantity
      -- on THIS sale, which is what 'per_sale' already meant.
      IF true THEN
        IF _op_basis = 'monthly_volume' THEN
          SELECT COALESCE(SUM(GREATEST(1, COALESCE(public._safe_numeric(s.servicos_details->_produto->>'quantidade')::int, 1))), 0)
            INTO _qty_for_tier
          FROM public.sales s
          WHERE s.organization_id = _org_id
            AND s.sale_date >= _month_start AND s.sale_date < _month_end
            AND _produto = ANY(s.servicos_produtos)
            AND (_op_scope = 'org_total' OR COALESCE(s.seller_id, s.created_by) = _created_by);
          _mv_pending := _mv_pending || jsonb_build_object(
            'produto', _produto, 'scope', _op_scope,
            'month_start', _month_start, 'month_end', _month_end
          );
        ELSE
          _qty_for_tier := _qty_own;
        END IF;
        SELECT t.entry INTO _tier_entry
        FROM jsonb_array_elements(_cat_entry->'quantity_tiers') AS t(entry)
        WHERE _qty_for_tier >= COALESCE(public._safe_numeric(t.entry->>'min'), 1)
          AND (NULLIF(t.entry->>'max', '') IS NULL OR _qty_for_tier <= public._safe_numeric(t.entry->>'max'))
        LIMIT 1;
        CONTINUE WHEN _tier_entry IS NULL;
        _is_tiered   := true;
        _splits_arr  := _tier_entry->'splits';
        _tier_price  := COALESCE(public._safe_numeric(_tier_entry->>'price'), _price);
        _tier_bonus  := CASE
          WHEN COALESCE((_tier_entry->>'bonus_enabled')::boolean, true)
            THEN COALESCE(public._safe_numeric(_tier_entry->>'bonus'), 0)
          ELSE 0
        END;
        _tier_bonus_type := COALESCE(_tier_entry->>'bonus_type', 'fixed');
        IF _tech IS NOT NULL THEN
          _operator_pays := public._safe_numeric(_tier_entry->>('operator_pays_' || _tech));
        END IF;
        IF _operator_pays IS NULL THEN
          _operator_pays := public._safe_numeric(_tier_entry->>'operator_pays');
        END IF;
        _op_pays_fibra := COALESCE(
          public._safe_numeric(_tier_entry->>'operator_pays_fibra'),
          public._safe_numeric(_tier_entry->>'operator_pays'));
      END IF;
    END IF;
    IF NOT _is_tiered THEN
      _splits_arr := _cat_entry->'splits';
    END IF;
    _unit_price := COALESCE(_tier_price, _price);
    -- Cards: the band this line's own quantity falls in may set its own
    -- included count and extra-card rate; the product's are the fallback.
    SELECT t.entry INTO _card_tier
    FROM jsonb_array_elements(COALESCE(_cat_entry->'quantity_tiers', '[]'::jsonb)) AS t(entry)
    WHERE COALESCE((_cat_entry->>'tiered_commission')::boolean, true)
      AND _qty_own >= COALESCE(public._safe_numeric(t.entry->>'min'), 1)
      AND (NULLIF(t.entry->>'max', '') IS NULL OR _qty_own <= public._safe_numeric(t.entry->>'max'))
    LIMIT 1;
    _extra_rate := COALESCE(
      public._safe_numeric(_card_tier->>'extra_card_commission'),
      public._safe_numeric(_cat_entry->>'extra_card_commission'), 0);
    IF (_details->_produto) ? 'total_cards' THEN
      _extra_qty := GREATEST(0,
        COALESCE(public._safe_numeric(_details->_produto->>'total_cards'), 0)
          - COALESCE(
              public._safe_numeric(_card_tier->>'included_cards'),
              public._safe_numeric(_cat_entry->>'included_cards'), 1)
      );
    ELSE
      _extra_qty := COALESCE(public._safe_numeric(_details->_produto->>'extra_cards_portability'), 0)
                  + COALESCE(public._safe_numeric(_details->_produto->>'extra_cards_new'), 0);
    END IF;
    _extra_total := ROUND(_extra_rate * _extra_qty, 2);
    IF _operator_pays IS NULL THEN
      IF _tech IS NOT NULL THEN
        _operator_pays := public._safe_numeric(_cat_entry->>('operator_pays_' || _tech));
      END IF;
      IF _operator_pays IS NULL THEN
        _operator_pays := public._safe_numeric(_cat_entry->>'operator_pays');
      END IF;
    END IF;
    IF _op_pays_fibra IS NULL THEN
      _op_pays_fibra := COALESCE(
        public._safe_numeric(_cat_entry->>'operator_pays_fibra'),
        public._safe_numeric(_cat_entry->>'operator_pays'));
    END IF;
    IF jsonb_typeof(_splits_arr) = 'array' THEN
      SELECT s.entry INTO _seller_split
      FROM jsonb_array_elements(_splits_arr) AS s(entry)
      WHERE COALESCE(s.entry->>'kind', 'user') = 'user'
        AND _created_by IS NOT NULL
        AND NULLIF(s.entry->>'user_id', '')::uuid = _created_by
      LIMIT 1;
      IF _seller_split IS NULL AND _seller_profile IS NOT NULL THEN
        SELECT s.entry INTO _seller_split
        FROM jsonb_array_elements(_splits_arr) AS s(entry)
        WHERE s.entry->>'kind' = 'profile'
          AND NULLIF(s.entry->>'profile_id', '')::uuid = _seller_profile
        LIMIT 1;
      END IF;
    END IF;
    IF _seller_split IS NOT NULL THEN
      -- The rate for the technology installed, falling back to the single
      -- value for a product that does not distinguish (every product from
      -- before technologies existed).
      _split_val := NULL;
      IF _tech IS NOT NULL THEN
        _split_val := public._safe_numeric(_seller_split->>('value_' || _tech));
      END IF;
      IF _split_val IS NULL THEN
        _split_val := COALESCE(public._safe_numeric(_seller_split->>'value'), 0);
      END IF;
      -- ...and how to read it. Fibre may pay a flat fee while satellite pays
      -- a percentage, so the mode belongs to the technology, not to the line.
      _split_type := NULL;
      IF _tech IS NOT NULL THEN
        _split_type := NULLIF(_seller_split->>('type_' || _tech), '');
      END IF;
      _split_type := COALESCE(_split_type, _seller_split->>'type', 'fixed');
      -- A base da percentagem. Em fibra é o que a operadora paga (sem
      -- operadora configurada, o preço unitário). Em satélite é o que ESTA
      -- MESMA linha paga em fibra — o satélite é uma fatia da fibra, por
      -- pessoa, não uma fatia do que a operadora paga.
      IF _split_type = 'pct' AND _tech = 'satelite' THEN
        _split_val_fibra := COALESCE(
          public._safe_numeric(_seller_split->>'value_fibra'),
          public._safe_numeric(_seller_split->>'value'), 0);
        _split_type_fibra := COALESCE(
          NULLIF(_seller_split->>'type_fibra', ''), _seller_split->>'type', 'fixed');
        _pct_base := CASE
          WHEN _split_type_fibra = 'pct'
            THEN ROUND(COALESCE(_op_pays_fibra, _unit_price) * _split_val_fibra / 100.0, 2)
          ELSE _split_val_fibra
        END;
      ELSE
        _pct_base := COALESCE(_operator_pays, _unit_price);
      END IF;
      _seller_rate := CASE
        WHEN _split_type = 'pct'
          THEN ROUND(_pct_base * _split_val / 100.0, 2)
        ELSE _split_val
      END;
    END IF;
    IF _is_tiered AND _tier_bonus <> 0 THEN
      IF _tier_bonus_type = 'pct' THEN
        _bonus_amount := ROUND(_seller_rate * _qty_own * _tier_bonus / 100.0, 2);
      ELSE
        _bonus_amount := _tier_bonus;
      END IF;
      IF _op_basis = 'monthly_volume' THEN
        SELECT s.id INTO _latest_sale_id
        FROM public.sales s
        WHERE s.organization_id = _org_id
          AND s.sale_date >= _month_start AND s.sale_date < _month_end
          AND _produto = ANY(s.servicos_produtos)
          AND (_op_scope = 'org_total' OR COALESCE(s.seller_id, s.created_by) = _created_by)
        ORDER BY s.sale_date DESC, s.created_at DESC, s.id DESC
        LIMIT 1;
        _award_bonus := (_latest_sale_id = p_sale_id);
      ELSE
        _award_bonus := true;
      END IF;
      IF NOT _award_bonus THEN _bonus_amount := 0; END IF;
    END IF;
    -- A recipient marked `extra_cards: false` gets no extra-card money at
    -- all. At BDS that is whoever is already paid the operator's whole amount:
    -- the org keeps nothing on those sales, so there is no margin to pay the
    -- extra out of.
    IF _seller_split IS NOT NULL
       AND lower(COALESCE(_seller_split->>'extra_cards', 'true')) = 'false' THEN
      _extra_total := 0;
    END IF;
    _seller_amount := ROUND(_seller_rate * _qty_own + _bonus_amount + _extra_total, 2);
    IF _operator_pays IS NOT NULL THEN
      -- The operator pays operator_pays per unit, and nothing for extra cards:
      -- the extra is paid to the seller by the org, out of its own margin.
      -- Adding it here too left the org's share untouched (200 - 150 = 50)
      -- when it has to drop (200 - 150 - 10 = 40).
      _gross := ROUND(_operator_pays * _qty_own + _bonus_amount, 2);
    ELSE
      _gross := _seller_amount;
    END IF;
    CONTINUE WHEN _gross = 0 AND _seller_amount = 0;
    _any_rule := true;
    IF _created_by IS NOT NULL AND _seller_amount <> 0 THEN
      INSERT INTO public.sale_commission_splits
        (organization_id, sale_id, user_id, product_name, source, source_ref, basis, rate, amount, extra_card_amount)
      VALUES
        (_org_id, p_sale_id, _created_by, _produto, 'user', _created_by, 'fixed', _seller_rate, _seller_amount, _extra_total);
    END IF;
    _sum_gross  := _sum_gross + _gross;
    _sum_seller := _sum_seller + _seller_amount;
  END LOOP;
  IF NOT _any_rule THEN RETURN NULL; END IF;
  UPDATE public.sales
     SET org_commission = GREATEST(ROUND(_sum_gross - _sum_seller, 2), 0)
   WHERE id = p_sale_id;
  IF NOT _is_resync AND jsonb_array_length(_mv_pending) > 0 THEN
    PERFORM set_config('senvia.op_resync', 'true', true);
    FOR _mv_item IN SELECT * FROM jsonb_array_elements(_mv_pending) LOOP
      _mv_produto     := _mv_item->>'produto';
      _mv_scope       := _mv_item->>'scope';
      _mv_month_start := (_mv_item->>'month_start')::date;
      _mv_month_end   := (_mv_item->>'month_end')::date;
      FOR _sibling_id IN
        SELECT s.id FROM public.sales s
        WHERE s.organization_id = _org_id
          AND s.id <> p_sale_id
          AND s.sale_date >= _mv_month_start AND s.sale_date < _mv_month_end
          AND _mv_produto = ANY(s.servicos_produtos)
          AND (_mv_scope = 'org_total' OR COALESCE(s.seller_id, s.created_by) = _created_by)
      LOOP
        _sib_sum := public.generate_sale_commission_splits(_sibling_id);
        IF _sib_sum IS NOT NULL THEN
          UPDATE public.sales SET comissao = _sib_sum
          WHERE id = _sibling_id AND comissao IS DISTINCT FROM _sib_sum;
        END IF;
      END LOOP;
    END LOOP;
    PERFORM set_config('senvia.op_resync', 'false', true);
  END IF;
  RETURN _sum_gross;
END;
$function$;
