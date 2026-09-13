-- Local-only: apply together with referral_program and the matching billing functions.
-- Tenant-to-Stripe binding is server-owned; email addresses never identify tenants.
CREATE TABLE public.organization_billing_accounts (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
  stripe_customer_id text NOT NULL UNIQUE CHECK (stripe_customer_id LIKE 'cus\_%' ESCAPE '\'),
  stripe_subscription_id text UNIQUE,
  status text,
  billing_interval text,
  interval_count integer,
  next_renewal_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.organization_billing_accounts ENABLE ROW LEVEL SECURITY;
-- No client policy: admins receive only the safe billing summary through the RPC.
REVOKE ALL ON public.organization_billing_accounts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.organization_billing_accounts TO service_role;

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
    'synced_at', b.synced_at
  ) INTO billing FROM public.organizations o
  LEFT JOIN public.organization_billing_accounts b ON b.organization_id = o.id
  WHERE o.id = _organization_id;
  RETURN jsonb_build_object('code', referral_code, 'referrals', entries, 'billing', billing);
END $$;
