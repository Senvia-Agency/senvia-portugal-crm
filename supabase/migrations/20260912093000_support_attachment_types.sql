-- Only reviewed text/image/document types. No executable or Office macro formats.
UPDATE storage.buckets SET allowed_mime_types = ARRAY[
  'image/jpeg','image/png','image/webp','application/pdf',
  'text/plain','text/csv','text/markdown','application/json'
] WHERE id = 'support-attachments';

CREATE POLICY support_attachments_tenant_insert ON storage.objects AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id <> 'support-attachments' OR
    EXISTS (SELECT 1 FROM public.organization_members m
      WHERE m.user_id = auth.uid() AND m.is_active AND m.organization_id::text = (storage.foldername(name))[1])
  );
