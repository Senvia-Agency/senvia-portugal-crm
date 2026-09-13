-- Keep legacy plan identifiers and user entitlements: they record contracted seats.
-- Price migration in Stripe is a separate, explicitly authorized release step.
UPDATE public.subscription_plans
SET name = 'SENVIA OS', price_monthly = 49, max_forms = NULL, max_inboxes = NULL,
    features = coalesce(features, '{}'::jsonb) || jsonb_build_object(
      'modules', jsonb_build_object('sales',true,'finance',true,'marketing',true,'ecommerce',false),
      'integrations', jsonb_build_object('invoicing',true,'meta_pixels',true,'stripe',true,'whatsapp',false),
      'features', jsonb_build_object('conversational_forms',true,'multi_org',true,'push_notifications',true,'fidelization_alerts',true)
    )
WHERE id IN ('basic','starter','pro','elite');

-- Legacy ids now describe seat entitlements only. Reconciliation must not
-- reduce a paid Pro/Elite team when Stripe reports the single Starter product.
CREATE FUNCTION public.preserve_contracted_seats() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.plan::text IN ('pro','elite') AND NEW.plan::text = 'starter' THEN NEW.plan := OLD.plan; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_contracted_seats BEFORE UPDATE OF plan ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.preserve_contracted_seats();
