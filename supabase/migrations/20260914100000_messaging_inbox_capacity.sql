ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS max_inboxes integer;
UPDATE public.subscription_plans SET max_inboxes=4 WHERE id IN ('basic','starter','pro','elite');

CREATE OR REPLACE FUNCTION public.get_inbox_capacity(p_organization_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_plan text; v_override integer; v_exempt boolean; v_limit integer; v_used integer;
BEGIN
  IF NOT public.is_org_member(auth.uid(),p_organization_id) THEN RAISE EXCEPTION 'Sem acesso a esta organização' USING ERRCODE='42501'; END IF;
  SELECT plan,max_inboxes_override,coalesce(billing_exempt,false) INTO v_plan,v_override,v_exempt FROM organizations WHERE id=p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organização não encontrada' USING ERRCODE='P0002'; END IF;
  SELECT count(*) INTO v_used FROM messaging_channels WHERE organization_id=p_organization_id AND archived_at IS NULL;
  IF v_exempt THEN v_limit:=NULL; ELSIF v_override IS NOT NULL THEN v_limit:=v_override;
  ELSE SELECT max_inboxes INTO v_limit FROM subscription_plans WHERE id=coalesce(v_plan,'starter'); END IF;
  RETURN jsonb_build_object('used',v_used,'limit',v_limit,'remaining',CASE WHEN v_limit IS NULL THEN NULL ELSE greatest(v_limit-v_used,0) END,'can_create',v_limit IS NULL OR v_used<v_limit);
END $$;
REVOKE ALL ON FUNCTION public.get_inbox_capacity(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_inbox_capacity(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.enforce_inbox_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_plan text; v_override integer; v_exempt boolean; v_limit integer; v_used integer;
BEGIN
  IF NEW.archived_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.organization_id=NEW.organization_id AND OLD.archived_at IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text,0));
  SELECT plan,max_inboxes_override,coalesce(billing_exempt,false) INTO v_plan,v_override,v_exempt FROM organizations WHERE id=NEW.organization_id;
  IF v_exempt THEN RETURN NEW; END IF;
  SELECT max_inboxes INTO v_limit FROM subscription_plans WHERE id=coalesce(v_plan,'starter'); v_limit:=coalesce(v_override,v_limit);
  IF v_limit IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_used FROM messaging_channels WHERE organization_id=NEW.organization_id AND archived_at IS NULL;
  IF v_used>=v_limit THEN RAISE EXCEPTION 'INBOX_LIMIT_REACHED: Limite de % caixas atingido.',v_limit USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_inbox_limit() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_inbox_limit() TO service_role;
DROP TRIGGER IF EXISTS trg_enforce_inbox_limit ON public.messaging_channels;
CREATE TRIGGER trg_enforce_inbox_limit BEFORE INSERT OR UPDATE OF organization_id,archived_at ON public.messaging_channels FOR EACH ROW EXECUTE FUNCTION public.enforce_inbox_limit();
