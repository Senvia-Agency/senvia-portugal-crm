CREATE OR REPLACE FUNCTION public.automation_convert_lead(p_org_id uuid, p_lead_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lead_record public.leads%ROWTYPE;
  client_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  SELECT * INTO lead_record FROM public.leads WHERE id = p_lead_id AND organization_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead not found in organization'; END IF;
  SELECT id INTO client_id FROM public.crm_clients WHERE lead_id = p_lead_id AND organization_id = p_org_id ORDER BY created_at, id LIMIT 1;
  IF client_id IS NOT NULL THEN RETURN client_id; END IF;
  INSERT INTO public.crm_clients (organization_id, lead_id, name, email, phone, company, company_nif, notes, source, status, assigned_to)
    VALUES (p_org_id, p_lead_id, lead_record.name, lead_record.email, lead_record.phone,
      lead_record.company_name, lead_record.company_nif, lead_record.notes, 'lead', 'active', lead_record.assigned_to)
    RETURNING id INTO client_id;
  IF p_org_id = '96a3950e-31be-4c6d-abed-b82968c0d7e9'::uuid
    AND nullif(lead_record.custom_data->>'cpe', '') IS NOT NULL THEN
    INSERT INTO public.cpes (client_id, organization_id, equipment_type, serial_number, comercializador, status)
      VALUES (client_id, p_org_id, 'Energia', lead_record.custom_data->>'cpe', '', 'active');
  END IF;
  RETURN client_id;
END;
$$;
REVOKE ALL ON FUNCTION public.automation_convert_lead(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_convert_lead(uuid,uuid) TO service_role;
