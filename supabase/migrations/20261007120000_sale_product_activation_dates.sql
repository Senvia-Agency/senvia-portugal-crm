-- Restrict changes to product activation dates while keeping the existing
-- servicos_details structure and its normal product-edit permissions.
CREATE OR REPLACE FUNCTION public.guard_sale_product_activation_dates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_dates jsonb;
  new_dates jsonb;
BEGIN
  SELECT COALESCE(jsonb_object_agg(key, value->'activation_date')
    FILTER (WHERE value ? 'activation_date'), '{}'::jsonb)
  INTO old_dates
  FROM jsonb_each(COALESCE(OLD.servicos_details, '{}'::jsonb));

  SELECT COALESCE(jsonb_object_agg(key, value->'activation_date')
    FILTER (WHERE value ? 'activation_date'), '{}'::jsonb)
  INTO new_dates
  FROM jsonb_each(COALESCE(NEW.servicos_details, '{}'::jsonb));

  IF old_dates IS DISTINCT FROM new_dates
    AND COALESCE(auth.role(), '') <> 'service_role'
    AND NOT COALESCE(public.has_role(auth.uid(), 'super_admin'::public.app_role), false)
    AND NOT COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false)
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_members member
      JOIN public.organization_profiles profile ON profile.id = member.profile_id
      WHERE member.organization_id = NEW.organization_id
        AND member.user_id = auth.uid()
        AND member.is_active
        AND profile.base_role = 'admin'
    )
  THEN
    RAISE EXCEPTION 'Only admins may change product activation dates'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_sale_product_activation_dates_trg ON public.sales;
CREATE TRIGGER guard_sale_product_activation_dates_trg
BEFORE UPDATE OF servicos_details ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.guard_sale_product_activation_dates();
