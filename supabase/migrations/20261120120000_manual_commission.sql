-- Comissão manual (pedido da BDS, 20/11/2026). Contrato: docs/comissao-manual-contrato.md
-- Só acrescenta: funções novas, uma tabela nova, um gatilho novo e duas funções
-- substituídas (generate_sale_commission_splits e set_sale_commission_payment_month),
-- copiadas da versão em produção a 20/11/2026 com um ramo novo cada.
-- Vendas antigas não mudam: só uma linha marcada "manual_commission" na própria
-- venda (o gatilho marca ao gravar) usa a conta manual.
--
-- Reverter: DROP TRIGGER sales_manual_commission_trg / sales_manual_commission_history_trg,
-- DROP das funções novas (evaluate_manual_commission, manual_commission_follows_template,
-- enforce_manual_commission, log_manual_commission_change, update_sale_manual_commission) e, se não houver vendas manuais,
-- da tabela sale_manual_commission_changes. As duas funções substituídas voltam ao que
-- eram tirando o bloco marcado "Comissão manual" / "comissão semanal" de cada uma.

-- 1. Avaliar a conta ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.evaluate_manual_commission(p_formula jsonb, p_product text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _n       integer;
  _i       integer;
  _tok     jsonb;
  _v       numeric;
  _op      text;
  _mul_op  text := NULL;   -- × or ÷ waiting for its right-hand number
  _add_op  text := '+';    -- + or − waiting for the current term
  _term    numeric := NULL;
  _total   numeric := 0;
BEGIN
  IF p_formula IS NULL OR jsonb_typeof(p_formula) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'manual_commission',
      MESSAGE = format('A conta da comissão de "%s" está incompleta ou mal formada.', p_product);
  END IF;
  _n := jsonb_array_length(p_formula);
  -- número (operador número)*, de 1 a 25 números
  IF _n = 0 OR _n % 2 = 0 OR _n > 49 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'manual_commission',
      MESSAGE = format('A conta da comissão de "%s" está incompleta ou mal formada.', p_product);
  END IF;

  FOR _i IN 0.._n - 1 LOOP
    _tok := p_formula -> _i;
    IF _i % 2 = 0 THEN
      IF jsonb_typeof(_tok) <> 'object' OR _tok->>'t' IS DISTINCT FROM 'num' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'manual_commission',
          MESSAGE = format('A conta da comissão de "%s" está incompleta ou mal formada.', p_product);
      END IF;
      IF jsonb_typeof(_tok->'v') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'manual_commission',
          MESSAGE = format('A conta da comissão de "%s" tem um número inválido.', p_product);
      END IF;
      _v := (_tok->>'v')::numeric;
      IF abs(_v) > 1000000000 OR scale(_v) > 4 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'manual_commission',
          MESSAGE = format('A conta da comissão de "%s" tem um número inválido.', p_product);
      END IF;
      IF _term IS NULL THEN
        _term := _v;
      ELSIF _mul_op = '*' THEN
        _term := _term * _v;
      ELSE
        IF _v = 0 THEN
          RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'manual_commission',
            MESSAGE = format('A conta da comissão de "%s" divide por zero.', p_product);
        END IF;
        _term := _term / _v;
      END IF;
      _mul_op := NULL;
    ELSE
      _op := CASE WHEN jsonb_typeof(_tok) = 'object' AND _tok->>'t' = 'op' THEN _tok->>'v' END;
      IF _op IS NULL OR _op NOT IN ('+', '-', '*', '/') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'manual_commission',
          MESSAGE = format('A conta da comissão de "%s" está incompleta ou mal formada.', p_product);
      END IF;
      IF _op IN ('+', '-') THEN
        _total := _total + CASE WHEN _add_op = '+' THEN _term ELSE -_term END;
        _add_op := _op;
        _term := NULL;
      ELSE
        _mul_op := _op;
      END IF;
    END IF;
  END LOOP;

  _total := round(_total + CASE WHEN _add_op = '+' THEN _term ELSE -_term END, 2);
  IF _total < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'manual_commission',
      MESSAGE = format('A comissão de "%s" não pode ser negativa.', p_product);
  END IF;
  RETURN _total;
END;
$function$;

COMMENT ON FUNCTION public.evaluate_manual_commission(jsonb, text) IS
  'Conta da comissão manual: tokens número/operador, × e ÷ antes de + e −, resultado a 2 casas. Erros com HINT manual_commission.';

-- 2. A conta segue o modelo do serviço? --------------------------------------

CREATE OR REPLACE FUNCTION public.manual_commission_follows_template(p_formula jsonb, p_template jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _i integer;
  _t jsonb;
  _f jsonb;
BEGIN
  IF p_template IS NULL OR jsonb_typeof(p_template) <> 'array' OR jsonb_array_length(p_template) = 0 THEN
    RETURN true;
  END IF;
  IF p_formula IS NULL OR jsonb_typeof(p_formula) <> 'array'
     OR jsonb_array_length(p_formula) <> jsonb_array_length(p_template) THEN
    RETURN false;
  END IF;
  FOR _i IN 0..jsonb_array_length(p_template) - 1 LOOP
    _t := p_template -> _i;
    _f := p_formula -> _i;
    IF jsonb_typeof(_t) <> 'object' OR jsonb_typeof(_f) <> 'object' THEN
      RETURN false;
    END IF;
    CASE _t->>'t'
      WHEN 'slot' THEN
        IF _f->>'t' IS DISTINCT FROM 'num' THEN RETURN false; END IF;
      WHEN 'num' THEN
        IF _f->>'t' IS DISTINCT FROM 'num'
           OR public._safe_numeric(_f->>'v') IS DISTINCT FROM public._safe_numeric(_t->>'v') THEN
          RETURN false;
        END IF;
      WHEN 'op' THEN
        IF _f->>'t' IS DISTINCT FROM 'op' OR _f->>'v' IS DISTINCT FROM _t->>'v' THEN
          RETURN false;
        END IF;
      ELSE
        RETURN false;
    END CASE;
  END LOOP;
  RETURN true;
END;
$function$;

-- 3. Validar e normalizar a venda (BEFORE) ------------------------------------
-- Corre antes de trg_sale_commission_payment_month (ordem alfabética dos gatilhos BEFORE).

CREATE OR REPLACE FUNCTION public.enforce_manual_commission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _catalog  jsonb;
  _details  jsonb;
  _line     record;
  _entry    jsonb;
  _formula  jsonb;
  _old_formula jsonb;
  _result   numeric;
  _weekly   integer := 0;
  _other    integer := 0;
BEGIN
  IF NEW.servicos_details IS NULL OR jsonb_typeof(NEW.servicos_details) <> 'object' THEN
    RETURN NEW;
  END IF;
  SELECT servicos_products_config::jsonb INTO _catalog
  FROM public.organizations WHERE id = NEW.organization_id;
  IF _catalog IS NULL OR jsonb_typeof(_catalog) <> 'array' THEN
    RETURN NEW;
  END IF;

  _details := NEW.servicos_details;
  FOR _line IN SELECT key, value FROM jsonb_each(NEW.servicos_details) LOOP
    CONTINUE WHEN jsonb_typeof(_line.value) <> 'object';
    SELECT c.entry INTO _entry
    FROM jsonb_array_elements(_catalog) AS c(entry)
    WHERE c.entry->>'name' = _line.key
    LIMIT 1;

    IF _entry IS NOT NULL AND lower(COALESCE(_entry->>'commission_payout', 'monthly')) = 'weekly' THEN
      _weekly := _weekly + 1;
      _details := jsonb_set(_details, ARRAY[_line.key, 'commission_payout'], '"weekly"'::jsonb);
    ELSE
      _other := _other + 1;
      _details := _details #- ARRAY[_line.key, 'commission_payout'];
    END IF;

    IF _entry IS NULL OR lower(COALESCE(_entry->>'manual_commission', 'false')) <> 'true' THEN
      _details := _details #- ARRAY[_line.key, 'manual_commission'];
      CONTINUE;
    END IF;

    _formula := NULLIF(_line.value->'manual_commission_formula', 'null'::jsonb);
    IF _formula IS NULL THEN
      _result := 0;
    ELSE
      _result := public.evaluate_manual_commission(_formula, _line.key);
      _old_formula := CASE WHEN TG_OP = 'UPDATE' AND jsonb_typeof(OLD.servicos_details) = 'object'
        THEN NULLIF(OLD.servicos_details->_line.key->'manual_commission_formula', 'null'::jsonb) END;
      -- Só a conta nova ou alterada tem de seguir o modelo atual: uma venda
      -- antiga não fica presa se o modelo do serviço mudar depois.
      IF _formula IS DISTINCT FROM _old_formula
         AND NOT public.manual_commission_follows_template(_formula, _entry->'manual_commission_template') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'manual_commission',
          MESSAGE = format('A conta da comissão de "%s" tem de seguir o modelo do serviço; só os campos a preencher podem mudar.', _line.key);
      END IF;
    END IF;
    _details := jsonb_set(_details, ARRAY[_line.key, 'manual_commission'], 'true'::jsonb);
    _details := jsonb_set(_details, ARRAY[_line.key, 'comissao'], to_jsonb(_result));
  END LOOP;

  IF _weekly > 0 AND _other > 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'manual_commission',
      MESSAGE = 'Um serviço com comissão semanal tem de ficar numa venda à parte.';
  END IF;

  NEW.servicos_details := _details;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sales_manual_commission_trg ON public.sales;
CREATE TRIGGER sales_manual_commission_trg
  BEFORE INSERT OR UPDATE OF organization_id, servicos_details ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.enforce_manual_commission();

-- 4. Histórico de quem mudou a conta -------------------------------------------

CREATE TABLE IF NOT EXISTS public.sale_manual_commission_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id         uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_name    text NOT NULL,
  old_formula     jsonb,
  new_formula     jsonb,
  old_amount      numeric(12,2),
  new_amount      numeric(12,2),
  changed_by      uuid,
  reason          text,
  changed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sale_manual_commission_changes_sale_idx
  ON public.sale_manual_commission_changes (sale_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS sale_manual_commission_changes_org_idx
  ON public.sale_manual_commission_changes (organization_id);

ALTER TABLE public.sale_manual_commission_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members view org manual commission changes" ON public.sale_manual_commission_changes;
CREATE POLICY "Members view org manual commission changes"
  ON public.sale_manual_commission_changes FOR SELECT
  USING (public.is_org_member(auth.uid(), organization_id) OR public.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS security_mfa ON public.sale_manual_commission_changes;
CREATE POLICY security_mfa
  ON public.sale_manual_commission_changes AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.meets_mfa_policy(auth.uid()));

REVOKE ALL ON public.sale_manual_commission_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sale_manual_commission_changes TO authenticated;

CREATE OR REPLACE FUNCTION public.log_manual_commission_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _key     text;
  _new_l   jsonb;
  _old_l   jsonb;
  _new_f   jsonb;
  _old_f   jsonb;
BEGIN
  FOR _key IN
    SELECT k FROM jsonb_object_keys(CASE WHEN jsonb_typeof(NEW.servicos_details) = 'object'
      THEN NEW.servicos_details ELSE '{}'::jsonb END) AS k
    UNION
    SELECT k FROM jsonb_object_keys(CASE WHEN TG_OP = 'UPDATE' AND jsonb_typeof(OLD.servicos_details) = 'object'
      THEN OLD.servicos_details ELSE '{}'::jsonb END) AS k
  LOOP
    _new_l := CASE WHEN jsonb_typeof(NEW.servicos_details) = 'object' THEN NEW.servicos_details->_key END;
    _old_l := CASE WHEN TG_OP = 'UPDATE' AND jsonb_typeof(OLD.servicos_details) = 'object'
      THEN OLD.servicos_details->_key END;
    CONTINUE WHEN COALESCE(_new_l->>'manual_commission', _old_l->>'manual_commission', 'false') <> 'true';
    _new_f := NULLIF(_new_l->'manual_commission_formula', 'null'::jsonb);
    _old_f := NULLIF(_old_l->'manual_commission_formula', 'null'::jsonb);
    CONTINUE WHEN _new_f IS NOT DISTINCT FROM _old_f;
    INSERT INTO public.sale_manual_commission_changes
      (organization_id, sale_id, product_name, old_formula, new_formula, old_amount, new_amount, changed_by, reason)
    VALUES
      (NEW.organization_id, NEW.id, _key, _old_f, _new_f,
       CASE WHEN _old_l IS NOT NULL THEN public._safe_numeric(_old_l->>'comissao') END,
       CASE WHEN _new_l IS NOT NULL THEN public._safe_numeric(_new_l->>'comissao') END,
       auth.uid(),
       NULLIF(current_setting('senvia.manual_commission_reason', true), ''));
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.log_manual_commission_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sales_manual_commission_history_trg ON public.sales;
CREATE TRIGGER sales_manual_commission_history_trg
  AFTER INSERT OR UPDATE OF servicos_details ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.log_manual_commission_change();

-- 4b. Corrigir a conta de uma venda, com motivo obrigatório ----------------------
-- SECURITY INVOKER: a atualização passa pelas mesmas regras de acesso (RLS) que a
-- edição normal da venda. Validação, cálculo, divisão e histórico ficam a cargo
-- dos gatilhos; aqui só se exige o motivo e se confirma que a linha é manual.

CREATE OR REPLACE FUNCTION public.update_sale_manual_commission(
  p_sale_id uuid,
  p_product text,
  p_formula jsonb,
  p_reason  text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  _reason  text := btrim(COALESCE(p_reason, ''));
  _details jsonb;
  _result  numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', HINT = 'manual_commission',
      MESSAGE = 'Inicie sessão para corrigir a comissão.';
  END IF;
  IF char_length(_reason) < 3 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'manual_commission',
      MESSAGE = 'Indique o motivo da correção.';
  END IF;
  IF char_length(_reason) > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'manual_commission',
      MESSAGE = 'O motivo da correção pode ter no máximo 500 caracteres.';
  END IF;
  IF p_formula IS NULL OR jsonb_typeof(p_formula) = 'null' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'manual_commission',
      MESSAGE = format('A conta da comissão de "%s" está incompleta ou mal formada.', p_product);
  END IF;

  -- FOR UPDATE: duas correções ao mesmo tempo ficam uma depois da outra.
  SELECT servicos_details INTO _details
  FROM public.sales WHERE id = p_sale_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', HINT = 'manual_commission',
      MESSAGE = 'Venda não encontrada ou sem permissão para a editar.';
  END IF;
  IF jsonb_typeof(_details) <> 'object'
     OR jsonb_typeof(_details->p_product) <> 'object'
     OR COALESCE(_details->p_product->>'manual_commission', 'false') <> 'true' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'manual_commission',
      MESSAGE = format('"%s" não tem comissão manual nesta venda.', p_product);
  END IF;

  PERFORM set_config('senvia.manual_commission_reason', _reason, true);
  UPDATE public.sales
     SET servicos_details = jsonb_set(servicos_details, ARRAY[p_product, 'manual_commission_formula'], p_formula)
   WHERE id = p_sale_id
  RETURNING public._safe_numeric(servicos_details->p_product->>'comissao') INTO _result;
  PERFORM set_config('senvia.manual_commission_reason', '', true);

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', HINT = 'manual_commission',
      MESSAGE = 'Venda não encontrada ou sem permissão para a editar.';
  END IF;
  RETURN _result;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_sale_manual_commission(uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_sale_manual_commission(uuid, text, jsonb, text) TO authenticated;

-- 5. Data de pagamento semanal ---------------------------------------------------
-- Cópia da versão em produção (20/11/2026) com o ramo "weekly" no início.

CREATE OR REPLACE FUNCTION public.set_sale_commission_payment_month()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  month_offset integer;
  reference_date date;
  weekly_lines integer;
  all_lines integer;
BEGIN
  -- Venda só com serviços de comissão semanal: paga na sexta que fecha a semana.
  SELECT count(*) FILTER (WHERE line.value->>'commission_payout' = 'weekly'), count(*)
    INTO weekly_lines, all_lines
  FROM jsonb_each(CASE WHEN jsonb_typeof(NEW.servicos_details) = 'object'
    THEN NEW.servicos_details ELSE '{}'::jsonb END) line;
  IF all_lines > 0 AND weekly_lines = all_lines AND NEW.commission_month_override IS NULL THEN
    reference_date := coalesce(NEW.activation_date, NEW.sale_date, CURRENT_DATE);
    NEW.commission_payment_month_offset := 0;
    NEW.commission_expected_date :=
      reference_date + ((5 - extract(isodow FROM reference_date)::integer + 7) % 7);
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = NEW.organization_id AND o.niche = 'telecom') THEN
    NEW.commission_payment_month_offset := 1;
    NEW.commission_expected_date := CASE
      WHEN NEW.telecom_status IN ('ativo', 'instalado') AND NEW.scheduled_install_date IS NOT NULL
        THEN (date_trunc('month', NEW.scheduled_install_date AT TIME ZONE 'Europe/Lisbon') + interval '1 month')::date
      ELSE NULL
    END;
    RETURN NEW;
  END IF;
  reference_date := NEW.activation_date;
  IF NEW.telecom_status = 'instalado' THEN
    reference_date := coalesce(reference_date, (NEW.scheduled_install_date AT TIME ZONE 'Europe/Lisbon')::date);
  END IF;

  IF NEW.commission_month_override IS NOT NULL THEN
    reference_date := coalesce(reference_date, NEW.sale_date);
    month_offset := CASE WHEN reference_date IS NULL THEN 1 ELSE
      (extract(year FROM NEW.commission_month_override)::integer - extract(year FROM reference_date)::integer) * 12
      + extract(month FROM NEW.commission_month_override)::integer - extract(month FROM reference_date)::integer
    END;
    NEW.commission_payment_month_offset := least(greatest(month_offset, 1), 24);
    NEW.commission_expected_date := date_trunc('month', NEW.commission_month_override)::date;
    RETURN NEW;
  END IF;

  SELECT coalesce(max(o.commission_payment_month_offset), 0) INTO month_offset
  FROM jsonb_each(CASE WHEN jsonb_typeof(NEW.servicos_details) = 'object'
    THEN NEW.servicos_details ELSE '{}'::jsonb END) line
  JOIN public.operators o ON o.id::text = line.value->>'operator_id'
    AND o.organization_id = NEW.organization_id;

  NEW.commission_payment_month_offset := month_offset;
  NEW.commission_expected_date := CASE
    WHEN month_offset = 0 THEN coalesce(reference_date, NEW.sale_date)
    WHEN NEW.telecom_status IN ('ativo', 'instalado') AND reference_date IS NOT NULL
      THEN (date_trunc('month', reference_date) + make_interval(months => month_offset))::date
    ELSE NULL
  END;
  RETURN NEW;
END;
$function$;

-- 6. Divisão das comissões: ramo da linha manual ----------------------------------
-- O corpo completo vem a seguir (gerado da versão em produção a 20/11/2026).

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
  _operator_extra_rate numeric;
  _extra_qty    numeric;
  _extra_total  numeric;
  _operator_extra_total numeric;
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
    _operator_extra_rate := 0;
    _operator_extra_total := 0;
    -- Comissão manual: o gatilho sales_manual_commission_trg já calculou a conta
    -- e gravou o resultado em "comissao" na própria linha. A parte da empresa
    -- desta linha é 0 até o Thiago decidir a regra.
    IF lower(COALESCE(_details->_produto->>'manual_commission', 'false')) = 'true' THEN
      _any_rule := true;
      _seller_amount := ROUND(COALESCE(public._safe_numeric(_details->_produto->>'comissao'), 0), 2);
      IF _created_by IS NOT NULL AND _seller_amount <> 0 THEN
        INSERT INTO public.sale_commission_splits
          (organization_id, sale_id, user_id, product_name, source, source_ref, basis, rate, amount, extra_card_amount)
        VALUES
          (_org_id, p_sale_id, _created_by, _produto, 'user', _created_by, 'fixed', _seller_amount, _seller_amount, 0);
      END IF;
      _sum_gross  := _sum_gross + _seller_amount;
      _sum_seller := _sum_seller + _seller_amount;
      CONTINUE;
    END IF;
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
    _operator_extra_rate := COALESCE(
      public._safe_numeric(_card_tier->>'extra_card_operator_pays'),
      public._safe_numeric(_cat_entry->>'extra_card_operator_pays'), 0);
    _operator_extra_total := ROUND(_operator_extra_rate * _extra_qty, 2);
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
    -- The seller's own rate per extra card, when the split sets one: at BDS
    -- the product pays 10 € a card but Sara 5 €, so with the operator's 5 €
    -- her extra cards cost the org nothing. Same count of cards either way.
    IF _seller_split IS NOT NULL
       AND public._safe_numeric(_seller_split->>'extra_card_value') IS NOT NULL THEN
      _extra_total := ROUND(public._safe_numeric(_seller_split->>'extra_card_value') * _extra_qty, 2);
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
      _gross := ROUND(_operator_pays * _qty_own + _bonus_amount + _operator_extra_total, 2);
    ELSE
      _gross := ROUND(_seller_rate * _qty_own + _bonus_amount + _operator_extra_total, 2);
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
     SET org_commission = ROUND(_sum_gross - _sum_seller, 2)
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
