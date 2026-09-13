-- Local audit fixes; requires referral_program and referral_billing.
DROP POLICY referral_codes_read ON public.referral_codes;
DROP POLICY organization_referrals_read ON public.organization_referrals;
CREATE POLICY referral_codes_read ON public.referral_codes FOR SELECT TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id));
CREATE POLICY organization_referrals_read ON public.organization_referrals FOR SELECT TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id));

-- Preserve the earliest confirmed payment even when Stripe events arrive out of order.
CREATE OR REPLACE FUNCTION public.qualify_referral(_organization_id uuid, _invoice_id text, _paid_at timestamptz) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.organizations SET first_paid_at = _paid_at
  WHERE id = _organization_id AND _invoice_id IS NOT NULL
    AND _paid_at >= date_trunc('second', created_at)
    AND (first_paid_at IS NULL OR _paid_at < first_paid_at);
  UPDATE public.organization_referrals SET qualified_at = _paid_at, qualifying_invoice_id = _invoice_id
  WHERE referred_organization_id = _organization_id AND revoked_at IS NULL
    AND _paid_at >= date_trunc('second', created_at) AND _invoice_id IS NOT NULL
    AND (qualified_at IS NULL OR _paid_at < qualified_at);
$$;

ALTER TABLE public.organization_billing_accounts
  ADD COLUMN collection_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN checkout_attempt uuid,
  ADD COLUMN checkout_expires_at timestamptz,
  ADD COLUMN checkout_parameters jsonb;

-- A delayed fetch for an old subscription cannot overwrite a replacement subscription.
CREATE FUNCTION public.sync_referral_billing(_organization_id uuid, _customer_id text, _subscription_id text,
  _snapshot jsonb, _observed_at timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE binding public.organization_billing_accounts%ROWTYPE;
BEGIN
  SELECT * INTO binding FROM public.organization_billing_accounts WHERE organization_id = _organization_id FOR UPDATE;
  IF NOT FOUND OR binding.stripe_customer_id <> _customer_id THEN RAISE EXCEPTION 'Billing binding mismatch'; END IF;
  IF binding.synced_at > _observed_at THEN RETURN false; END IF;
  IF binding.stripe_subscription_id IS NOT NULL AND binding.stripe_subscription_id <> _subscription_id THEN
    IF coalesce(binding.status,'') NOT IN ('canceled','incomplete_expired')
      OR coalesce(_snapshot->>'status','') IN ('canceled','incomplete_expired') THEN RETURN false; END IF;
  END IF;
  UPDATE public.organization_billing_accounts SET
    stripe_subscription_id = _subscription_id, status = _snapshot->>'status',
    billing_interval = _snapshot->>'billing_interval', interval_count = (_snapshot->>'interval_count')::integer,
    next_renewal_at = (_snapshot->>'next_renewal_at')::timestamptz,
    cancel_at_period_end = coalesce((_snapshot->>'cancel_at_period_end')::boolean,false),
    collection_paused = coalesce((_snapshot->>'collection_paused')::boolean,false), synced_at = _observed_at
  WHERE organization_id = _organization_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.sync_referral_billing(uuid,text,text,jsonb,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_referral_billing(uuid,text,text,jsonb,timestamptz) TO service_role;

-- Persist the idempotency key and identical Stripe parameters before opening checkout.
CREATE FUNCTION public.claim_referral_checkout(_organization_id uuid, _parameters jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE binding public.organization_billing_accounts%ROWTYPE;
BEGIN
  SELECT * INTO binding FROM public.organization_billing_accounts WHERE organization_id = _organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Billing binding missing'; END IF;
  IF binding.checkout_attempt IS NULL OR binding.checkout_expires_at <= now() THEN
    UPDATE public.organization_billing_accounts SET checkout_attempt = gen_random_uuid(),
      checkout_expires_at = date_trunc('second',now()) + interval '1 hour', checkout_parameters = _parameters
    WHERE organization_id = _organization_id RETURNING * INTO binding;
  ELSIF binding.checkout_parameters IS DISTINCT FROM _parameters THEN
    RAISE EXCEPTION 'Já existe um pagamento iniciado com outros dados. Aguarda que expire antes de iniciar outro.';
  END IF;
  RETURN jsonb_build_object('attempt',binding.checkout_attempt,'expires_at',extract(epoch FROM binding.checkout_expires_at)::bigint);
END $$;
REVOKE ALL ON FUNCTION public.claim_referral_checkout(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_referral_checkout(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_referral_dashboard(_organization_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE referral_code uuid; entries jsonb; billing jsonb;
BEGIN
  IF NOT public.is_org_admin(auth.uid(), _organization_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  INSERT INTO public.referral_codes(organization_id) VALUES (_organization_id) ON CONFLICT DO NOTHING;
  SELECT code INTO referral_code FROM public.referral_codes WHERE organization_id = _organization_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'name', o.name, 'created_at', r.created_at,
    'qualified_at', r.qualified_at, 'redeemed_at', r.redeemed_at,
    'reserved', r.redemption_invoice_id IS NOT NULL AND r.redeemed_at IS NULL,
    'revoked_at', r.revoked_at
  ) ORDER BY r.created_at DESC), '[]'::jsonb) INTO entries
  FROM public.organization_referrals r JOIN public.organizations o ON o.id = r.referred_organization_id
  WHERE r.organization_id = _organization_id;
  SELECT jsonb_build_object(
    'exempt', coalesce(o.billing_exempt, false), 'status', b.status,
    'interval', b.billing_interval, 'interval_count', b.interval_count,
    'next_renewal_at', b.next_renewal_at, 'cancel_at_period_end', b.cancel_at_period_end,
    'synced_at', b.synced_at, 'collection_paused', b.collection_paused
  ) INTO billing FROM public.organizations o
  LEFT JOIN public.organization_billing_accounts b ON b.organization_id = o.id
  WHERE o.id = _organization_id;
  RETURN jsonb_build_object('code', referral_code, 'referrals', entries, 'billing', billing);
END $$;

-- Never revive a revoked/consumed reservation on webhook retry.
CREATE OR REPLACE FUNCTION public.reserve_referral_month(_organization_id uuid, _invoice_id text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE reward_id uuid; existing public.organization_referrals%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id = _organization_id FOR UPDATE;
  SELECT * INTO existing FROM public.organization_referrals
    WHERE organization_id = _organization_id AND redemption_invoice_id = _invoice_id;
  IF FOUND THEN
    IF existing.revoked_at IS NOT NULL OR existing.redeemed_at IS NOT NULL THEN RETURN NULL; END IF;
    RETURN existing.id;
  END IF;
  SELECT id INTO reward_id FROM public.organization_referrals
    WHERE organization_id = _organization_id AND qualified_at IS NOT NULL
      AND redemption_invoice_id IS NULL AND revoked_at IS NULL
    ORDER BY qualified_at, id LIMIT 1 FOR UPDATE;
  IF reward_id IS NOT NULL THEN
    UPDATE public.organization_referrals SET redemption_invoice_id = _invoice_id WHERE id = reward_id;
  END IF;
  RETURN reward_id;
END $$;
