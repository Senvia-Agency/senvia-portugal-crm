BEGIN;
CREATE OR REPLACE FUNCTION public.capture_automation_email_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE events text[]:=ARRAY[]::text[]; event_name text; f record; payload jsonb; contact jsonb;
  subject text; subject_id uuid; secret text; normalized_email text; phone text;
BEGIN
  IF NEW.opened_at IS NOT NULL AND OLD.opened_at IS NULL THEN events:=array_append(events,'email_opened'); END IF;
  IF NEW.clicked_at IS NOT NULL AND OLD.clicked_at IS NULL THEN events:=array_append(events,'email_clicked'); END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status='bounced' THEN events:=array_append(events,'email_bounced'); END IF;
    IF NEW.status='unsubscribed' THEN events:=array_append(events,'email_unsubscribed'); END IF;
  END IF;
  IF cardinality(events)=0 THEN RETURN NEW; END IF;
  normalized_email:=lower(trim(NEW.recipient_email));
  IF normalized_email IS NULL OR normalized_email='' THEN RETURN NEW; END IF;
  IF NEW.client_id IS NOT NULL THEN
    SELECT to_jsonb(c) INTO contact FROM public.crm_clients c
      WHERE c.id=NEW.client_id AND c.organization_id=NEW.organization_id;
    IF contact IS NOT NULL THEN subject:='client'; subject_id:=NEW.client_id; END IF;
  END IF;
  IF contact IS NULL THEN
    SELECT CASE WHEN count(*)=1 THEN jsonb_agg(to_jsonb(l))->0 ELSE NULL END INTO contact FROM public.leads l
      WHERE l.organization_id=NEW.organization_id AND lower(trim(l.email))=normalized_email
      AND l.automation_enabled IS DISTINCT FROM false;
    IF contact IS NOT NULL THEN subject:='lead'; subject_id:=(contact->>'id')::uuid; END IF;
  END IF;
  IF contact IS NULL THEN
    subject:='contact'; subject_id:=NEW.id;
    contact:=jsonb_build_object('id',NEW.id,'name',NEW.recipient_name,'email',NEW.recipient_email);
  END IF;
  payload:=contact || jsonb_build_object('email_send_id',NEW.id,'email_template_id',NEW.template_id,
    'email_campaign_id',NEW.campaign_id,'email_subject',NEW.subject,'email',NEW.recipient_email);
  IF 'email_unsubscribed'=ANY(events) THEN
    UPDATE public.marketing_contacts SET subscribed=false
      WHERE organization_id=NEW.organization_id AND lower(trim(email))=normalized_email;
    phone:=public.automation_phone_key(contact->>'phone');
    INSERT INTO public.automation_contact_suppressions(organization_id,phone_key,email,reason)
      VALUES(NEW.organization_id,coalesce(phone,'email:'||normalized_email),normalized_email,'Pedido para parar mensagens por email')
      ON CONFLICT(organization_id,phone_key) DO UPDATE SET email=excluded.email;
    UPDATE public.automation_runs SET status='cancelled',wake_at=NULL,completed_at=now(),last_error='Contacto cancelou mensagens por email'
      WHERE organization_id=NEW.organization_id AND lower(trim(contact_email))=normalized_email
      AND status IN ('running','waiting','awaiting_reply');
  END IF;
  secret:=public.automation_internal_secret();
  IF nullif(secret,'') IS NULL THEN RETURN NEW; END IF;
  FOREACH event_name IN ARRAY events LOOP
    FOR f IN SELECT id FROM public.automation_flows WHERE organization_id=NEW.organization_id
      AND status='active' AND trigger_type=event_name
      AND (nullif(trigger_config->>'template_id','') IS NULL OR trigger_config->>'template_id'=NEW.template_id::text)
      AND (nullif(trigger_config->>'campaign_id','') IS NULL OR trigger_config->>'campaign_id'=NEW.campaign_id::text)
    LOOP
      PERFORM net.http_post(url:='https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/automation-engine',
        headers:=jsonb_build_object('Content-Type','application/json','x-automation-secret',secret),
        body:=jsonb_build_object('action','enroll','flow_id',f.id,'trigger_type',event_name,'organization_id',NEW.organization_id,
          'subject_type',subject,'record',payload||jsonb_build_object('email_event',event_name),
          'occurrence_key',NEW.id::text||':'||event_name));
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_automation_email_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER capture_automation_email_event AFTER UPDATE ON public.email_sends
FOR EACH ROW EXECUTE FUNCTION public.capture_automation_email_event();
COMMIT;
