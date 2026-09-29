-- A SID belongs to the exact API key and endpoint that created it. Never
-- reuse a cached session after either setting changes.
CREATE OR REPLACE FUNCTION public.clear_keyinvoice_session_on_credential_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.keyinvoice_password IS DISTINCT FROM OLD.keyinvoice_password
     OR coalesce(nullif(btrim(NEW.keyinvoice_api_url), ''),
       'https://login.keyinvoice.com/API5.php')
       IS DISTINCT FROM coalesce(nullif(btrim(OLD.keyinvoice_api_url), ''),
       'https://login.keyinvoice.com/API5.php') THEN
    NEW.keyinvoice_sid := NULL;
    NEW.keyinvoice_sid_expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_keyinvoice_session_on_credential_change_trg
  ON public.organizations;
CREATE TRIGGER clear_keyinvoice_session_on_credential_change_trg
BEFORE UPDATE OF keyinvoice_password, keyinvoice_api_url
ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.clear_keyinvoice_session_on_credential_change();
