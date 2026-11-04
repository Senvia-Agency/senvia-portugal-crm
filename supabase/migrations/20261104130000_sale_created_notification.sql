-- Venda criada: an optional push when a sale is created, next to the one for a closed sale.
--
-- Off unless the organization switches it on (Definições → Vendas, sales_settings.notify_sale_created = true),
-- so no organization gets a new push it did not ask for. Same recipients as the closed-sale push:
-- the active sales team and admins of the sale's organization.

CREATE OR REPLACE FUNCTION public.notify_sale_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_name text;
  v_seller_name text;
  v_body text;
  v_user_ids uuid[];
  v_value text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = NEW.organization_id
      AND o.sales_settings ->> 'notify_sale_created' = 'true'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(DISTINCT ur.user_id)
    INTO v_user_ids
  FROM public.user_roles ur
  JOIN public.organization_members om ON om.user_id = ur.user_id
  WHERE om.organization_id = NEW.organization_id
    AND om.is_active = true
    AND ur.role IN ('admin', 'super_admin', 'salesperson');

  IF v_user_ids IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(c.name, c.company, l.name, 'Cliente')
    INTO v_client_name
  FROM (SELECT NEW.client_id AS cid, NEW.lead_id AS lid) s
  LEFT JOIN public.crm_clients c ON c.id = s.cid
  LEFT JOIN public.leads l ON l.id = s.lid;

  SELECT split_part(p.full_name, ' ', 1)
    INTO v_seller_name
  FROM public.profiles p
  WHERE p.id = COALESCE(NEW.seller_id, NEW.created_by);

  v_value := replace(to_char(COALESCE(NEW.total_value, 0), 'FM999999990.00'), '.', ',');
  v_body := CASE WHEN v_seller_name IS NOT NULL AND v_seller_name <> ''
              THEN v_seller_name || ' criou: ' ELSE '' END
            || COALESCE(v_client_name, 'Cliente') || ' — ' || v_value || ' €';

  PERFORM net.http_post(
    url := 'https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/send-push-notification',
    body := jsonb_build_object(
      'organization_id', NEW.organization_id,
      'user_ids', to_jsonb(v_user_ids),
      'title', '🆕 Nova venda criada',
      'body', v_body,
      'url', '/sales',
      'tag', 'sale-created-' || NEW.id
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public.internal_service_key()
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_sale_created failed for sale %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_sale_created() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_sale_created ON public.sales;
CREATE TRIGGER trg_notify_sale_created
  AFTER INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_sale_created();
