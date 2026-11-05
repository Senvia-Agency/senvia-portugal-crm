BEGIN;
CREATE OR REPLACE FUNCTION public.capture_automation_financial_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_row jsonb:=to_jsonb(NEW); old_row jsonb; event_name text; sale public.sales%ROWTYPE; contact jsonb; payload jsonb;
BEGIN
  IF TG_OP='UPDATE' THEN old_row:=to_jsonb(OLD); END IF;
  IF TG_TABLE_NAME='sale_payments' THEN
    IF current_row->>'status'<>'paid' OR (TG_OP='UPDATE' AND old_row->>'status'='paid') THEN RETURN NEW; END IF;
    event_name:='payment_recorded';
  ELSE
    IF NOT(current_row->>'status' IN ('final','issued') AND coalesce(current_row->>'processing_status','issued')='issued') THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND old_row->>'status' IN ('final','issued') AND coalesce(old_row->>'processing_status','issued')='issued' THEN RETURN NEW; END IF;
    event_name:='fiscal_document_issued';
  END IF;
  SELECT * INTO sale FROM public.sales WHERE id=nullif(current_row->>'sale_id','')::uuid
    AND organization_id=nullif(current_row->>'organization_id','')::uuid;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF sale.client_id IS NOT NULL THEN SELECT to_jsonb(c) INTO contact FROM public.crm_clients c WHERE c.id=sale.client_id AND c.organization_id=sale.organization_id;
  ELSIF sale.lead_id IS NOT NULL THEN SELECT to_jsonb(l) INTO contact FROM public.leads l WHERE l.id=sale.lead_id AND l.organization_id=sale.organization_id AND l.automation_enabled IS DISTINCT FROM false;
  END IF;
  payload:=to_jsonb(sale)||jsonb_build_object('name',contact->>'name','email',contact->>'email','phone',contact->>'phone');
  IF TG_TABLE_NAME='sale_payments' THEN
    payload:=payload||jsonb_build_object('payment_id',NEW.id,'payment_amount',current_row->'amount','payment_date',current_row->'payment_date','payment_method',current_row->'payment_method');
  ELSE
    payload:=payload||jsonb_build_object('invoice_id',NEW.id,'document_type',current_row->'document_type','document_reference',current_row->'reference','document_total',current_row->'total');
  END IF;
  PERFORM public.dispatch_automation_record_event(event_name,sale.organization_id,'sale',payload,NULL,NEW.id::text||':'||event_name);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_automation_financial_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER capture_automation_payment_recorded AFTER INSERT OR UPDATE ON public.sale_payments
  FOR EACH ROW EXECUTE FUNCTION public.capture_automation_financial_event();
CREATE TRIGGER capture_automation_fiscal_document_issued AFTER INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.capture_automation_financial_event();
COMMIT;
