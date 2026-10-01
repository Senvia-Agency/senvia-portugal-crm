-- Uploading a file in a WhatsApp step ("Enviar WhatsApp" → anexo) failed with
-- "new row violates row-level security policy" for the super admin working in
-- an organization they are not a member of (BDS): the policies check
-- is_org_member(), which — unlike is_org_admin() — has no super_admin pass.
-- The super admin can already edit those organizations' automations; this
-- lets them attach the files too. Everyone else is unchanged: members of the
-- organization whose folder the file goes in.

DROP POLICY IF EXISTS "automation media org upload" ON storage.objects;
CREATE POLICY "automation media org upload"
ON storage.objects FOR INSERT TO public
WITH CHECK (
  bucket_id = 'automation-media'
  AND auth.role() = 'authenticated'
  AND (
    public.is_org_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
    OR public.has_role(auth.uid(), 'super_admin')
  )
);

DROP POLICY IF EXISTS "automation media org delete" ON storage.objects;
CREATE POLICY "automation media org delete"
ON storage.objects FOR DELETE TO public
USING (
  bucket_id = 'automation-media'
  AND auth.role() = 'authenticated'
  AND (
    public.is_org_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
    OR public.has_role(auth.uid(), 'super_admin')
  )
);
