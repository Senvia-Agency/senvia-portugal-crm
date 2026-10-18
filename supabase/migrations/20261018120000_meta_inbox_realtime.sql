-- Deliver WhatsApp/Meta webhook changes to the open inbox. Existing RLS policies
-- still restrict each subscriber to their own organization's rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'meta_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.meta_conversations;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'meta_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.meta_messages;
  END IF;
END $$;
