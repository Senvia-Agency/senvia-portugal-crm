-- Keep fiscal PDFs private while allowing organization members to create
-- signed URLs for files stored under their organization folder.
DROP POLICY IF EXISTS "Org members can read invoice files" ON storage.objects;
CREATE POLICY "Org members can read invoice files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'invoices'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT organizations.id::text
        FROM public.organizations
        WHERE public.is_org_member(auth.uid(), organizations.id)
      )
      OR EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = auth.uid()
          AND role = 'super_admin'
      )
    )
  );
