BEGIN;
CREATE TABLE public.automation_meta_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id uuid,
  visit_key text NOT NULL CHECK(length(visit_key) BETWEEN 1 AND 500),
  channel_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  recipient text NOT NULL,
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','sent','uncertain','retryable')),
  claim_token uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_message_id text,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(run_id,organization_id) REFERENCES public.automation_runs(id,organization_id) ON DELETE SET NULL(run_id),
  UNIQUE(run_id,visit_key)
);
ALTER TABLE public.automation_meta_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_meta_deliveries FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.automation_meta_deliveries TO service_role;

CREATE FUNCTION public.claim_automation_meta_delivery(
  p_org_id uuid,p_run_id uuid,p_visit_key text,p_channel_id uuid,p_conversation_id uuid,p_recipient text,p_payload_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE delivery public.automation_meta_deliveries; decision text;
BEGIN
  IF length(coalesce(p_visit_key,'')) NOT BETWEEN 1 AND 500 OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid Meta delivery identity';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.automation_runs r WHERE r.id=p_run_id AND r.organization_id=p_org_id AND r.status='running')
    OR NOT EXISTS(SELECT 1 FROM public.meta_conversations c JOIN public.messaging_channels ch ON ch.id=c.channel_id AND ch.organization_id=c.organization_id
      WHERE c.id=p_conversation_id AND c.organization_id=p_org_id AND c.channel_id=p_channel_id AND c.contact_ref=p_recipient
      AND ch.channel_type='whatsapp' AND ch.provider<>'evolution' AND ch.archived_at IS NULL) THEN
    RAISE EXCEPTION 'Meta delivery run or conversation not found in organization' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.automation_meta_deliveries(organization_id,run_id,visit_key,channel_id,conversation_id,recipient,payload_hash)
    VALUES(p_org_id,p_run_id,p_visit_key,p_channel_id,p_conversation_id,p_recipient,p_payload_hash)
    ON CONFLICT(run_id,visit_key) DO NOTHING RETURNING * INTO delivery;
  IF FOUND THEN decision:='send';
  ELSE
    SELECT * INTO delivery FROM public.automation_meta_deliveries WHERE run_id=p_run_id AND visit_key=p_visit_key FOR UPDATE;
    IF delivery.organization_id<>p_org_id OR delivery.channel_id<>p_channel_id OR delivery.conversation_id<>p_conversation_id
      OR delivery.recipient<>p_recipient OR delivery.payload_hash<>p_payload_hash THEN
      RAISE EXCEPTION 'Meta delivery payload differs from its reserved identity' USING ERRCODE='42501';
    END IF;
    IF delivery.status='sent' THEN decision:='sent';
    ELSIF delivery.status='retryable' THEN
      UPDATE public.automation_meta_deliveries SET status='processing',claim_token=gen_random_uuid(),updated_at=now(),last_error=NULL
        WHERE id=delivery.id RETURNING * INTO delivery;
      decision:='send';
    ELSE decision:='blocked'; END IF;
  END IF;
  RETURN jsonb_build_object('decision',decision,'id',delivery.id,'claim_token',delivery.claim_token,'status',delivery.status,
    'provider_message_id',delivery.provider_message_id,'sent_at',delivery.sent_at);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_automation_meta_delivery(uuid,uuid,text,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_meta_delivery(uuid,uuid,text,uuid,uuid,text,text) TO service_role;

CREATE FUNCTION public.settle_automation_meta_delivery(p_id uuid,p_claim_token uuid,p_status text,p_message_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE delivery public.automation_meta_deliveries;
BEGIN
  IF p_status NOT IN ('sent','uncertain','retryable') THEN RAISE EXCEPTION 'Invalid Meta delivery outcome'; END IF;
  SELECT * INTO delivery FROM public.automation_meta_deliveries WHERE id=p_id AND claim_token=p_claim_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meta delivery claim not found'; END IF;
  IF delivery.status='sent' THEN RETURN jsonb_build_object('sent_at',delivery.sent_at); END IF;
  IF delivery.status<>'processing' THEN RAISE EXCEPTION 'Meta delivery claim already finalized'; END IF;
  IF p_status='sent' AND nullif(trim(p_message_id),'') IS NULL THEN RAISE EXCEPTION 'Provider message id required'; END IF;
  UPDATE public.automation_meta_deliveries SET status=p_status,provider_message_id=p_message_id,
    sent_at=CASE WHEN p_status='sent' THEN clock_timestamp() ELSE NULL END,
    last_error=CASE WHEN p_status='uncertain' THEN 'Resultado desconhecido; requer revisão manual' ELSE NULL END,updated_at=now()
    WHERE id=p_id RETURNING * INTO delivery;
  RETURN jsonb_build_object('sent_at',delivery.sent_at);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_automation_meta_delivery(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_automation_meta_delivery(uuid,uuid,text,text) TO service_role;
COMMIT;
