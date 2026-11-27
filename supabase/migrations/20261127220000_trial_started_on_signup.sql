-- Boas-vindas do trial (trial_started) no momento em que o trial começa (Thiago, 27/11/2026).
--
-- Antes: handle_new_user e create_organization_for_current_user já tentavam disparar o
-- trial_started no registo, mas com o bearer internal_service_key(), que a process-automation
-- recusa (401, engolido em silêncio). A boas-vindas só saía às 08:00 do dia seguinte, pelo cron
-- check-trial-status. Agora as duas usam dispatch_trial_started: o segredo interno
-- (x-automation-secret, o mesmo dos crons), o mesmo payload do check-trial-status e a mesma
-- elegibilidade, e marca trial_reminders_sent.automation_started para o cron não a reenviar.
-- Só o fluxo "Trial Ativado" (automation_flows) envia; o template homónimo está desligado.

CREATE OR REPLACE FUNCTION public.dispatch_trial_started(_org_id uuid, _email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _senvia_org_id uuid := '06fe9e1d-9670-45b0-8717-c5a6e90be380';
  _org record;
BEGIN
  IF _org_id IS NULL OR NULLIF(btrim(coalesce(_email, '')), '') IS NULL THEN
    RETURN false;
  END IF;

  SELECT id, name, contact_phone, trial_ends_at, plan, billing_exempt, wa_nudge_optout, trial_reminders_sent
  INTO _org FROM public.organizations WHERE id = _org_id FOR UPDATE;

  -- Mesma elegibilidade do check-trial-status (daysLeft >= 12 equivale a faltarem mais de 11 dias).
  IF NOT FOUND
     OR _org.trial_ends_at IS NULL
     OR coalesce(_org.billing_exempt, false)
     OR coalesce(_org.wa_nudge_optout, false)
     OR (_org.plan IS NOT NULL AND _org.plan <> 'basic')
     OR _org.trial_ends_at <= now() + interval '11 days'
     OR coalesce((_org.trial_reminders_sent ->> 'automation_started')::boolean, false)
  THEN
    RETURN false;
  END IF;

  PERFORM net.http_post(
    url := 'https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/process-automation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-secret', public.automation_internal_secret()
    ),
    body := jsonb_build_object(
      'trigger_type', 'trial_started',
      'organization_id', _senvia_org_id,
      'record', jsonb_build_object(
        'email', _email, 'nome', _org.name, 'empresa', _org.name,
        'telefone', coalesce(_org.contact_phone, '')
      )
    )
  );

  UPDATE public.organizations
  SET trial_reminders_sent = coalesce(trial_reminders_sent, '{}'::jsonb) || '{"automation_started": true}'::jsonb
  WHERE id = _org_id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.dispatch_trial_started(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org_name text := NULLIF(btrim(NEW.raw_user_meta_data->>'organization_name'), '');
  _org_slug text := NULLIF(btrim(NEW.raw_user_meta_data->>'organization_slug'), '');
  _contact_phone text := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'contact_phone', '')), '');
  _senvia_org_id uuid := '06fe9e1d-9670-45b0-8717-c5a6e90be380';
  _org_id uuid;
  _contact_id uuid;
  _trial_list_id uuid;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Utilizador'),
    NEW.email
  );

  -- No company details => invite flow or an admin-created user. Nothing to do.
  IF _org_name IS NULL OR _org_slug IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = _org_slug) THEN
    RAISE EXCEPTION 'Slug already exists: %', _org_slug USING ERRCODE = 'unique_violation';
  END IF;

  -- Um registo repetido do mesmo telefone dentro de 24h e quase sempre a mesma
  -- pessoa a tentar outra vez (tipicamente um typo no email na primeira). Sem
  -- isto fica uma organizacao orfa permanente e um lead a mais.
  IF _contact_phone IS NOT NULL
     AND length(regexp_replace(_contact_phone, '\D', '', 'g')) >= 9
     AND EXISTS (
       SELECT 1 FROM public.organizations o
       WHERE o.created_at > now() - interval '24 hours'
         AND o.contact_phone IS NOT NULL
         AND right(regexp_replace(o.contact_phone, '\D', '', 'g'), 9)
             = right(regexp_replace(_contact_phone, '\D', '', 'g'), 9)
     )
  THEN
    RAISE EXCEPTION 'Recent signup exists for this phone' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO public.organizations (name, slug, contact_phone)
  VALUES (_org_name, _org_slug, _contact_phone)
  RETURNING id INTO _org_id;

  PERFORM set_config('app.bypass_profile_org_lock', 'true', true);
  UPDATE public.profiles
  SET organization_id = _org_id
  WHERE id = NEW.id;

  -- Whoever creates the account is always the admin of its organization.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.organization_members (user_id, organization_id, role)
  VALUES (NEW.id, _org_id, 'admin')
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  -- Everything below is Senvia-side marketing bookkeeping. It must never be
  -- able to abort a signup, so each part swallows its own errors.
  BEGIN
    PERFORM ensure_stripe_auto_lists(_senvia_org_id);

    INSERT INTO public.marketing_contacts (organization_id, email, name, source, subscribed)
    VALUES (_senvia_org_id, NEW.email, _org_name, 'trial', true)
    ON CONFLICT (organization_id, email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO _contact_id;

    SELECT id INTO _trial_list_id
    FROM public.client_lists
    WHERE organization_id = _senvia_org_id AND name = 'Clientes em Trial' AND is_system = true
    LIMIT 1;

    IF _trial_list_id IS NOT NULL AND _contact_id IS NOT NULL THEN
      INSERT INTO public.marketing_list_members (list_id, contact_id)
      VALUES (_trial_list_id, _contact_id)
      ON CONFLICT (list_id, contact_id) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- O lead do trial NAO e criado aqui: quem o cria e a edge function
  -- notify-new-trials (source = Trial SENVIA OS), idempotente via
  -- organizations.trial_notified_at. Os dois caminhos duplicavam o lead.

  -- Boas-vindas do trial logo no registo (antes só saíam às 08:00 do dia seguinte).
  BEGIN
    PERFORM public.dispatch_trial_started(_org_id, NEW.email);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_organization_for_current_user(_name text, _slug text, _contact_phone text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org_id uuid;
  _user_id uuid;
  _user_email text;
  _senvia_org_id uuid := '06fe9e1d-9670-45b0-8717-c5a6e90be380';
  _contact_id uuid;
  _trial_list_id uuid;
BEGIN
  _user_id := auth.uid();

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND organization_id IS NOT NULL) THEN
    RAISE EXCEPTION 'User already belongs to an organization';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = _slug) THEN
    RAISE EXCEPTION 'Slug already exists';
  END IF;

  INSERT INTO public.organizations (name, slug, contact_phone)
  VALUES (_name, _slug, _contact_phone)
  RETURNING id INTO _org_id;

  PERFORM set_config('app.bypass_profile_org_lock', 'true', true);
  UPDATE public.profiles
  SET organization_id = _org_id
  WHERE id = _user_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.organization_members (user_id, organization_id, role)
  VALUES (_user_id, _org_id, 'admin')
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  SELECT email INTO _user_email FROM auth.users WHERE id = _user_id;

  IF _user_email IS NOT NULL THEN
    PERFORM ensure_stripe_auto_lists(_senvia_org_id);

    INSERT INTO public.marketing_contacts (organization_id, email, name, source, subscribed)
    VALUES (_senvia_org_id, _user_email, _name, 'trial', true)
    ON CONFLICT (organization_id, email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO _contact_id;

    SELECT id INTO _trial_list_id FROM public.client_lists
    WHERE organization_id = _senvia_org_id AND name = 'Clientes em Trial' AND is_system = true
    LIMIT 1;

    IF _trial_list_id IS NOT NULL AND _contact_id IS NOT NULL THEN
      INSERT INTO public.marketing_list_members (list_id, contact_id)
      VALUES (_trial_list_id, _contact_id)
      ON CONFLICT (list_id, contact_id) DO NOTHING;
    END IF;

    -- O lead do trial NÃO é criado aqui — ver cabeçalho.

    -- Boas-vindas do trial logo no registo (antes só saíam às 08:00 do dia seguinte).
    BEGIN
      PERFORM public.dispatch_trial_started(_org_id, _user_email);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN _org_id;
END;
$function$;
