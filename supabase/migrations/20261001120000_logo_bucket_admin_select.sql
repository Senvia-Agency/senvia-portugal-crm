-- Logo upload failed with "new row violates row-level security policy".
--
-- LogoUploader uploads with upsert: true, and Storage runs an upsert as
-- INSERT ... ON CONFLICT ... RETURNING. RETURNING makes Postgres check the new
-- row against the SELECT policies too, and organization-logos no longer has
-- one: the original "Public can view logos" (20260107190616) was dropped
-- outside the migrations, most likely to clear the "public bucket allows
-- listing" advisor warning. The INSERT policy itself passes.
--
-- Public logo URLs never needed a SELECT policy (the bucket is public). What
-- needs one is the API: upsert, and remove() of the previous logo. So this
-- grants SELECT only to admins of the organization whose folder the file is
-- in — the same rule as INSERT/UPDATE/DELETE (20260723122000) — and nobody
-- can list other organizations' files.

DROP POLICY IF EXISTS "Admins can read logos" ON storage.objects;
CREATE POLICY "Admins can read logos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'organization-logos'
  AND public.is_org_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
