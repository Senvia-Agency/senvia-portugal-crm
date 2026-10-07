-- BDS-only commission rates, Sara's organization share and manual chargebacks.
CREATE TABLE IF NOT EXISTS public.bds_manual_chargebacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  client_id uuid REFERENCES public.crm_clients(id) ON DELETE SET NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  reason text NOT NULL DEFAULT 'manual' CHECK (reason = 'manual'),
  status text NOT NULL DEFAULT 'reconciled' CHECK (status IN ('pending', 'reconciled', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bds_manual_chargebacks_org_status_idx ON public.bds_manual_chargebacks (organization_id, status);
CREATE TRIGGER bds_manual_chargebacks_updated_at BEFORE UPDATE ON public.bds_manual_chargebacks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.bds_manual_chargebacks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "BDS members view manual chargebacks" ON public.bds_manual_chargebacks;
CREATE POLICY "BDS members view manual chargebacks" ON public.bds_manual_chargebacks FOR SELECT
USING (is_org_member(auth.uid(), organization_id) OR has_role(auth.uid(), 'super_admin'::app_role));
DROP POLICY IF EXISTS "BDS admins manage manual chargebacks" ON public.bds_manual_chargebacks;
CREATE POLICY "BDS admins manage manual chargebacks" ON public.bds_manual_chargebacks FOR ALL
USING (organization_id = get_user_org_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Super admin full access BDS manual chargebacks" ON public.bds_manual_chargebacks;
CREATE POLICY "Super admin full access BDS manual chargebacks" ON public.bds_manual_chargebacks FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE OR REPLACE FUNCTION public.validate_bds_manual_chargeback()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = NEW.organization_id AND o.name = 'BDS Telecomunicações') THEN
    RAISE EXCEPTION 'Chargeback manual disponível apenas para a BDS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members m WHERE m.organization_id = NEW.organization_id AND m.user_id = NEW.user_id AND m.is_active) THEN
    RAISE EXCEPTION 'Comercial não pertence à organização BDS';
  END IF;
  IF NEW.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.crm_clients c WHERE c.id = NEW.client_id AND c.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'Cliente não pertence à organização BDS';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_bds_manual_chargeback_trg ON public.bds_manual_chargebacks;
CREATE TRIGGER validate_bds_manual_chargeback_trg BEFORE INSERT OR UPDATE ON public.bds_manual_chargebacks
FOR EACH ROW EXECUTE FUNCTION public.validate_bds_manual_chargeback();

CREATE TABLE IF NOT EXISTS public.bds_sara_org_commission (
  sale_id uuid PRIMARY KEY REFERENCES public.sales(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bds_sara_org_commission ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "BDS members view Sara organization commission" ON public.bds_sara_org_commission;
CREATE POLICY "BDS members view Sara organization commission" ON public.bds_sara_org_commission FOR SELECT
USING (is_org_member(auth.uid(), organization_id) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE OR REPLACE FUNCTION public.sync_bds_sara_org_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sara_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = NEW.organization_id AND name = 'BDS Telecomunicações') THEN RETURN NEW; END IF;
  SELECT m.user_id INTO _sara_id
  FROM public.organization_members m JOIN public.profiles p ON p.id = m.user_id
  WHERE m.organization_id = NEW.organization_id AND p.full_name ILIKE 'Sara Vieira'
  ORDER BY m.created_at LIMIT 1;
  IF _sara_id IS NULL OR COALESCE(NEW.org_commission, 0) <= 0 THEN
    DELETE FROM public.bds_sara_org_commission WHERE sale_id = NEW.id;
  ELSE
    INSERT INTO public.bds_sara_org_commission (sale_id, organization_id, user_id, amount)
    VALUES (NEW.id, NEW.organization_id, _sara_id, NEW.org_commission)
    ON CONFLICT (sale_id) DO UPDATE SET user_id = EXCLUDED.user_id, amount = EXCLUDED.amount, updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_bds_sara_org_commission_trg ON public.sales;
CREATE TRIGGER sync_bds_sara_org_commission_trg AFTER UPDATE OF org_commission ON public.sales
FOR EACH ROW WHEN (NEW.org_commission IS DISTINCT FROM OLD.org_commission)
EXECUTE FUNCTION public.sync_bds_sara_org_commission();

DO $$
DECLARE _org uuid; _sara uuid; _vitor uuid; _seller_profile uuid;
BEGIN
  SELECT id INTO _org FROM public.organizations WHERE name = 'BDS Telecomunicações' LIMIT 1;
  IF _org IS NULL THEN RAISE EXCEPTION 'Organização BDS Telecomunicações não encontrada'; END IF;
  SELECT m.user_id INTO _sara FROM public.organization_members m JOIN public.profiles p ON p.id = m.user_id
    WHERE m.organization_id = _org AND p.full_name ILIKE 'Sara Vieira' ORDER BY m.created_at LIMIT 1;
  SELECT m.user_id INTO _vitor FROM public.organization_members m JOIN public.profiles p ON p.id = m.user_id
    WHERE m.organization_id = _org AND (p.full_name ILIKE 'Vitor%' OR p.full_name ILIKE 'Vítor%') ORDER BY m.created_at LIMIT 1;
  SELECT id INTO _seller_profile FROM public.organization_profiles WHERE organization_id = _org AND name ILIKE 'Vendedor' LIMIT 1;
  IF _sara IS NULL OR _vitor IS NULL OR _seller_profile IS NULL THEN RAISE EXCEPTION 'Sara, Vitor ou perfil Vendedor não encontrado na BDS'; END IF;

  UPDATE public.organizations o SET servicos_products_config = (
    SELECT jsonb_agg(CASE
      WHEN c.entry->'type_ids' ? 'cartoes' THEN
        jsonb_set(jsonb_set(jsonb_set(c.entry, '{extra_card_commission}', '5'::jsonb), '{quantity_tiers}', COALESCE((
          SELECT jsonb_agg(jsonb_set(t.entry, '{extra_card_commission}', '5'::jsonb)) FROM jsonb_array_elements(COALESCE(c.entry->'quantity_tiers', '[]'::jsonb)) t(entry)
        ), '[]'::jsonb)), '{splits}', COALESCE((
          SELECT jsonb_agg(CASE
            WHEN s.entry->>'kind' = 'user' AND s.entry->>'user_id' IN (_sara::text, _vitor::text) THEN jsonb_set(s.entry, '{extra_cards}', 'true'::jsonb)
            ELSE jsonb_set(s.entry, '{extra_cards}', 'false'::jsonb)
          END) FROM jsonb_array_elements(COALESCE(c.entry->'splits', '[]'::jsonb)) s(entry)
        ), '[]'::jsonb))
      WHEN c.entry->'type_ids' ? 'gas' THEN
        jsonb_set(jsonb_set(c.entry, '{tiered_commission}', 'false'::jsonb), '{splits}', jsonb_build_array(
          jsonb_build_object('kind','user','user_id',_sara,'type','fixed','value',15),
          jsonb_build_object('kind','user','user_id',_vitor,'type','fixed','value',15),
          jsonb_build_object('kind','profile','profile_id',_seller_profile,'type','fixed','value',10)
        ))
      ELSE c.entry END)
    FROM jsonb_array_elements(o.servicos_products_config) c(entry)
  ) WHERE o.id = _org AND jsonb_typeof(o.servicos_products_config) = 'array';

  INSERT INTO public.bds_sara_org_commission (organization_id, sale_id, user_id, amount)
  SELECT s.organization_id, s.id, _sara, s.org_commission
  FROM public.sales s WHERE s.organization_id = _org AND COALESCE(s.org_commission,0) > 0
  ON CONFLICT (sale_id) DO UPDATE SET user_id = EXCLUDED.user_id, amount = EXCLUDED.amount, updated_at = now();
END;
$$;
