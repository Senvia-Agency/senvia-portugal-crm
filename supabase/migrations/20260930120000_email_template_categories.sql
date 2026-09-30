-- Email template categories, per organization.
--
-- Until now the categories were five values hardcoded in the frontend
-- (general/proposal/welcome/followup/promotion) with no table behind them and
-- no constraint on the column, so nobody could create their own and somebody
-- had already written a sixth value ("trial") straight into the rows — which
-- then rendered as an empty chip, because the label lookup found nothing.
--
-- Shape follows public.expense_categories, the pattern this project already
-- uses for user-managed categories, with one addition: a unique name per
-- organization, so the same category cannot be created twice.

-- ── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_template_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text DEFAULT '#6366f1',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Two categories with the same name in one organization are always a mistake,
-- and case is not a meaningful difference here ("Trial" vs "trial").
CREATE UNIQUE INDEX IF NOT EXISTS uniq_template_category_name
  ON public.email_template_categories (organization_id, lower(name))
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_template_categories_org
  ON public.email_template_categories (organization_id);

DROP TRIGGER IF EXISTS trg_email_template_categories_updated ON public.email_template_categories;
CREATE TRIGGER trg_email_template_categories_updated
  BEFORE UPDATE ON public.email_template_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Link from the templates ─────────────────────────────────────────────────
-- Deleting a category never deletes a template: the template simply loses its
-- category and can be given another one.

ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS category_id uuid
  REFERENCES public.email_template_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_templates_category
  ON public.email_templates (category_id);

-- The old free-text `category` column stays, still filled, so this migration
-- can be rolled back and nothing that reads it breaks. It is dead weight once
-- the UI has moved over, and should be dropped in a later, separate change.

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.email_template_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view org template categories" ON public.email_template_categories;
CREATE POLICY "Users view org template categories"
  ON public.email_template_categories FOR SELECT
  USING (is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Admins manage org template categories" ON public.email_template_categories;
CREATE POLICY "Admins manage org template categories"
  ON public.email_template_categories FOR ALL
  USING (is_org_member(auth.uid(), organization_id) AND is_org_admin(auth.uid(), organization_id))
  WITH CHECK (is_org_member(auth.uid(), organization_id) AND is_org_admin(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Super admin full access template categories" ON public.email_template_categories;
CREATE POLICY "Super admin full access template categories"
  ON public.email_template_categories FOR ALL
  USING (has_role(auth.uid(), 'super_admin'::app_role));

-- Same staged MFA gate every other table in this project carries.
DROP POLICY IF EXISTS "security_mfa" ON public.email_template_categories;
CREATE POLICY "security_mfa"
  ON public.email_template_categories FOR ALL
  USING (meets_mfa_policy(auth.uid()))
  WITH CHECK (meets_mfa_policy(auth.uid()));

-- ── Backfill ────────────────────────────────────────────────────────────────
-- One real row per value actually in use, per organization. The two values the
-- frontend declared but nobody ever used (proposal, promotion) are deliberately
-- not created: a brand-new list of empty categories helps no one.

INSERT INTO public.email_template_categories (organization_id, name)
SELECT DISTINCT
  t.organization_id,
  CASE t.category
    WHEN 'general'   THEN 'Geral'
    WHEN 'proposal'  THEN 'Propostas'
    WHEN 'welcome'   THEN 'Boas-vindas'
    WHEN 'followup'  THEN 'Follow-up'
    WHEN 'promotion' THEN 'Promoção'
    WHEN 'trial'     THEN 'Trial'
    ELSE initcap(t.category)
  END AS name
FROM public.email_templates t
WHERE t.category IS NOT NULL
  AND btrim(t.category) <> ''
ON CONFLICT DO NOTHING;

UPDATE public.email_templates t
SET category_id = c.id
FROM public.email_template_categories c
WHERE c.organization_id = t.organization_id
  AND t.category_id IS NULL
  AND lower(c.name) = lower(
    CASE t.category
      WHEN 'general'   THEN 'Geral'
      WHEN 'proposal'  THEN 'Propostas'
      WHEN 'welcome'   THEN 'Boas-vindas'
      WHEN 'followup'  THEN 'Follow-up'
      WHEN 'promotion' THEN 'Promoção'
      WHEN 'trial'     THEN 'Trial'
      ELSE initcap(t.category)
    END
  );

COMMENT ON TABLE public.email_template_categories IS
  'Categorias de templates de email, geridas por cada organização. Substitui a lista fixa que vivia no frontend.';
