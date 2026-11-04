BEGIN;

ALTER TABLE public.otto_action_log
  ADD COLUMN module_key text,
  ADD COLUMN context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN status text,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN finished_at timestamptz,
  ADD COLUMN updated_at timestamptz;

UPDATE public.otto_action_log
SET
  status = CASE WHEN success THEN 'succeeded' ELSE 'failed' END,
  started_at = created_at,
  finished_at = created_at,
  updated_at = created_at
WHERE status IS NULL;

ALTER TABLE public.otto_action_log
  ALTER COLUMN success SET DEFAULT false,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN started_at SET DEFAULT now(),
  ALTER COLUMN started_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL,
  ADD CONSTRAINT otto_action_log_status_check CHECK (
    status IN ('started', 'denied', 'failed', 'succeeded', 'unknown')
  ),
  ADD CONSTRAINT otto_action_log_lifecycle_check CHECK (
    (
      status = 'started'
      AND success = false
      AND finished_at IS NULL
    )
    OR
    (
      status IN ('denied', 'failed', 'succeeded', 'unknown')
      AND finished_at IS NOT NULL
      AND success = (status = 'succeeded')
    )
  );

CREATE OR REPLACE FUNCTION public.guard_otto_action_log_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS NULL THEN
      NEW.status := CASE WHEN NEW.success THEN 'succeeded' ELSE 'failed' END;
    END IF;
    NEW.started_at := COALESCE(NEW.started_at, now());
    NEW.updated_at := COALESCE(NEW.updated_at, NEW.started_at);
    NEW.success := (NEW.status = 'succeeded');
    IF NEW.status = 'started' THEN
      NEW.finished_at := NULL;
    ELSE
      NEW.finished_at := COALESCE(NEW.finished_at, now());
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'started'
    OR NEW.status IS NULL
    OR NEW.status NOT IN ('denied', 'failed', 'succeeded', 'unknown') THEN
    RAISE EXCEPTION 'Otto action log lifecycle is immutable after completion'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.module_key IS DISTINCT FROM OLD.module_key
    OR NEW.tool IS DISTINCT FROM OLD.tool
    OR NEW.context IS DISTINCT FROM OLD.context
    OR NEW.args IS DISTINCT FROM OLD.args
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'Otto action log attempt fields are immutable'
      USING ERRCODE = '55000';
  END IF;

  NEW.success := (NEW.status = 'succeeded');
  NEW.finished_at := now();
  NEW.updated_at := NEW.finished_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_otto_action_log_lifecycle ON public.otto_action_log;
CREATE TRIGGER guard_otto_action_log_lifecycle
  BEFORE INSERT OR UPDATE ON public.otto_action_log
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_otto_action_log_lifecycle();

REVOKE ALL ON FUNCTION public.guard_otto_action_log_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.otto_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS otto_action_log_select ON public.otto_action_log;
DROP POLICY IF EXISTS otto_action_log_admin_select ON public.otto_action_log;
CREATE POLICY otto_action_log_admin_select
  ON public.otto_action_log
  FOR SELECT
  TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id));

REVOKE ALL ON TABLE public.otto_action_log FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.otto_action_log FROM authenticated;
GRANT SELECT ON TABLE public.otto_action_log TO authenticated;

COMMENT ON COLUMN public.otto_action_log.id IS
  'Stable action key. One started attempt may transition to one terminal status.';
COMMENT ON COLUMN public.otto_action_log.status IS
  'started, denied, failed, succeeded, or unknown when execution outcome cannot be confirmed.';
COMMENT ON COLUMN public.otto_action_log.args IS
  'Redacted operational arguments; secrets, message bodies, attachments, and unnecessary PII are excluded.';
COMMENT ON COLUMN public.otto_action_log.result IS
  'Redacted operational result; terminal success remains mirrored in the legacy success column.';

COMMIT;
