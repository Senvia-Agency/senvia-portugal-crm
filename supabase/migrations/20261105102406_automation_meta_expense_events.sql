BEGIN;
ALTER TABLE public.automation_runs DROP CONSTRAINT IF EXISTS automation_runs_subject_type_check;
ALTER TABLE public.automation_runs ADD CONSTRAINT automation_runs_subject_type_check
  CHECK (subject_type IN ('lead','client','sale','proposal','contact','organization','financial_request'));
CREATE TABLE public.automation_meta_events (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pixel_id text NOT NULL,event_name text NOT NULL,event_id text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','sent','failed')),
  lease_until timestamptz NOT NULL DEFAULT now()+interval '1 minute',updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,pixel_id,event_name,event_id)
);
ALTER TABLE public.automation_meta_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_meta_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.automation_meta_events TO service_role;
CREATE OR REPLACE FUNCTION public.claim_automation_meta_event(p_organization_id uuid,p_pixel_id text,p_event_name text,p_event_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE claimed boolean;
BEGIN
  INSERT INTO public.automation_meta_events(organization_id,pixel_id,event_name,event_id)
  VALUES(p_organization_id,p_pixel_id,p_event_name,p_event_id)
  ON CONFLICT(organization_id,pixel_id,event_name,event_id) DO UPDATE SET status='processing',lease_until=now()+interval '1 minute',updated_at=now()
  WHERE automation_meta_events.status='failed' OR (automation_meta_events.status='processing' AND automation_meta_events.lease_until<now())
  RETURNING true INTO claimed;
  RETURN coalesce(claimed,false);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_automation_meta_event(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_meta_event(uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.capture_automation_financial_request_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE contact jsonb; payload jsonb; kind text;
BEGIN
  IF NEW.request_type NOT IN ('expense','invoice') THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.organization_members WHERE organization_id=NEW.organization_id AND user_id=NEW.submitted_by AND is_active;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.status<>'pending' OR (TG_OP='UPDATE' AND OLD.status='pending') THEN RETURN NEW; END IF;
  kind:=CASE WHEN NEW.request_type='expense' THEN 'expense_approval_requested' ELSE 'financial_request_created' END;
  SELECT to_jsonb(p) INTO contact FROM public.profiles p WHERE p.id=NEW.submitted_by;
  payload:=jsonb_build_object('id',NEW.id,'name',coalesce(contact->>'full_name',contact->>'display_name'),'email',contact->>'email',
    'financial_request_id',NEW.id,'request_type',NEW.request_type,'request_title',NEW.title,'request_amount',NEW.amount,'request_status',NEW.status,'submitted_by',NEW.submitted_by,
    'request_review_url','/financeiro/pedidos');
  PERFORM public.dispatch_automation_record_event(kind,NEW.organization_id,'financial_request',payload,NULL,NEW.id::text||':'||kind);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_automation_financial_request_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER capture_automation_financial_request_event AFTER INSERT OR UPDATE ON public.internal_requests
FOR EACH ROW EXECUTE FUNCTION public.capture_automation_financial_request_event();
COMMIT;
