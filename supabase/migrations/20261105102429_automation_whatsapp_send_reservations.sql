BEGIN;
CREATE TABLE public.automation_whatsapp_send_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.messaging_channels(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.automation_runs(id) ON DELETE CASCADE,
  visit_key text NOT NULL CHECK (length(visit_key) BETWEEN 1 AND 500),
  slot_at timestamptz NOT NULL,
  released_at timestamptz,
  delivery_state text NOT NULL DEFAULT 'reserved' CHECK(delivery_state IN ('reserved','processing','sent','uncertain','retryable')),
  claim_token uuid,
  message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, channel_id, run_id, visit_key)
);
CREATE INDEX automation_whatsapp_reservations_channel_slot_idx
  ON public.automation_whatsapp_send_reservations(organization_id,channel_id,slot_at);
ALTER TABLE public.automation_whatsapp_send_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_whatsapp_send_reservations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.automation_whatsapp_send_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_automation_whatsapp_send(
  p_org_id uuid,p_channel_id uuid,p_run_id uuid,p_visit_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_res public.automation_whatsapp_send_reservations;
  v_now timestamptz;
  v_slot timestamptz;
  v_latest timestamptz;
  v_count integer;
  v_day date;
BEGIN
  IF length(coalesce(p_visit_key,'')) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Identificador de visita inválido';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_channel_id::text,0));
  IF NOT EXISTS(SELECT 1 FROM public.automation_runs r WHERE r.id=p_run_id
    AND r.organization_id=p_org_id AND r.status IN ('running','waiting','awaiting_reply'))
    OR NOT EXISTS(SELECT 1 FROM public.messaging_channels c WHERE c.id=p_channel_id
      AND c.organization_id=p_org_id AND c.channel_type='whatsapp' AND c.provider='evolution'
      AND c.status='connected' AND c.archived_at IS NULL AND c.evolution_instance IS NOT NULL
      AND c.metadata->>'native_inbox'='true') THEN
    RAISE EXCEPTION 'Percurso ou caixa de WhatsApp indisponível nesta organização';
  END IF;
  v_now:=clock_timestamp();
  SELECT * INTO v_res FROM public.automation_whatsapp_send_reservations
    WHERE organization_id=p_org_id AND channel_id=p_channel_id AND run_id=p_run_id AND visit_key=p_visit_key;
  IF FOUND THEN
    IF v_res.delivery_state='sent' THEN
      RETURN jsonb_build_object('ready',false,'replay_message_id',v_res.message_id,'reservation_id',v_res.id);
    END IF;
    IF v_res.delivery_state IN ('processing','uncertain') THEN
      RETURN jsonb_build_object('ready',false,'review_required',true,'reservation_id',v_res.id);
    END IF;
    IF v_res.slot_at>v_now THEN
      RETURN jsonb_build_object('ready',false,'wait_until',v_res.slot_at,'reservation_id',v_res.id);
    END IF;
    SELECT max(released_at) INTO v_latest FROM public.automation_whatsapp_send_reservations
      WHERE organization_id=p_org_id AND channel_id=p_channel_id;
  ELSE
    SELECT max(slot_at) INTO v_latest FROM public.automation_whatsapp_send_reservations
      WHERE organization_id=p_org_id AND channel_id=p_channel_id;
  END IF;
  v_slot:=greatest(v_now,v_latest+interval '6 seconds');
  LOOP
    v_day:=(v_slot AT TIME ZONE 'Europe/Lisbon')::date;
    SELECT count(*) INTO v_count FROM public.automation_whatsapp_send_reservations
      WHERE organization_id=p_org_id AND channel_id=p_channel_id
        AND slot_at >= (v_day::timestamp AT TIME ZONE 'Europe/Lisbon')
        AND slot_at < ((v_day+1)::timestamp AT TIME ZONE 'Europe/Lisbon')
        AND id IS DISTINCT FROM v_res.id;
    EXIT WHEN v_count<200;
    v_slot:=((v_day+1)::timestamp+interval '9 hours') AT TIME ZONE 'Europe/Lisbon';
  END LOOP;
  IF v_res.id IS NULL THEN
    INSERT INTO public.automation_whatsapp_send_reservations(organization_id,channel_id,run_id,visit_key,slot_at,released_at)
      VALUES(p_org_id,p_channel_id,p_run_id,p_visit_key,v_slot,CASE WHEN v_slot<=v_now THEN v_now END)
      RETURNING * INTO v_res;
  ELSE
    UPDATE public.automation_whatsapp_send_reservations
      SET slot_at=v_slot,released_at=CASE WHEN v_slot<=v_now THEN v_now END WHERE id=v_res.id RETURNING * INTO v_res;
  END IF;
  IF v_res.released_at IS NOT NULL THEN
    UPDATE public.automation_whatsapp_send_reservations SET delivery_state='processing',claim_token=gen_random_uuid()
      WHERE id=v_res.id RETURNING * INTO v_res;
  END IF;
  RETURN jsonb_build_object('ready',v_res.delivery_state='processing','claim_token',v_res.claim_token,'wait_until',
    CASE WHEN v_res.released_at IS NULL THEN v_res.slot_at END,'reservation_id',v_res.id);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_automation_whatsapp_send(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_automation_whatsapp_send(uuid,uuid,uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.finalize_automation_whatsapp_send(
  p_org_id uuid,p_channel_id uuid,p_run_id uuid,p_visit_key text,p_claim_token uuid,p_state text,p_message_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_res public.automation_whatsapp_send_reservations;
BEGIN
  IF p_state NOT IN ('sent','uncertain','retryable') OR (p_state='sent' AND length(trim(coalesce(p_message_id,'')))=0) THEN
    RAISE EXCEPTION 'Resultado de envio inválido';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_channel_id::text,0));
  IF NOT EXISTS(SELECT 1 FROM public.automation_runs WHERE id=p_run_id AND organization_id=p_org_id)
    OR NOT EXISTS(SELECT 1 FROM public.messaging_channels WHERE id=p_channel_id AND organization_id=p_org_id) THEN
    RAISE EXCEPTION 'Percurso ou caixa indisponível nesta organização';
  END IF;
  SELECT * INTO v_res FROM public.automation_whatsapp_send_reservations WHERE organization_id=p_org_id
    AND channel_id=p_channel_id AND run_id=p_run_id AND visit_key=p_visit_key FOR UPDATE;
  IF NOT FOUND OR p_claim_token IS NULL OR v_res.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'Autorização de envio inválida';
  END IF;
  IF v_res.delivery_state=p_state AND v_res.message_id IS NOT DISTINCT FROM p_message_id THEN
    RETURN jsonb_build_object('saved',true);
  END IF;
  IF v_res.delivery_state<>'processing' THEN RAISE EXCEPTION 'Resultado de envio já encerrado'; END IF;
  UPDATE public.automation_whatsapp_send_reservations SET delivery_state=p_state,message_id=p_message_id WHERE id=v_res.id;
  RETURN jsonb_build_object('saved',true);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_automation_whatsapp_send(uuid,uuid,uuid,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_automation_whatsapp_send(uuid,uuid,uuid,text,uuid,text,text) TO service_role;
COMMIT;
