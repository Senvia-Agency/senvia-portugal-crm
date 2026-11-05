BEGIN;
CREATE TABLE public.organization_feed_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text CHECK(title IS NULL OR char_length(title)<=120),
  body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 4000 AND length(trim(body))>0),
  source_flow_id uuid REFERENCES public.automation_flows(id) ON DELETE SET NULL,
  source_run_id uuid REFERENCES public.automation_runs(id) ON DELETE SET NULL,
  source_node_id text NOT NULL CHECK(char_length(source_node_id) BETWEEN 1 AND 500),
  source_flow_name text NOT NULL,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_run_id,source_node_id)
);
CREATE INDEX organization_feed_posts_org_created_idx ON public.organization_feed_posts(organization_id,created_at DESC);
ALTER TABLE public.organization_feed_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_feed_posts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.organization_feed_posts TO authenticated;
GRANT ALL ON public.organization_feed_posts TO service_role;
CREATE POLICY "Active members read organization feed" ON public.organization_feed_posts
  FOR SELECT TO authenticated USING(public.is_org_member((SELECT auth.uid()),organization_id));

CREATE OR REPLACE FUNCTION public.publish_automation_feed_post(
  p_org_id uuid,p_run_id uuid,p_node_id text,p_title text,p_body text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_run public.automation_runs;
  v_flow public.automation_flows;
  v_author uuid;
  v_post uuid;
BEGIN
  IF char_length(coalesce(p_node_id,'')) NOT BETWEEN 1 AND 500
    OR char_length(coalesce(trim(p_body),'')) NOT BETWEEN 1 AND 4000
    OR char_length(coalesce(trim(p_title),''))>120 THEN
    RAISE EXCEPTION 'Use um passo válido, título até 120 caracteres e mensagem de 1 a 4000 caracteres';
  END IF;
  SELECT * INTO v_run FROM public.automation_runs WHERE id=p_run_id AND organization_id=p_org_id FOR UPDATE;
  IF NOT FOUND OR v_run.status NOT IN ('running','waiting','awaiting_reply') THEN
    RAISE EXCEPTION 'Percurso ativo não encontrado nesta organização';
  END IF;
  SELECT * INTO v_flow FROM public.automation_flows WHERE id=v_run.flow_id AND organization_id=p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Automação não encontrada nesta organização'; END IF;
  IF EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=p_org_id
      AND user_id=v_flow.created_by AND is_active=true) THEN v_author:=v_flow.created_by; END IF;
  INSERT INTO public.organization_feed_posts(organization_id,title,body,source_flow_id,source_run_id,source_node_id,source_flow_name,author_id)
    VALUES(p_org_id,nullif(trim(p_title),''),trim(p_body),v_flow.id,v_run.id,p_node_id,v_flow.name,v_author)
    ON CONFLICT(source_run_id,source_node_id) DO NOTHING RETURNING id INTO v_post;
  IF v_post IS NULL THEN
    SELECT id INTO v_post FROM public.organization_feed_posts WHERE source_run_id=p_run_id AND source_node_id=p_node_id AND organization_id=p_org_id;
  END IF;
  RETURN jsonb_build_object('post_id',v_post);
END;
$$;
REVOKE ALL ON FUNCTION public.publish_automation_feed_post(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_automation_feed_post(uuid,uuid,text,text,text) TO service_role;
COMMIT;
