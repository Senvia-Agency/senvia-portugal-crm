-- Additive: existing tasks and Inbox integrations retain their current behavior.
ALTER TABLE public.inbox_tasks ADD COLUMN participant_ids uuid[] NOT NULL DEFAULT '{}';
CREATE FUNCTION public.guard_workplace_task_participants()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE participant uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.participant_ids IS NOT DISTINCT FROM OLD.participant_ids THEN
    RETURN NEW;
  END IF;
  IF cardinality(NEW.participant_ids) > 100 OR array_position(NEW.participant_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid task participants' USING ERRCODE = '23514';
  END IF;
  FOREACH participant IN ARRAY NEW.participant_ids LOOP
    IF NOT public.is_org_member(participant, NEW.organization_id) THEN
      RAISE EXCEPTION 'Participants must belong to the task organization' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  NEW.participant_ids := ARRAY(SELECT DISTINCT person FROM unnest(NEW.participant_ids) AS person ORDER BY person);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_workplace_task_participants() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER inbox_tasks_participants_guard BEFORE INSERT OR UPDATE ON public.inbox_tasks
FOR EACH ROW EXECUTE FUNCTION public.guard_workplace_task_participants();
