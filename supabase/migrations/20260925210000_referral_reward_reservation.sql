-- Reserve the exact earned month whose one-time Stripe coupon discounted an invoice.
-- The existing two-argument function remains for the legacy shared coupon.
ALTER TABLE public.organization_referrals ADD COLUMN IF NOT EXISTS stripe_coupon_id text;
CREATE UNIQUE INDEX IF NOT EXISTS organization_referrals_stripe_coupon_id_key
  ON public.organization_referrals(stripe_coupon_id);

CREATE OR REPLACE FUNCTION public.reserve_referral_month_for_reward(
  _organization_id uuid, _invoice_id text, _reward_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing public.organization_referrals%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id = _organization_id FOR UPDATE;
  SELECT * INTO existing FROM public.organization_referrals
    WHERE id = _reward_id AND organization_id = _organization_id FOR UPDATE;
  IF NOT FOUND OR existing.qualified_at IS NULL OR existing.revoked_at IS NOT NULL
    OR existing.redeemed_at IS NOT NULL THEN RETURN NULL; END IF;
  IF existing.redemption_invoice_id = _invoice_id THEN RETURN existing.id; END IF;
  IF existing.redemption_invoice_id IS NOT NULL THEN RETURN NULL; END IF;
  IF EXISTS (
    SELECT 1 FROM public.organization_referrals
    WHERE organization_id = _organization_id AND redemption_invoice_id = _invoice_id
  ) THEN RETURN NULL; END IF;
  UPDATE public.organization_referrals SET redemption_invoice_id = _invoice_id
    WHERE id = existing.id;
  RETURN existing.id;
END $$;
REVOKE ALL ON FUNCTION public.reserve_referral_month_for_reward(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_referral_month_for_reward(uuid,text,uuid) TO service_role;
