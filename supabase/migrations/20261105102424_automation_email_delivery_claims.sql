BEGIN;
CREATE TABLE public.automation_email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  automation_run_id uuid,
  automation_node_id text NOT NULL CHECK(nullif(trim(automation_node_id),'') IS NOT NULL),
  recipient_email text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','sent','failed_retryable','uncertain')),
  claim_token uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
  email_send_id uuid REFERENCES public.email_sends(id) ON DELETE SET NULL,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(automation_run_id,organization_id) REFERENCES public.automation_runs(id,organization_id) ON DELETE SET NULL (automation_run_id),
  UNIQUE(automation_run_id,automation_node_id)
);
ALTER TABLE public.automation_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_email_deliveries FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.automation_email_deliveries TO service_role;
CREATE UNIQUE INDEX email_sends_correlated_delivery_unique ON public.email_sends(automation_run_id,automation_node_id)
  WHERE automation_run_id IS NOT NULL AND automation_node_id IS NOT NULL AND status IN ('sent','delivered','opened','clicked','bounced','blocked','spam','unsubscribed');

CREATE FUNCTION public.claim_automation_email_delivery(p_organization_id uuid,p_run_id uuid,p_node_id text,p_recipient_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE delivery public.automation_email_deliveries; decision text;
BEGIN
  IF nullif(trim(p_node_id),'') IS NULL OR nullif(trim(p_recipient_email),'') IS NULL THEN
    RAISE EXCEPTION 'Email delivery correlation is incomplete';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.automation_runs WHERE id=p_run_id AND organization_id=p_organization_id AND status='running') THEN
    RAISE EXCEPTION 'Active automation run not found in organization' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.automation_email_deliveries(organization_id,automation_run_id,automation_node_id,recipient_email)
    VALUES(p_organization_id,p_run_id,p_node_id,lower(trim(p_recipient_email)))
    ON CONFLICT(automation_run_id,automation_node_id) DO NOTHING RETURNING * INTO delivery;
  IF FOUND THEN decision:='send';
  ELSE
    SELECT * INTO delivery FROM public.automation_email_deliveries
      WHERE automation_run_id=p_run_id AND automation_node_id=p_node_id FOR UPDATE;
    IF delivery.organization_id<>p_organization_id OR delivery.recipient_email<>lower(trim(p_recipient_email)) THEN
      RAISE EXCEPTION 'Email delivery identity differs from original claim' USING ERRCODE='42501';
    END IF;
    IF delivery.status='sent' THEN decision:='sent';
    ELSIF delivery.status='failed_retryable' THEN
      UPDATE public.automation_email_deliveries SET status='processing',claim_token=gen_random_uuid(),updated_at=now(),last_error=NULL
        WHERE id=delivery.id RETURNING * INTO delivery;
      decision:='send';
    ELSE decision:='blocked'; END IF;
  END IF;
  RETURN jsonb_build_object('decision',decision,'delivery_id',delivery.id,'claim_token',delivery.claim_token,
    'idempotency_key',delivery.idempotency_key,'email_send_id',delivery.email_send_id,'status',delivery.status);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_automation_email_delivery(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_email_delivery(uuid,uuid,text,text) TO service_role;

CREATE FUNCTION public.finalize_automation_email_delivery(p_delivery_id uuid,p_claim_token uuid,p_status text,p_email_send_id uuid DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE delivery public.automation_email_deliveries;
BEGIN
  IF p_status NOT IN ('sent','failed_retryable','uncertain') THEN RAISE EXCEPTION 'Invalid email delivery outcome'; END IF;
  SELECT * INTO delivery FROM public.automation_email_deliveries WHERE id=p_delivery_id AND claim_token=p_claim_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Email delivery claim not found'; END IF;
  IF delivery.status='sent' THEN RETURN; END IF;
  IF delivery.status<>'processing' THEN RAISE EXCEPTION 'Email delivery already finalized'; END IF;
  IF p_status='sent' AND NOT EXISTS(SELECT 1 FROM public.email_sends e WHERE e.id=p_email_send_id
    AND e.organization_id=delivery.organization_id AND e.automation_run_id=delivery.automation_run_id
    AND e.automation_node_id=delivery.automation_node_id AND lower(trim(e.recipient_email))=delivery.recipient_email
    AND e.status IN ('sent','delivered','opened','clicked','bounced','blocked','spam','unsubscribed')) THEN
    RAISE EXCEPTION 'Email delivery ledger not confirmed';
  END IF;
  UPDATE public.automation_email_deliveries SET status=p_status,email_send_id=p_email_send_id,last_error=p_error,updated_at=now()
    WHERE id=p_delivery_id;
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_automation_email_delivery(uuid,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_automation_email_delivery(uuid,uuid,text,uuid,text) TO service_role;
COMMIT;
