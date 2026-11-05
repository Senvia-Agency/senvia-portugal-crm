BEGIN;
CREATE OR REPLACE FUNCTION public.guard_automation_list_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.client_lists l JOIN public.marketing_contacts c ON c.organization_id=l.organization_id
    WHERE l.id=NEW.list_id AND c.id=NEW.contact_id) THEN
    RAISE EXCEPTION 'A lista e o contacto devem pertencer à mesma organização';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_automation_list_membership() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_automation_list_membership BEFORE INSERT OR UPDATE ON public.marketing_list_members
FOR EACH ROW EXECUTE FUNCTION public.guard_automation_list_membership();

CREATE OR REPLACE FUNCTION public.capture_automation_list_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE membership jsonb; list_record jsonb; marketing jsonb; contact jsonb; payload jsonb; matches integer;
  subject text:='contact'; subject_id uuid; event_name text; f record; secret text; normalized_email text;
BEGIN
  IF TG_OP='DELETE' THEN membership:=to_jsonb(OLD); event_name:='list_left';
  ELSE membership:=to_jsonb(NEW); event_name:='list_joined'; END IF;
  SELECT to_jsonb(l) INTO list_record FROM public.client_lists l WHERE l.id=(membership->>'list_id')::uuid;
  IF list_record IS NULL THEN RETURN NULL; END IF;
  SELECT to_jsonb(c) INTO marketing FROM public.marketing_contacts c
    WHERE c.id=(membership->>'contact_id')::uuid AND c.organization_id=(list_record->>'organization_id')::uuid;
  IF marketing IS NULL THEN RETURN NULL; END IF;
  subject_id:=(marketing->>'id')::uuid; contact:=marketing;
  normalized_email:=lower(trim(marketing->>'email'));
  IF nullif(normalized_email,'') IS NOT NULL THEN
    SELECT count(*)::integer,CASE WHEN count(*)=1 THEN jsonb_agg(to_jsonb(c))->0 ELSE NULL END INTO matches,payload
      FROM public.crm_clients c WHERE c.organization_id=(list_record->>'organization_id')::uuid
      AND lower(trim(c.email))=normalized_email;
    IF matches=1 THEN subject:='client'; contact:=payload; subject_id:=(payload->>'id')::uuid;
    ELSIF matches=0 THEN
      SELECT count(*)::integer,CASE WHEN count(*)=1 THEN jsonb_agg(to_jsonb(l))->0 ELSE NULL END INTO matches,payload
        FROM public.leads l WHERE l.organization_id=(list_record->>'organization_id')::uuid
        AND lower(trim(l.email))=normalized_email;
      IF matches=1 THEN
        IF (payload->>'automation_enabled')::boolean=false THEN RETURN NULL; END IF;
        subject:='lead'; contact:=payload; subject_id:=(payload->>'id')::uuid;
      END IF;
    END IF;
  END IF;
  payload:=contact || jsonb_build_object('id',subject_id,'list_id',membership->>'list_id',
    'list_name',list_record->>'name','marketing_contact_id',marketing->>'id',
    'list_membership_id',membership->>'id','list_event',event_name);
  secret:=public.automation_internal_secret();
  IF nullif(secret,'') IS NULL THEN RETURN NULL; END IF;
  FOR f IN SELECT id FROM public.automation_flows WHERE organization_id=(list_record->>'organization_id')::uuid
    AND status='active' AND trigger_type=event_name
    AND (nullif(trigger_config->>'list_id','') IS NULL OR trigger_config->>'list_id'=membership->>'list_id')
  LOOP
    PERFORM net.http_post(url:='https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/automation-engine',
      headers:=jsonb_build_object('Content-Type','application/json','x-automation-secret',secret),
      body:=jsonb_build_object('action','enroll','flow_id',f.id,'trigger_type',event_name,
        'organization_id',list_record->>'organization_id','subject_type',subject,'record',payload,
        'occurrence_key',(membership->>'id')||':'||event_name));
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_automation_list_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER capture_automation_list_event AFTER INSERT OR DELETE ON public.marketing_list_members
FOR EACH ROW EXECUTE FUNCTION public.capture_automation_list_event();
COMMIT;
