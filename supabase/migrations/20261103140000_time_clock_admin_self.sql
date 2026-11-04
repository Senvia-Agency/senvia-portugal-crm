-- Ponto: an admin answers to nobody.
-- Their own forgotten punches and corrected times are valid at once (no "Aguarda
-- aprovação"), and they may edit, approve, void or restore their own entries.
-- Everything stays in the history with the reason.

BEGIN;

CREATE OR REPLACE FUNCTION public.time_clock_punch(_organization_id uuid, _action text, _note text DEFAULT NULL, _at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_me uuid := public.time_clock_require_member(_organization_id);
  v_admin boolean := public.is_org_admin(v_me, _organization_id);
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
  VALUES (_organization_id, v_me, _action, v_at, 'app',
    CASE WHEN v_manual AND NOT v_admin THEN 'pending' ELSE 'valid' END, v_note, v_me)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.time_clock_correct_entry(_entry_id uuid, _at timestamptz, _reason text)
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
  SET punched_at = _at,
      status = CASE WHEN public.is_org_admin(v_me, v_entry.organization_id) THEN 'valid' ELSE 'pending' END,
      employee_note = v_reason, updated_by = v_me, updated_at = now()
  WHERE id = v_entry.id;
END $$;

CREATE OR REPLACE FUNCTION public.time_clock_admin_save_entry(
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
  UPDATE public.time_clock_entries
  SET action = _action, punched_at = _punched_at, admin_note = nullif(btrim(_note), ''), updated_by = v_me, updated_at = now()
  WHERE id = v_entry.id;
  RETURN v_entry.id;
END $$;

CREATE OR REPLACE FUNCTION public.time_clock_admin_set_status(_organization_id uuid, _entry_ids uuid[], _status text, _reason text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_me uuid := public.time_clock_require_admin(_organization_id);
  v_reason text := nullif(btrim(coalesce(_reason, '')), '');
  v_count integer;
BEGIN
  IF _status NOT IN ('valid', 'voided') THEN RAISE EXCEPTION 'time_clock_invalid_status'; END IF;
  IF _status = 'voided' AND char_length(coalesce(v_reason, '')) < 3 THEN RAISE EXCEPTION 'time_clock_reason_required'; END IF;
  IF char_length(v_reason) > 300 THEN RAISE EXCEPTION 'time_clock_note_too_long'; END IF;
  PERFORM set_config('app.time_clock_reason', coalesce(v_reason, ''), true);
  UPDATE public.time_clock_entries SET status = _status, updated_by = v_me, updated_at = now()
  WHERE id = ANY(_entry_ids) AND organization_id = _organization_id AND status <> _status;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
