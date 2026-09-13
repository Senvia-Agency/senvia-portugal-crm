-- Local-only until deployment is explicitly authorized.
-- Permanent attribution and reward ledger; never cascade-delete billing history.
CREATE TABLE public.referral_codes (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
  code uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.organization_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  referred_organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  qualified_at timestamptz,
  qualifying_invoice_id text UNIQUE,
  redemption_invoice_id text UNIQUE,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  CHECK (organization_id <> referred_organization_id),
  CHECK ((qualified_at IS NULL) = (qualifying_invoice_id IS NULL)),
  CHECK (redeemed_at IS NULL OR redemption_invoice_id IS NOT NULL)
);
CREATE INDEX organization_referrals_rewards_idx ON public.organization_referrals(organization_id, qualified_at)
  WHERE qualified_at IS NOT NULL AND redemption_invoice_id IS NULL AND revoked_at IS NULL;
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY referral_codes_read ON public.referral_codes FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY organization_referrals_read ON public.organization_referrals FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
REVOKE ALL ON public.referral_codes, public.organization_referrals FROM anon, authenticated;
GRANT SELECT ON public.referral_codes, public.organization_referrals TO authenticated;
GRANT ALL ON public.referral_codes, public.organization_referrals TO service_role;

-- Attribution only at initial signup, not when adding members to existing orgs.
CREATE FUNCTION public.capture_organization_referral() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE referring_org uuid; signup_code text;
BEGIN
  IF NEW.role::text <> 'admin' THEN RETURN NEW; END IF;
  SELECT u.raw_user_meta_data->>'referral_code' INTO signup_code
  FROM auth.users u JOIN public.organizations o ON o.id = NEW.organization_id
  WHERE u.id = NEW.user_id AND u.created_at > now() - interval '1 day'
    AND o.created_at > now() - interval '5 minutes'
    AND o.slug = u.raw_user_meta_data->>'organization_slug'
    AND o.first_paid_at IS NULL;
  IF signup_code IS NULL THEN RETURN NEW; END IF;
  SELECT organization_id INTO referring_org FROM public.referral_codes WHERE code::text = lower(signup_code);
  IF referring_org IS NULL OR referring_org = NEW.organization_id THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = referring_org AND user_id = NEW.user_id)
    THEN RETURN NEW; END IF;
  INSERT INTO public.organization_referrals(organization_id, referred_organization_id)
  VALUES (referring_org, NEW.organization_id) ON CONFLICT (referred_organization_id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER capture_organization_referral AFTER INSERT ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.capture_organization_referral();

CREATE FUNCTION public.get_referral_dashboard(_organization_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE referral_code uuid; entries jsonb;
BEGIN
  IF NOT public.is_org_admin(auth.uid(), _organization_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  INSERT INTO public.referral_codes(organization_id) VALUES (_organization_id) ON CONFLICT DO NOTHING;
  SELECT code INTO referral_code FROM public.referral_codes WHERE organization_id = _organization_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'name', o.name, 'created_at', r.created_at,
    'qualified_at', r.qualified_at, 'redeemed_at', r.redeemed_at,
    'reserved', r.redemption_invoice_id IS NOT NULL, 'revoked_at', r.revoked_at
  ) ORDER BY r.created_at DESC), '[]'::jsonb) INTO entries
  FROM public.organization_referrals r JOIN public.organizations o ON o.id = r.referred_organization_id
  WHERE r.organization_id = _organization_id;
  RETURN jsonb_build_object('code', referral_code, 'referrals', entries);
END $$;

-- Trusted webhook only. Each referred org earns exactly one reward.
CREATE FUNCTION public.qualify_referral(_organization_id uuid, _invoice_id text, _paid_at timestamptz) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.organization_referrals SET qualified_at = _paid_at, qualifying_invoice_id = _invoice_id
  WHERE referred_organization_id = _organization_id AND qualified_at IS NULL AND revoked_at IS NULL;
$$;

-- Lock the org as well as the reward: simultaneous invoice deliveries cannot
-- reserve two rewards for the same invoice. Replays return the same reservation.
CREATE FUNCTION public.reserve_referral_month(_organization_id uuid, _invoice_id text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE reward_id uuid;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id = _organization_id FOR UPDATE;
  SELECT id INTO reward_id FROM public.organization_referrals
    WHERE organization_id = _organization_id AND redemption_invoice_id = _invoice_id;
  IF reward_id IS NOT NULL THEN RETURN reward_id; END IF;
  SELECT id INTO reward_id FROM public.organization_referrals
    WHERE organization_id = _organization_id AND qualified_at IS NOT NULL
      AND redemption_invoice_id IS NULL AND revoked_at IS NULL
    ORDER BY qualified_at, id LIMIT 1 FOR UPDATE;
  IF reward_id IS NOT NULL THEN
    UPDATE public.organization_referrals SET redemption_invoice_id = _invoice_id WHERE id = reward_id;
  END IF;
  RETURN reward_id;
END $$;
REVOKE ALL ON FUNCTION public.capture_organization_referral() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_referral_dashboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_referral_dashboard(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.qualify_referral(uuid,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_referral_month(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qualify_referral(uuid,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_referral_month(uuid,text) TO service_role;
