-- Venda fechada: the push now says WHO closed it, and each organization can switch it off.
--
-- Same trigger as before (20260703120000): once, on the transition INTO 'delivered'
-- ("Concluída"), a push to the active sales team and admins of the sale's organization.
-- New: the body names the salesperson ("Dan fechou: Cliente X — 1200,00 €") and the
-- organization setting sales_settings.notify_sale_closed (default on) is respected.

CREATE OR REPLACE FUNCTION public.notify_sale_concluded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_name text;
  v_seller_name text;
  v_body text;
  v_title text;
  v_user_ids uuid[];
  v_value text;
  v_titles text[] := ARRAY[
    '🔥 Bateu mais uma! 💰',
    '🚀 Mais uma venda fechada! Bora pra próxima!',
    '🎉 Fechou! Rumo à meta! 🎯',
    '💪 É disso que a gente gosta!',
    '🏆 Mais um cliente conquistado!',
    '⚡ Contrato assinado! Vamos pra cima!',
    '🤑 Dinheiro entrando! Mais uma!',
    '💥 BOOM! Mais uma no placar!',
    '🌟 Time imparável! Mais uma venda!',
    '🔥 Tá voando! Mais uma fechada!'
  ];
BEGIN
  IF (NEW.status IS DISTINCT FROM 'delivered')
     OR (OLD.status IS NOT DISTINCT FROM 'delivered') THEN
    RETURN NEW;
  END IF;

  -- The organization can turn this off (Definições → Vendas). Off only when explicitly false.
  IF EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = NEW.organization_id
      AND o.sales_settings ->> 'notify_sale_closed' = 'false'
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

  -- Who closed it: the sale's salesperson, else whoever created it.
  SELECT split_part(p.full_name, ' ', 1)
    INTO v_seller_name
  FROM public.profiles p
  WHERE p.id = COALESCE(NEW.seller_id, NEW.created_by);

  v_value := replace(to_char(COALESCE(NEW.total_value, 0), 'FM999999990.00'), '.', ',');
  v_title := v_titles[1 + floor(random() * array_length(v_titles, 1))::int];
  v_body := CASE WHEN v_seller_name IS NOT NULL AND v_seller_name <> ''
              THEN v_seller_name || ' fechou: ' ELSE '' END
            || COALESCE(v_client_name, 'Cliente') || ' — ' || v_value || ' €';

  PERFORM net.http_post(
    url := 'https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/send-push-notification',
    body := jsonb_build_object(
      'organization_id', NEW.organization_id,
      'user_ids', to_jsonb(v_user_ids),
      'title', v_title,
      'body', v_body,
      'url', '/sales',
      'tag', 'sale-closed-' || NEW.id
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public.internal_service_key()
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_sale_concluded failed for sale %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;
