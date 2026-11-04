-- Redistribuição de leads: a super admin visiting an organization could not save it (403).
--
-- The settings are saved with an upsert (INSERT … ON CONFLICT DO UPDATE … RETURNING), and
-- Postgres also applies the SELECT policy to it. Reading was members-only, while writing is
-- for admins — and is_org_admin counts a super admin, who is not a member of the
-- organizations they visit. Admins (super admin included) can now read what they may write.

BEGIN;

DROP POLICY IF EXISTS "Members read reassignment settings" ON public.lead_reassignment_settings;
CREATE POLICY "Members read reassignment settings" ON public.lead_reassignment_settings
  FOR SELECT TO authenticated
  USING (
    public.is_org_member((SELECT auth.uid()), organization_id)
    OR public.is_org_admin((SELECT auth.uid()), organization_id)
  );

COMMIT;
