BEGIN;
CREATE TABLE public.automation_reply_drafts (
  run_id uuid NOT NULL REFERENCES public.automation_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.inbox_tasks(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, node_id)
);
ALTER TABLE public.automation_reply_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_reply_drafts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.automation_reply_drafts TO service_role;

CREATE OR REPLACE FUNCTION public.create_automation_reply_draft(
  p_run_id uuid, p_node_id text, p_organization_id uuid,
  p_reply text, p_confidence numeric, p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  selected_run public.automation_runs%ROWTYPE;
  existing_task uuid;
  task_id uuid;
  owner_id uuid;
BEGIN
  IF p_reply IS NULL OR length(trim(p_reply)) NOT BETWEEN 1 AND 2000
    OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 1 AND 500
    OR p_confidence IS NULL OR p_confidence NOT BETWEEN 0 AND 1
    OR p_node_id IS NULL OR length(p_node_id) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Rascunho inválido';
  END IF;
  SELECT * INTO selected_run FROM public.automation_runs
  WHERE id=p_run_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Percurso não encontrado'; END IF;
  SELECT d.task_id INTO existing_task FROM public.automation_reply_drafts d
  WHERE d.run_id=p_run_id AND d.node_id=p_node_id;
  IF existing_task IS NOT NULL THEN RETURN existing_task; END IF;
  IF selected_run.status <> 'running' THEN RAISE EXCEPTION 'Percurso não está em execução'; END IF;
  SELECT f.created_by INTO owner_id FROM public.automation_flows f
  JOIN public.organization_members m ON m.organization_id=f.organization_id AND m.user_id=f.created_by AND m.is_active
  WHERE f.id=selected_run.flow_id AND f.organization_id=p_organization_id;
  INSERT INTO public.inbox_tasks(organization_id,title,description,due_at,assigned_to,contact_name,contact_phone,automation_origin_run_id)
  VALUES(p_organization_id,'Rever resposta sugerida pelo Otto',
    'Rascunho para revisão humana. Reveja e envie manualmente na conversa.' || E'\n\n' || trim(p_reply) || E'\n\nO que confirmar: ' || trim(p_reason),
    now()+interval '1 day',owner_id,selected_run.contact_name,selected_run.contact_phone,p_run_id)
  RETURNING id INTO task_id;
  INSERT INTO public.automation_reply_drafts(run_id,node_id,organization_id,task_id)
  VALUES(p_run_id,p_node_id,p_organization_id,task_id);
  RETURN task_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_automation_reply_draft(uuid,text,uuid,text,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_automation_reply_draft(uuid,text,uuid,text,numeric,text) TO service_role;
COMMIT;
