ALTER TABLE public.bds_sara_org_commission
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

DROP POLICY IF EXISTS "BDS admins update Sara organization commission" ON public.bds_sara_org_commission;
CREATE POLICY "BDS admins update Sara organization commission"
ON public.bds_sara_org_commission FOR UPDATE
USING (
  organization_id = get_user_org_id(auth.uid())
  AND has_role(auth.uid(), 'admin'::app_role)
)
WITH CHECK (
  organization_id = get_user_org_id(auth.uid())
  AND has_role(auth.uid(), 'admin'::app_role)
);

DROP POLICY IF EXISTS "Super admins update Sara organization commission" ON public.bds_sara_org_commission;
CREATE POLICY "Super admins update Sara organization commission"
ON public.bds_sara_org_commission FOR UPDATE
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));
