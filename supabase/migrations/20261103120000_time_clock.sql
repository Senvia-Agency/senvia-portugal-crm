-- Ponto (time clock), modelled on Realize without GPS/NFC.
--
-- The day is four actions: start (Iniciar dia), pause (Pausa), resume (Retomar),
-- stop (Terminar dia). Nobody writes the tables directly: every change goes
-- through the functions below, and every change lands in an append-only history.
-- Work schedules drive the push reminders ("Já registou a entrada?").
--
-- Run in the Supabase SQL Editor. Then deploy the edge function time-clock-reminders.

BEGIN;

-- 1. Tables ------------------------------------------------------------------------------

CREATE TABLE public.time_clock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- No FK to auth.users: a timesheet is a legal record and outlives the account.
  user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('start', 'pause', 'resume', 'stop')),
  punched_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'admin')),
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'pending', 'voided')),
  employee_note text CHECK (char_length(employee_note) <= 300),
  admin_note text CHECK (char_length(admin_note) <= 300),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_clock_entries_user_idx ON public.time_clock_entries (organization_id, user_id, punched_at DESC);
CREATE INDEX time_clock_entries_org_idx ON public.time_clock_entries (organization_id, punched_at DESC);
CREATE INDEX time_clock_entries_pending_idx ON public.time_clock_entries (organization_id, punched_at) WHERE status = 'pending';

CREATE TABLE public.time_clock_entry_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'update', 'void', 'restore', 'approve', 'reject')),
  changed_fields text[] NOT NULL DEFAULT '{}',
  old_data jsonb,
  new_data jsonb,
  reason text,
  changed_by uuid,
  changed_by_name text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_clock_entry_history_entry_idx ON public.time_clock_entry_history (entry_id, changed_at DESC);
CREATE INDEX time_clock_entry_history_org_idx ON public.time_clock_entry_history (organization_id, changed_at DESC);

CREATE TABLE public.work_schedules (
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reminders boolean NOT NULL DEFAULT true,
  days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}' CHECK (days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  start_time time NOT NULL DEFAULT '09:00',
  end_time time NOT NULL DEFAULT '18:00',
  lunch_start time DEFAULT '13:00',
  lunch_end time DEFAULT '14:00',
  tolerance_min smallint NOT NULL DEFAULT 10 CHECK (tolerance_min BETWEEN 0 AND 120),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id),
  CHECK (end_time > start_time),
  CHECK ((lunch_start IS NULL) = (lunch_end IS NULL)),
  CHECK (lunch_start IS NULL OR (lunch_start > start_time AND lunch_end > lunch_start AND lunch_end < end_time))
);

CREATE TABLE public.time_clock_reminders_sent (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  day date NOT NULL,
  slot text NOT NULL CHECK (slot IN ('entrada', 'almoco', 'regresso', 'saida')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, day, slot)
);

-- 2. History -----------------------------------------------------------------------------

CREATE FUNCTION public.time_clock_log_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_action text;
  v_fields text[] := '{}';
  v_by uuid := auth.uid();
  v_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
  ELSE
    SELECT coalesce(array_agg(n.key), '{}') INTO v_fields
    FROM jsonb_each(to_jsonb(NEW)) n
    WHERE n.key NOT IN ('updated_at', 'updated_by') AND n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);
    IF cardinality(v_fields) = 0 THEN RETURN NEW; END IF;
    v_action := CASE
      WHEN OLD.status = 'pending' AND NEW.status = 'valid' THEN 'approve'
      WHEN OLD.status = 'pending' AND NEW.status = 'voided' THEN 'reject'
      WHEN OLD.status <> 'voided' AND NEW.status = 'voided' THEN 'void'
      WHEN OLD.status = 'voided' AND NEW.status <> 'voided' THEN 'restore'
      ELSE 'update'
    END;
  END IF;
  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = v_by;
  INSERT INTO public.time_clock_entry_history
    (entry_id, organization_id, user_id, action, changed_fields, old_data, new_data, reason, changed_by, changed_by_name)
  VALUES (NEW.id, NEW.organization_id, NEW.user_id, v_action, v_fields,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END, to_jsonb(NEW),
    nullif(current_setting('app.time_clock_reason', true), ''), v_by, v_name);
  RETURN NEW;
END $$;

CREATE TRIGGER time_clock_entries_history
AFTER INSERT OR UPDATE ON public.time_clock_entries
FOR EACH ROW EXECUTE FUNCTION public.time_clock_log_change();

CREATE FUNCTION public.time_clock_history_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'O histórico do ponto é imutável';
END $$;

CREATE TRIGGER time_clock_entry_history_immutable
BEFORE UPDATE OR DELETE ON public.time_clock_entry_history
FOR EACH ROW EXECUTE FUNCTION public.time_clock_history_immutable();

-- A timesheet entry is voided, never deleted.
CREATE TRIGGER time_clock_entries_no_delete
BEFORE DELETE ON public.time_clock_entries
FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.time_clock_history_immutable();

-- 3. Access helpers ----------------------------------------------------------------------

/** Raises unless the caller is an active, MFA-compliant member of the organization. */
CREATE FUNCTION public.time_clock_require_member(_organization_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL OR NOT public.is_org_member(v_me, _organization_id) OR NOT public.meets_mfa_policy(v_me) THEN
    RAISE EXCEPTION 'time_clock_not_member' USING ERRCODE = '42501';
  END IF;
  RETURN v_me;
END $$;

/** Raises unless the caller administers the organization. */
CREATE FUNCTION public.time_clock_require_admin(_organization_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL OR NOT public.is_org_admin(v_me, _organization_id) THEN
    RAISE EXCEPTION 'time_clock_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN v_me;
END $$;

-- 4. The employee's actions --------------------------------------------------------------

/**
 * Records one action of the caller's day and returns the entry id.
 * The state comes from the last non-voided entry (none, or 12 h old → closed):
 *   start: closed · pause: working · stop: working or paused
 *   resume: paused, or a day stopped today ("Retomar dia": that stop becomes a pause).
 * The same action twice within 60 s returns the first entry. A time other than
 * now (forgot to punch) needs a reason and waits for an admin's approval.
 */
CREATE FUNCTION public.time_clock_punch(_organization_id uuid, _action text, _note text DEFAULT NULL, _at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_me uuid := public.time_clock_require_member(_organization_id);
  v_last public.time_clock_entries;
  v_at timestamptz := coalesce(_at, now());
  v_manual boolean := _at IS NOT NULL AND abs(extract(epoch FROM _at - now())) > 120;
  v_note text := nullif(btrim(_note), '');
  v_state text := 'closed';
  v_stopped_today boolean := false;
  v_id uuid;
BEGIN
  IF _action IS NULL OR _action NOT IN ('start', 'pause', 'resume', 'stop') THEN
    RAISE EXCEPTION 'time_clock_invalid_action';
  END IF;
  IF char_length(v_note) > 300 THEN RAISE EXCEPTION 'time_clock_note_too_long'; END IF;
  IF v_manual AND char_length(coalesce(v_note, '')) < 3 THEN RAISE EXCEPTION 'time_clock_reason_required'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_organization_id::text || ':' || v_me::text, 0));

  SELECT * INTO v_last FROM public.time_clock_entries e
  WHERE e.organization_id = _organization_id AND e.user_id = v_me AND e.status <> 'voided'
  ORDER BY e.punched_at DESC, e.created_at DESC LIMIT 1;

  IF v_last.id IS NOT NULL AND v_last.action = _action AND v_last.created_at > now() - interval '60 seconds' THEN
    RETURN v_last.id;
  END IF;

  IF v_at > now() + interval '1 minute' OR v_at < now() - interval '12 hours'
     OR (v_last.id IS NOT NULL AND v_at <= v_last.punched_at) THEN
    RAISE EXCEPTION 'time_clock_invalid_time';
  END IF;

  IF v_last.id IS NOT NULL AND v_last.punched_at > v_at - interval '12 hours' THEN
    IF v_last.action IN ('start', 'resume') THEN v_state := 'working';
    ELSIF v_last.action = 'pause' THEN v_state := 'paused';
    ELSE
      v_stopped_today := (v_last.punched_at AT TIME ZONE 'Europe/Lisbon')::date = (v_at AT TIME ZONE 'Europe/Lisbon')::date;
    END IF;
  END IF;

  IF NOT (
    (_action = 'start' AND v_state = 'closed')
    OR (_action = 'pause' AND v_state = 'working')
    OR (_action = 'stop' AND v_state IN ('working', 'paused'))
    OR (_action = 'resume' AND (v_state = 'paused' OR v_stopped_today))
  ) THEN
    RAISE EXCEPTION 'time_clock_invalid_state:%', v_state;
  END IF;

  IF _action = 'resume' AND v_state = 'closed' THEN
    PERFORM set_config('app.time_clock_reason', 'Retomou o dia', true);
    UPDATE public.time_clock_entries SET action = 'pause', updated_by = v_me, updated_at = now() WHERE id = v_last.id;
    PERFORM set_config('app.time_clock_reason', '', true);
  END IF;

  IF v_manual THEN PERFORM set_config('app.time_clock_reason', v_note, true); END IF;
  INSERT INTO public.time_clock_entries (organization_id, user_id, action, punched_at, source, status, employee_note, created_by)
  VALUES (_organization_id, v_me, _action, v_at, 'app', CASE WHEN v_manual THEN 'pending' ELSE 'valid' END, v_note, v_me)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

/**
 * The employee fixes the time of one of their entries from the last 12 hours.
 * The new time must sit between the entries around it; the entry then waits for approval.
 */
CREATE FUNCTION public.time_clock_correct_entry(_entry_id uuid, _at timestamptz, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_entry public.time_clock_entries;
  v_me uuid;
  v_reason text := btrim(coalesce(_reason, ''));
  v_prev timestamptz;
  v_next timestamptz;
BEGIN
  SELECT * INTO v_entry FROM public.time_clock_entries WHERE id = _entry_id FOR UPDATE;
  IF v_entry.id IS NULL THEN RAISE EXCEPTION 'time_clock_not_found'; END IF;
  v_me := public.time_clock_require_member(v_entry.organization_id);
  IF v_entry.user_id <> v_me OR v_entry.status = 'voided' THEN RAISE EXCEPTION 'time_clock_forbidden' USING ERRCODE = '42501'; END IF;
  IF char_length(v_reason) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'time_clock_reason_required'; END IF;
  IF v_entry.punched_at < now() - interval '12 hours' OR _at < now() - interval '12 hours' OR _at > now() THEN
    RAISE EXCEPTION 'time_clock_invalid_time';
  END IF;

  SELECT max(e.punched_at) INTO v_prev FROM public.time_clock_entries e
  WHERE e.organization_id = v_entry.organization_id AND e.user_id = v_me AND e.status <> 'voided'
    AND e.id <> v_entry.id AND e.punched_at <= v_entry.punched_at;
  SELECT min(e.punched_at) INTO v_next FROM public.time_clock_entries e
  WHERE e.organization_id = v_entry.organization_id AND e.user_id = v_me AND e.status <> 'voided'
    AND e.id <> v_entry.id AND e.punched_at >= v_entry.punched_at;
  IF (v_prev IS NOT NULL AND _at <= v_prev) OR (v_next IS NOT NULL AND _at >= v_next) THEN
    RAISE EXCEPTION 'time_clock_out_of_order';
  END IF;

  PERFORM set_config('app.time_clock_reason', v_reason, true);
  UPDATE public.time_clock_entries
  SET punched_at = _at, status = 'pending', employee_note = v_reason, updated_by = v_me, updated_at = now()
  WHERE id = v_entry.id;
END $$;

-- 5. The admin's actions (never on their own entries) --------------------------------------

/** Creates (no _entry_id) or edits an entry of someone in the organization. */
CREATE FUNCTION public.time_clock_admin_save_entry(
  _organization_id uuid, _entry_id uuid, _user_id uuid, _action text, _punched_at timestamptz, _reason text, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_me uuid := public.time_clock_require_admin(_organization_id);
  v_reason text := btrim(coalesce(_reason, ''));
  v_entry public.time_clock_entries;
  v_id uuid;
BEGIN
  IF _action IS NULL OR _action NOT IN ('start', 'pause', 'resume', 'stop') THEN RAISE EXCEPTION 'time_clock_invalid_action'; END IF;
  IF char_length(v_reason) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'time_clock_reason_required'; END IF;
  IF _punched_at IS NULL OR _punched_at > now() + interval '5 minutes' THEN RAISE EXCEPTION 'time_clock_invalid_time'; END IF;
  PERFORM set_config('app.time_clock_reason', v_reason, true);

  IF _entry_id IS NULL THEN
    IF _user_id = v_me THEN RAISE EXCEPTION 'time_clock_own_entry'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.organization_members m
                   WHERE m.organization_id = _organization_id AND m.user_id = _user_id) THEN
      RAISE EXCEPTION 'time_clock_not_found';
    END IF;
    INSERT INTO public.time_clock_entries (organization_id, user_id, action, punched_at, source, status, admin_note, created_by)
    VALUES (_organization_id, _user_id, _action, _punched_at, 'admin', 'valid', nullif(btrim(_note), ''), v_me)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  SELECT * INTO v_entry FROM public.time_clock_entries
  WHERE id = _entry_id AND organization_id = _organization_id FOR UPDATE;
  IF v_entry.id IS NULL THEN RAISE EXCEPTION 'time_clock_not_found'; END IF;
  IF v_entry.user_id = v_me THEN RAISE EXCEPTION 'time_clock_own_entry'; END IF;
  UPDATE public.time_clock_entries
  SET action = _action, punched_at = _punched_at, admin_note = nullif(btrim(_note), ''), updated_by = v_me, updated_at = now()
  WHERE id = v_entry.id;
  RETURN v_entry.id;
END $$;

/** Approves or restores (valid), rejects or voids (voided) entries in bulk. Voiding needs a reason. */
CREATE FUNCTION public.time_clock_admin_set_status(_organization_id uuid, _entry_ids uuid[], _status text, _reason text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_me uuid := public.time_clock_require_admin(_organization_id);
  v_reason text := nullif(btrim(coalesce(_reason, '')), '');
  v_count integer;
BEGIN
  IF _status NOT IN ('valid', 'voided') THEN RAISE EXCEPTION 'time_clock_invalid_status'; END IF;
  IF _status = 'voided' AND char_length(coalesce(v_reason, '')) < 3 THEN RAISE EXCEPTION 'time_clock_reason_required'; END IF;
  IF char_length(v_reason) > 300 THEN RAISE EXCEPTION 'time_clock_note_too_long'; END IF;
  IF EXISTS (SELECT 1 FROM public.time_clock_entries e WHERE e.id = ANY(_entry_ids)
             AND (e.organization_id <> _organization_id OR e.user_id = v_me)) THEN
    RAISE EXCEPTION 'time_clock_own_entry';
  END IF;
  PERFORM set_config('app.time_clock_reason', coalesce(v_reason, ''), true);
  UPDATE public.time_clock_entries SET status = _status, updated_by = v_me, updated_at = now()
  WHERE id = ANY(_entry_ids) AND organization_id = _organization_id AND status <> _status;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- 6. Reminders (called by the edge function time-clock-reminders, every 5 minutes) ---------

/**
 * Returns the reminders due now (Europe/Lisbon) and marks them sent, once per slot a day.
 * A slot fires from its time + tolerance until 90 minutes later, and only when it applies:
 *   entrada: nothing recorded today · almoco: working, no pause today
 *   regresso: on a pause · saida: still working or paused.
 */
CREATE FUNCTION public.time_clock_due_reminders()
RETURNS TABLE (organization_id uuid, user_id uuid, slot text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
  v_now timestamp := now() AT TIME ZONE 'Europe/Lisbon';
  v_today date := (now() AT TIME ZONE 'Europe/Lisbon')::date;
  v_dow smallint := extract(isodow FROM now() AT TIME ZONE 'Europe/Lisbon')::smallint;
BEGIN
  RETURN QUERY
  WITH s AS (
    SELECT ws.organization_id, ws.user_id, ws.start_time, ws.end_time, ws.lunch_start, ws.lunch_end, ws.tolerance_min,
      (SELECT e.action FROM public.time_clock_entries e
       WHERE e.organization_id = ws.organization_id AND e.user_id = ws.user_id AND e.status <> 'voided'
         AND e.punched_at > now() - interval '12 hours'
       ORDER BY e.punched_at DESC LIMIT 1) AS last_action,
      EXISTS (SELECT 1 FROM public.time_clock_entries e
       WHERE e.organization_id = ws.organization_id AND e.user_id = ws.user_id AND e.status <> 'voided'
         AND (e.punched_at AT TIME ZONE 'Europe/Lisbon')::date = v_today) AS any_today,
      EXISTS (SELECT 1 FROM public.time_clock_entries e
       WHERE e.organization_id = ws.organization_id AND e.user_id = ws.user_id AND e.status <> 'voided'
         AND e.action = 'pause' AND (e.punched_at AT TIME ZONE 'Europe/Lisbon')::date = v_today) AS paused_today
    FROM public.work_schedules ws
    JOIN public.organization_members om
      ON om.user_id = ws.user_id AND om.organization_id = ws.organization_id AND om.is_active
    WHERE ws.reminders AND v_dow = ANY (ws.days)
  ), due AS (
    SELECT s.organization_id, s.user_id, x.slot
    FROM s CROSS JOIN LATERAL (VALUES
      ('entrada', s.start_time, NOT s.any_today),
      ('almoco', s.lunch_start, s.last_action IN ('start', 'resume') AND NOT s.paused_today),
      ('regresso', s.lunch_end, s.last_action = 'pause'),
      ('saida', s.end_time, s.last_action IN ('start', 'resume', 'pause'))
    ) AS x(slot, at, applies)
    WHERE x.at IS NOT NULL AND x.applies IS TRUE
      AND v_now >= v_today + x.at + make_interval(mins => s.tolerance_min)
      AND v_now < v_today + x.at + make_interval(mins => s.tolerance_min + 90)
  ), sent AS (
    INSERT INTO public.time_clock_reminders_sent AS r (organization_id, user_id, day, slot)
    SELECT d.organization_id, d.user_id, v_today, d.slot FROM due d
    ON CONFLICT DO NOTHING
    RETURNING r.organization_id, r.user_id, r.slot
  )
  SELECT sent.organization_id, sent.user_id, sent.slot FROM sent;
END $$;

-- 7. Row level security and grants ---------------------------------------------------------

ALTER TABLE public.time_clock_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_clock_entry_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_clock_reminders_sent ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.time_clock_entries, public.time_clock_entry_history, public.work_schedules,
  public.time_clock_reminders_sent FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.time_clock_entries, public.time_clock_entry_history TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.work_schedules TO authenticated;
GRANT ALL ON public.time_clock_entries, public.time_clock_entry_history, public.work_schedules,
  public.time_clock_reminders_sent TO service_role;

CREATE POLICY "Own entries or org admins" ON public.time_clock_entries FOR SELECT TO authenticated
USING (
  (user_id = (SELECT auth.uid()) AND public.is_org_member((SELECT auth.uid()), organization_id)
    AND public.meets_mfa_policy((SELECT auth.uid())))
  OR public.is_org_admin((SELECT auth.uid()), organization_id)
);

CREATE POLICY "Own history or org admins" ON public.time_clock_entry_history FOR SELECT TO authenticated
USING (
  (user_id = (SELECT auth.uid()) AND public.is_org_member((SELECT auth.uid()), organization_id)
    AND public.meets_mfa_policy((SELECT auth.uid())))
  OR public.is_org_admin((SELECT auth.uid()), organization_id)
);

CREATE POLICY "Own schedule or org admins read" ON public.work_schedules FOR SELECT TO authenticated
USING (
  (user_id = (SELECT auth.uid()) AND public.is_org_member((SELECT auth.uid()), organization_id))
  OR public.is_org_admin((SELECT auth.uid()), organization_id)
);
CREATE POLICY "Own schedule insert" ON public.work_schedules FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()) AND public.is_org_member((SELECT auth.uid()), organization_id));
CREATE POLICY "Own schedule update" ON public.work_schedules FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()) AND public.is_org_member((SELECT auth.uid()), organization_id))
WITH CHECK (user_id = (SELECT auth.uid()) AND public.is_org_member((SELECT auth.uid()), organization_id));

REVOKE ALL ON FUNCTION public.time_clock_log_change(), public.time_clock_history_immutable(),
  public.time_clock_require_member(uuid), public.time_clock_require_admin(uuid),
  public.time_clock_punch(uuid, text, text, timestamptz), public.time_clock_correct_entry(uuid, timestamptz, text),
  public.time_clock_admin_save_entry(uuid, uuid, uuid, text, timestamptz, text, text),
  public.time_clock_admin_set_status(uuid, uuid[], text, text), public.time_clock_due_reminders()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.time_clock_punch(uuid, text, text, timestamptz),
  public.time_clock_correct_entry(uuid, timestamptz, text),
  public.time_clock_admin_save_entry(uuid, uuid, uuid, text, timestamptz, text, text),
  public.time_clock_admin_set_status(uuid, uuid[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.time_clock_due_reminders() TO service_role;

-- 8. Profile photos ------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/webp', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Avatars: own folder insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
CREATE POLICY "Avatars: own folder update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
CREATE POLICY "Avatars: own folder delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

-- 9. Reminder job --------------------------------------------------------------------------

DO $$
DECLARE v_job_id bigint;
BEGIN
  -- Same guard as task-reminders: the function checks x-automation-secret (internalJobGuard).
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'time-clock-reminders';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
  PERFORM cron.schedule('time-clock-reminders', '*/5 * * * *', $command$
    SELECT net.http_post(
      url := 'https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/time-clock-reminders',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-automation-secret', public.automation_internal_secret()),
      body := '{}'::jsonb
    );
  $command$);
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
