BEGIN;
CREATE TABLE public.automation_financial_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.automation_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  sale_id uuid NOT NULL REFERENCES public.sales(id),
  kind text NOT NULL CHECK(kind IN ('issue_invoice','issue_receipt','change_sale_status','mark_billing_disputed','suspend_recurring_service')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  task_id uuid REFERENCES public.inbox_tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,node_id,kind)
);
ALTER TABLE public.automation_financial_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read automation financial requests" ON public.automation_financial_requests FOR SELECT TO authenticated
  USING(public.is_org_member(auth.uid(),organization_id));
REVOKE ALL ON public.automation_financial_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.automation_financial_requests TO authenticated;
GRANT ALL ON public.automation_financial_requests TO service_role;

CREATE OR REPLACE FUNCTION public.automation_request_financial_action(p_run_id uuid,p_node_id text,p_kind text,p_details jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.automation_runs%ROWTYPE; owner_id uuid; request_id uuid; target_sale uuid; task uuid; title text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF nullif(trim(p_node_id),'') IS NULL OR nullif(trim(p_details->>'reason'),'') IS NULL THEN RAISE EXCEPTION 'node and reason required'; END IF;
  SELECT * INTO r FROM public.automation_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR r.status<>'running' THEN RAISE EXCEPTION 'active run required'; END IF;
  IF r.context ? '__action_target' THEN
    IF r.context->'__action_target'->>'type' IS DISTINCT FROM 'sale' THEN RAISE EXCEPTION 'sale action target required'; END IF;
    target_sale:=(r.context->'__action_target'->>'id')::uuid;
  ELSIF r.subject_type='sale' THEN
    target_sale:=r.subject_id;
  END IF;
  IF target_sale IS NULL THEN RAISE EXCEPTION 'sale action target required'; END IF;
  PERFORM 1 FROM public.sales WHERE id=target_sale AND organization_id=r.organization_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale outside organization'; END IF;
  SELECT id INTO request_id FROM public.automation_financial_requests WHERE run_id=p_run_id AND node_id=p_node_id AND kind=p_kind;
  IF request_id IS NOT NULL THEN RETURN request_id; END IF;
  title:=CASE p_kind WHEN 'issue_invoice' THEN 'Rever pedido de emissão de fatura' WHEN 'issue_receipt' THEN 'Rever pedido de emissão de recibo'
    WHEN 'change_sale_status' THEN 'Rever alteração de estado da venda' WHEN 'mark_billing_disputed' THEN 'Rever pedido de contencioso'
    WHEN 'suspend_recurring_service' THEN 'Rever pedido de suspensão de serviço' ELSE NULL END;
  IF title IS NULL THEN RAISE EXCEPTION 'unsupported financial request'; END IF;
  SELECT f.created_by INTO owner_id FROM public.automation_flows f JOIN public.organization_members m
    ON m.organization_id=f.organization_id AND m.user_id=f.created_by AND m.is_active
    WHERE f.id=r.flow_id AND f.organization_id=r.organization_id;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'automation owner must be an active organization member'; END IF;
  INSERT INTO public.inbox_tasks(organization_id,title,description,due_at,assigned_to,contact_name,contact_phone,lead_id,client_id,automation_origin_run_id)
  VALUES(r.organization_id,title,p_details->>'reason'||E'\nVenda: '||target_sale::text||E'\nAbra /financeiro/faturas ou a ficha da venda. A emissão exige autorização e MFA; este pedido não emite documentos.',
    now()+interval '1 day',owner_id,r.contact_name,r.contact_phone,NULL,NULL,r.id) RETURNING id INTO task;
  INSERT INTO public.automation_financial_requests(organization_id,run_id,node_id,sale_id,kind,details,task_id)
    VALUES(r.organization_id,r.id,p_node_id,target_sale,p_kind,p_details,task) RETURNING id INTO request_id;
  RETURN request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.automation_request_financial_action(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_request_financial_action(uuid,text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.automation_create_pending_sale(p_organization_id uuid,p_proposal_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.proposals%ROWTYPE; sale uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  SELECT * INTO p FROM public.proposals WHERE id=p_proposal_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR p.status<>'accepted' THEN RAISE EXCEPTION 'accepted proposal required in this organization'; END IF;
  SELECT id INTO sale FROM public.sales WHERE proposal_id=p.id AND organization_id=p.organization_id ORDER BY created_at,id LIMIT 1;
  IF sale IS NOT NULL THEN RETURN sale; END IF;
  IF p.client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.crm_clients WHERE id=p.client_id AND organization_id=p.organization_id) THEN RAISE EXCEPTION 'client outside organization'; END IF;
  IF p.lead_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.leads WHERE id=p.lead_id AND organization_id=p.organization_id) THEN RAISE EXCEPTION 'lead outside organization'; END IF;
  IF EXISTS(SELECT 1 FROM public.proposal_products pp LEFT JOIN public.products product ON product.id=pp.product_id AND product.organization_id=p.organization_id WHERE pp.proposal_id=p.id AND product.id IS NULL) THEN RAISE EXCEPTION 'product outside organization'; END IF;
  IF p.total_value IS NULL OR p.total_value<0 THEN RAISE EXCEPTION 'invalid proposal total'; END IF;
  INSERT INTO public.sales(organization_id,proposal_id,client_id,lead_id,total_value,subtotal,status,payment_status,sale_date,notes,created_by,
    proposal_type,negotiation_type,consumo_anual,margem,dbl,anos_contrato,modelo_servico,kwp,servicos_produtos,servicos_details)
  VALUES(p.organization_id,p.id,p.client_id,p.lead_id,p.total_value,p.total_value,'pending','pending',current_date,p.notes,p.created_by,
    p.proposal_type,p.negotiation_type,p.consumo_anual,p.margem,p.dbl,p.anos_contrato,p.modelo_servico,p.kwp,p.servicos_produtos,p.servicos_details) RETURNING id INTO sale;
  INSERT INTO public.sale_items(sale_id,product_id,name,quantity,unit_price,total)
    SELECT sale,pp.product_id,product.name,pp.quantity,pp.unit_price,pp.total FROM public.proposal_products pp
    JOIN public.products product ON product.id=pp.product_id AND product.organization_id=p.organization_id WHERE pp.proposal_id=p.id;
  RETURN sale;
END;
$$;
REVOKE ALL ON FUNCTION public.automation_create_pending_sale(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_create_pending_sale(uuid,uuid) TO service_role;
COMMIT;
