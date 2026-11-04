-- Redistribuição de leads: a lead that gets no progress from its salesperson within
-- the organization's deadline (counted only inside its working window) passes to the
-- next salesperson. Suggested by Escolha Inteligente: 10h–22h, 2 hours.
--
-- A lead that arrives outside the window waits for it: one at 23:00 starts counting
-- at 10:00 and moves at 12:00. Only leads assigned after the feature was switched on
-- count, so turning it on never sweeps the existing backlog.

BEGIN;

-- 1. Settings, one row per organization -------------------------------------------------

CREATE TABLE public.lead_reassignment_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  timeout_minutes integer NOT NULL DEFAULT 120 CHECK (timeout_minutes BETWEEN 15 AND 1440),
  window_start time NOT NULL DEFAULT '10:00',
  window_end time NOT NULL DEFAULT '22:00',
  days smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}' CHECK (cardinality(days) > 0 AND days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  progress_rule text NOT NULL DEFAULT 'stage_change' CHECK (progress_rule IN ('stage_change', 'any_activity')),
  pool text NOT NULL DEFAULT 'form' CHECK (pool IN ('form', 'list')),
  pool_user_ids uuid[] NOT NULL DEFAULT '{}',
  max_reassignments smallint NOT NULL DEFAULT 2 CHECK (max_reassignments BETWEEN 1 AND 10),
  after_max text NOT NULL DEFAULT 'admin' CHECK (after_max IN ('admin', 'keep')),
  notify_email boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CHECK (window_end > window_start)
);

-- Switching on stamps enabled_at: only leads assigned from then on are watched.
CREATE FUNCTION public.lead_reassignment_settings_stamp()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.enabled AND (TG_OP = 'INSERT' OR NOT OLD.enabled) THEN NEW.enabled_at := now(); END IF;
  NEW.updated_at := now();
  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  RETURN NEW;
END $$;
CREATE TRIGGER lead_reassignment_settings_stamp
BEFORE INSERT OR UPDATE ON public.lead_reassignment_settings
FOR EACH ROW EXECUTE FUNCTION public.lead_reassignment_settings_stamp();

-- 2. History ----------------------------------------------------------------------------

CREATE TABLE public.lead_reassignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  from_user uuid,
  to_user uuid,
  reason text NOT NULL DEFAULT 'no_progress' CHECK (reason IN ('no_progress', 'max_reached')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_reassignments_org_idx ON public.lead_reassignments (organization_id, created_at DESC);
CREATE INDEX lead_reassignments_lead_idx ON public.lead_reassignments (lead_id, created_at DESC);

-- 3. Lead clock columns -----------------------------------------------------------------

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reassign_count smallint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS leads_reassign_watch_idx ON public.leads (organization_id, assigned_at)
  WHERE assigned_to IS NOT NULL AND archived_at IS NULL;

/** Stamps when the salesperson changes and when the stage changes (the "progress"). */
CREATE FUNCTION public.leads_stamp_assignment()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.assigned_at := CASE WHEN NEW.assigned_to IS NOT NULL THEN now() END;
    NEW.status_changed_at := NULL;
  ELSE
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
      NEW.assigned_at := CASE WHEN NEW.assigned_to IS NOT NULL THEN now() END;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN NEW.status_changed_at := now(); END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER leads_stamp_assignment
BEFORE INSERT OR UPDATE OF assigned_to, status ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.leads_stamp_assignment();

-- 4. Working-window minutes -------------------------------------------------------------

/** Minutes between two instants that fall inside the daily window on the given ISO weekdays (Europe/Lisbon). */
CREATE FUNCTION public.business_minutes_between(_from timestamptz, _to timestamptz, _start time, _end time, _days smallint[])
RETURNS numeric LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_total numeric := 0;
  v_day date := (_from AT TIME ZONE 'Europe/Lisbon')::date;
  v_last date := (_to AT TIME ZONE 'Europe/Lisbon')::date;
  v_a timestamptz;
  v_b timestamptz;
BEGIN
  IF _to IS NULL OR _from IS NULL OR _to <= _from THEN RETURN 0; END IF;
  IF v_last - v_day > 31 THEN v_day := v_last - 31; END IF;
  WHILE v_day <= v_last LOOP
    IF extract(isodow FROM v_day)::smallint = ANY (_days) THEN
      v_a := greatest(_from, (v_day + _start) AT TIME ZONE 'Europe/Lisbon');
      v_b := least(_to, (v_day + _end) AT TIME ZONE 'Europe/Lisbon');
      IF v_b > v_a THEN v_total := v_total + extract(epoch FROM v_b - v_a) / 60; END IF;
    END IF;
    v_day := v_day + 1;
  END LOOP;
  RETURN v_total;
END $$;

-- 5. The sweep (edge function lead-reassign, every 5 minutes) ---------------------------

/**
 * Moves every overdue lead to the next salesperson and returns what moved, for the
 * notifications. Overdue: assigned (after the feature was on), not archived, not in a
 * final stage, no progress since it was assigned, and the deadline spent inside the window.
 * The next one comes from the lead's form rotation (or the chosen list), skipping whoever
 * already had it. After the last allowed move it goes to an admin (or stays, by setting).
 */
CREATE FUNCTION public.reassign_stale_leads()
RETURNS TABLE (organization_id uuid, lead_id uuid, from_user uuid, to_user uuid, reason text, notify_email boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
  r record;
  v_pool uuid[];
  v_held uuid[];
  v_to uuid;
  v_reason text;
BEGIN
  FOR r IN
    SELECT l.id, l.organization_id AS org, l.assigned_to, l.assigned_at, l.form_id, l.reassign_count,
           s.timeout_minutes, s.window_start, s.window_end, s.days, s.progress_rule, s.pool, s.pool_user_ids,
           s.max_reassignments, s.after_max, s.notify_email AS send_email
    FROM public.leads l
    JOIN public.lead_reassignment_settings s ON s.organization_id = l.organization_id AND s.enabled
    WHERE l.assigned_to IS NOT NULL AND l.archived_at IS NULL
      AND l.assigned_at IS NOT NULL AND l.assigned_at >= s.enabled_at
      AND l.assigned_at > now() - interval '14 days'
      AND (l.status_changed_at IS NULL OR l.status_changed_at <= l.assigned_at)
      AND l.reassign_count < s.max_reassignments + CASE WHEN s.after_max = 'admin' THEN 1 ELSE 0 END
      AND NOT EXISTS (
        SELECT 1 FROM public.pipeline_stages ps
        WHERE ps.organization_id = l.organization_id AND ps.key = l.status
          AND (ps.is_final_positive OR ps.is_final_negative))
    FOR UPDATE OF l SKIP LOCKED
  LOOP
    IF r.progress_rule = 'any_activity' AND (
      EXISTS (SELECT 1 FROM public.calendar_events e WHERE e.lead_id = r.id AND e.created_at > r.assigned_at)
      OR EXISTS (SELECT 1 FROM public.proposals p WHERE p.lead_id = r.id AND p.created_at > r.assigned_at)
    ) THEN CONTINUE; END IF;
    IF public.business_minutes_between(r.assigned_at, now(), r.window_start, r.window_end, r.days) < r.timeout_minutes THEN
      CONTINUE;
    END IF;

    v_to := NULL;
    IF r.reassign_count >= r.max_reassignments THEN
      -- Out of moves: an active admin takes it.
      v_reason := 'max_reached';
      SELECT om.user_id INTO v_to FROM public.organization_members om
      WHERE om.organization_id = r.org AND om.is_active AND om.role = 'admin' AND om.user_id <> r.assigned_to
      ORDER BY om.joined_at NULLS LAST LIMIT 1;
    ELSE
      v_reason := 'no_progress';
      v_pool := CASE WHEN r.pool = 'form' AND r.form_id IS NOT NULL
        THEN (SELECT f.assigned_user_ids FROM public.forms f WHERE f.id = r.form_id) END;
      IF coalesce(cardinality(v_pool), 0) = 0 THEN v_pool := r.pool_user_ids; END IF;
      v_held := array(SELECT h.from_user FROM public.lead_reassignments h WHERE h.lead_id = r.id AND h.from_user IS NOT NULL)
        || r.assigned_to;
      -- The next in the list after the current salesperson, going round, skipping past holders and inactive or paused people.
      SELECT t.m INTO v_to
      FROM unnest(v_pool) WITH ORDINALITY AS t(m, ord)
      WHERE NOT (t.m = ANY (v_held))
        AND EXISTS (SELECT 1 FROM public.organization_members om
                    WHERE om.organization_id = r.org AND om.user_id = t.m AND om.is_active
                      AND (om.paused_until IS NULL OR om.paused_until <= now()))
      ORDER BY (t.ord - coalesce((SELECT c.ord FROM unnest(v_pool) WITH ORDINALITY AS c(m, ord) WHERE c.m = r.assigned_to LIMIT 1), 0)
                + cardinality(v_pool)) % cardinality(v_pool)
      LIMIT 1;
    END IF;

    IF v_to IS NULL THEN CONTINUE; END IF;

    UPDATE public.leads SET assigned_to = v_to, reassign_count = r.reassign_count + 1 WHERE id = r.id;
    INSERT INTO public.lead_reassignments (organization_id, lead_id, from_user, to_user, reason)
    VALUES (r.org, r.id, r.assigned_to, v_to, v_reason);

    organization_id := r.org; lead_id := r.id; from_user := r.assigned_to; to_user := v_to;
    reason := v_reason; notify_email := r.send_email;
    RETURN NEXT;
  END LOOP;
END $$;

-- 6. Row level security and grants ------------------------------------------------------

ALTER TABLE public.lead_reassignment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_reassignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.lead_reassignment_settings, public.lead_reassignments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lead_reassignment_settings TO authenticated;
GRANT SELECT ON public.lead_reassignments TO authenticated;
GRANT ALL ON public.lead_reassignment_settings, public.lead_reassignments TO service_role;

CREATE POLICY "Members read reassignment settings" ON public.lead_reassignment_settings FOR SELECT TO authenticated
USING (public.is_org_member((SELECT auth.uid()), organization_id));
CREATE POLICY "Admins insert reassignment settings" ON public.lead_reassignment_settings FOR INSERT TO authenticated
WITH CHECK (public.is_org_admin((SELECT auth.uid()), organization_id));
CREATE POLICY "Admins update reassignment settings" ON public.lead_reassignment_settings FOR UPDATE TO authenticated
USING (public.is_org_admin((SELECT auth.uid()), organization_id))
WITH CHECK (public.is_org_admin((SELECT auth.uid()), organization_id));

CREATE POLICY "Members read reassignments" ON public.lead_reassignments FOR SELECT TO authenticated
USING (public.is_org_member((SELECT auth.uid()), organization_id));

REVOKE ALL ON FUNCTION public.reassign_stale_leads(), public.business_minutes_between(timestamptz, timestamptz, time, time, smallint[])
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_stale_leads(), public.business_minutes_between(timestamptz, timestamptz, time, time, smallint[]) TO service_role;

-- 7. The job ----------------------------------------------------------------------------

DO $$
DECLARE v_job_id bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN RETURN; END IF;
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'lead-reassign';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
  PERFORM cron.schedule('lead-reassign', '*/5 * * * *', $command$
    SELECT net.http_post(
      url := 'https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/lead-reassign',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-automation-secret', public.automation_internal_secret()),
      body := '{}'::jsonb
    );
  $command$);
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
