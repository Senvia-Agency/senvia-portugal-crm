-- "Mostrar sempre as imagens deste remetente" in the email reader.
--
-- Remote images in an email are blocked by default (a tracking pixel tells the
-- sender the email was opened). This is the list of senders a user chose to
-- trust: their images load straight away. Per user, like Gmail, so it follows
-- the person to every device. Addresses are stored lowercase.
--
-- No new policy needed: "Users update own profile" already limits each user to
-- their own row.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_image_senders text[] NOT NULL DEFAULT '{}';
