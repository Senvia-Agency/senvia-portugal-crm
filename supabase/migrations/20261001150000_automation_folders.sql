-- Pastas manuais para organizar automações. A pasta é uma escolha editorial:
-- o motor de automações nunca a lê nem altera o comportamento do fluxo.

CREATE TABLE IF NOT EXISTS public.automation_folders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.automation_folders
  ADD CONSTRAINT automation_folders_id_organization_key UNIQUE (id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_automation_folder_name_per_org
  ON public.automation_folders (organization_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_automation_folders_org_position
  ON public.automation_folders (organization_id, position, created_at);

ALTER TABLE public.automation_flows
  ADD COLUMN IF NOT EXISTS folder_id uuid;

ALTER TABLE public.automation_flows
  ADD CONSTRAINT automation_flows_folder_id_fkey
  FOREIGN KEY (folder_id, organization_id)
  REFERENCES public.automation_folders (id, organization_id)
  ON DELETE SET NULL (folder_id);

CREATE INDEX IF NOT EXISTS idx_automation_flows_folder
  ON public.automation_flows (folder_id);

ALTER TABLE public.automation_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view org automation folders" ON public.automation_folders
  FOR SELECT USING (
    public.is_org_member(auth.uid(), organization_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "Admins insert org automation folders" ON public.automation_folders
  FOR INSERT WITH CHECK (
    (public.is_org_member(auth.uid(), organization_id)
     AND public.has_role(auth.uid(), 'admin'::public.app_role))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "Admins update org automation folders" ON public.automation_folders
  FOR UPDATE USING (
    (public.is_org_member(auth.uid(), organization_id)
     AND public.has_role(auth.uid(), 'admin'::public.app_role))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) WITH CHECK (
    (public.is_org_member(auth.uid(), organization_id)
     AND public.has_role(auth.uid(), 'admin'::public.app_role))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "Admins delete org automation folders" ON public.automation_folders
  FOR DELETE USING (
    (public.is_org_member(auth.uid(), organization_id)
     AND public.has_role(auth.uid(), 'admin'::public.app_role))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

DROP TRIGGER IF EXISTS trg_automation_folders_updated ON public.automation_folders;
CREATE TRIGGER trg_automation_folders_updated
  BEFORE UPDATE ON public.automation_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- As pastas iniciais são apenas recipientes; os fluxos ficam sem pasta até a
-- Senvia escolher manualmente onde os quer colocar.
INSERT INTO public.automation_folders (organization_id, name, position)
VALUES
  ('06fe9e1d-9670-45b0-8717-c5a6e90be380', 'Senvia OS', 0),
  ('06fe9e1d-9670-45b0-8717-c5a6e90be380', 'Senvia Agency', 1)
ON CONFLICT (organization_id, lower(name)) DO NOTHING;
