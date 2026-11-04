-- Photos of a WhatsApp album (several sent at once) that arrived before evolution-webhook opened
-- associatedChildMessage were saved as the text "[associatedChild]" with no attachment. They become
-- what they are: a photo, fetched from Evolution by the message id when opened (meta-media).
-- Only rows still in that state change; running it twice does nothing more.
BEGIN;

UPDATE public.meta_messages m
   SET content = NULL,
       attachments = jsonb_build_array(jsonb_build_object(
         'type', 'image', 'media_id', m.external_id, 'url', NULL, 'mime', 'image/jpeg'))
  FROM public.meta_conversations c
  JOIN public.messaging_channels ch ON ch.id = c.channel_id
 WHERE c.id = m.conversation_id
   AND ch.provider = 'evolution'
   AND m.content = '[associatedChild]'
   AND m.external_id IS NOT NULL
   AND m.attachments = '[]'::jsonb;

UPDATE public.meta_conversations
   SET last_message = '[image]'
 WHERE last_message = '[associatedChild]';

COMMIT;

-- Check (expected: 0)
-- SELECT count(*) FROM public.meta_messages WHERE content = '[associatedChild]';
