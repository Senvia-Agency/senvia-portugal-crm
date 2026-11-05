BEGIN;
CREATE TABLE public.automation_hook_secrets (
  flow_id uuid PRIMARY KEY REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  secret_hash text NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  rotated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.automation_hook_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_hook_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.automation_hook_secrets TO service_role;
COMMIT;
