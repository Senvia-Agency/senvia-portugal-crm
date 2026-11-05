-- Redistribuição de leads: only leads that just arrived, never old ones handed out by hand.
--
-- The rule looked at when the lead was ASSIGNED. Old leads (imports, manual entries from
-- months ago) given to a salesperson today counted as fresh and started rotating — 36 of the
-- first 37 moves at Escolha Inteligente (2026-11-05). A lead now qualifies only when it was
-- created after the rule was switched on and still sits with whoever got it on arrival
-- (assigned within 15 minutes of entering the system), or was already moved by the rule.

BEGIN;

CREATE OR REPLACE FUNCTION public.reassign_stale_leads()
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
      AND l.created_at >= s.enabled_at
      AND (l.reassign_count > 0 OR l.assigned_at <= l.created_at + interval '15 minutes')
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
      v_pool := NULL;
      IF r.pool = 'form' THEN
        -- 1. The lead's form.
        IF r.form_id IS NOT NULL THEN
          SELECT f.assigned_user_ids INTO v_pool FROM public.forms f WHERE f.id = r.form_id;
        END IF;
        -- 2. No form (Facebook Ads, webhooks): the rotation the current salesperson is in.
        IF coalesce(cardinality(v_pool), 0) = 0 THEN
          SELECT w.assigned_user_ids INTO v_pool FROM public.lead_intake_webhooks w
          WHERE w.organization_id = r.org AND w.is_active AND w.rotate_enabled
            AND cardinality(w.assigned_user_ids) > 1 AND r.assigned_to = ANY (w.assigned_user_ids)
          ORDER BY w.created_at LIMIT 1;
        END IF;
      END IF;
      -- 3. The list chosen in the settings.
      IF coalesce(cardinality(v_pool), 0) = 0 THEN v_pool := r.pool_user_ids; END IF;
      -- 4. Every active salesperson of the organization.
      IF coalesce(cardinality(v_pool), 0) = 0 THEN
        v_pool := array(
          SELECT om.user_id FROM public.organization_members om
          JOIN public.organizations o ON o.id = om.organization_id
          WHERE om.organization_id = r.org AND om.is_active
            AND (om.role <> 'admin' OR coalesce((o.sales_settings->>'exclude_admins_from_assignment')::boolean, false) = false)
          ORDER BY om.joined_at NULLS LAST, om.user_id);
      END IF;
      IF coalesce(cardinality(v_pool), 0) = 0 THEN CONTINUE; END IF;

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

REVOKE ALL ON FUNCTION public.reassign_stale_leads() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_stale_leads() TO service_role;

COMMIT;
