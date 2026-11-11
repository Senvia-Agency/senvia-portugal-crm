-- Recurring expenses: a booked copy knows the recurrence it came from.
--
-- The schedule lives on one expense (the first of the series) and
-- generate-recurring-expenses books a plain copy every period. Nothing tied the
-- copy to its schedule, so the edit dialog showed "Recorrência" switched off on
-- it, and switching it on made the copy a second schedule while the first kept
-- running: from then on every period was booked twice (11/11/2026, Chat GPT,
-- Contabo VPS and Google AI Studio).
--
-- Now:
--  * expenses.recurrence_source_id points a booked copy at the expense that
--    carries its schedule. The generator fills it; the copies already booked
--    are linked below, by organization, name and date.
--  * A copy whose source still has a schedule (running or paused) cannot become
--    recurring itself: the database refuses it, whatever the client. The way to
--    change the amount or resume is to edit the source. Once the source's
--    recurrence has ended (recurrence_* cleared) the copy may start its own,
--    and then it is no longer anyone's copy.
--
-- Rollback: DROP TRIGGER expenses_recurrence_source_guard_trg ON public.expenses;
--   DROP FUNCTION public.expenses_recurrence_source_guard();
--   ALTER TABLE public.expenses DROP COLUMN recurrence_source_id;
-- (and redeploy the previous generate-recurring-expenses, which never sends it).

BEGIN;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS recurrence_source_id uuid
  REFERENCES public.expenses(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.expenses.recurrence_source_id IS
  'For a copy booked by generate-recurring-expenses: the expense that carries its schedule.';

CREATE INDEX IF NOT EXISTS expenses_recurrence_source_id_idx
  ON public.expenses (recurrence_source_id)
  WHERE recurrence_source_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.expenses_recurrence_source_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _source_org uuid;
  _source_frequency text;
BEGIN
  IF NEW.recurrence_source_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.recurrence_source_id = NEW.id THEN
    RAISE EXCEPTION 'Uma despesa não pode ser a origem de si própria.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Security definer: the source is read whatever the caller's RLS shows,
  -- so a copy can never be tied to another organization's expense.
  SELECT organization_id, recurrence_frequency
    INTO _source_org, _source_frequency
    FROM public.expenses
   WHERE id = NEW.recurrence_source_id;

  IF NOT FOUND OR _source_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'A recorrência de origem não existe nesta organização.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF COALESCE(NEW.is_recurring, false) OR NEW.recurrence_frequency IS NOT NULL THEN
    IF _source_frequency IS NOT NULL THEN
      RAISE EXCEPTION 'Esta despesa é um lançamento de uma recorrência que já existe. Para mudar o valor, a agenda ou retomar, edita a despesa original na aba Recorrentes.'
        USING ERRCODE = 'check_violation', HINT = 'expense_recurrence_source';
    END IF;
    -- The source's recurrence has ended: this one starts its own schedule.
    NEW.recurrence_source_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS expenses_recurrence_source_guard_trg ON public.expenses;
CREATE TRIGGER expenses_recurrence_source_guard_trg
  BEFORE INSERT OR UPDATE OF is_recurring, recurrence_frequency, recurrence_source_id, organization_id
  ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.expenses_recurrence_source_guard();

-- Link the copies already booked. A copy is a plain expense (no schedule of its
-- own) with the same name, in the same organization, dated after an expense
-- that has a schedule; among several, the running one first, then the latest.
-- Only recurrence_source_id changes: the bank sync and updated_at triggers are
-- off for this statement so no bank transaction is rewritten.
ALTER TABLE public.expenses DISABLE TRIGGER trg_expense_bank_sync;
ALTER TABLE public.expenses DISABLE TRIGGER update_expenses_updated_at;

UPDATE public.expenses c
   SET recurrence_source_id = src.id
  FROM public.expenses c2
  CROSS JOIN LATERAL (
    SELECT s.id
      FROM public.expenses s
     WHERE s.organization_id = c2.organization_id
       AND s.id <> c2.id
       AND s.recurrence_frequency IS NOT NULL
       AND lower(btrim(s.description)) = lower(btrim(c2.description))
       AND s.expense_date < c2.expense_date
     ORDER BY s.is_recurring DESC, s.expense_date DESC, s.created_at DESC
     LIMIT 1
  ) src
 WHERE c.id = c2.id
   AND c.recurrence_source_id IS NULL
   AND NOT COALESCE(c.is_recurring, false)
   AND c.recurrence_frequency IS NULL;

-- Older expenses of a series whose first schedule was ended and replaced by a
-- newer one with the same name (11/11/2026: Chat GPT 103 € before 23 €, Claude
-- 22,14 € before 90 €): they belong to the running schedule too, or switching
-- "Recorrência" on in one of them would start a second one.
UPDATE public.expenses c
   SET recurrence_source_id = src.id
  FROM public.expenses c2
  CROSS JOIN LATERAL (
    SELECT s.id
      FROM public.expenses s
     WHERE s.organization_id = c2.organization_id
       AND s.id <> c2.id
       AND s.is_recurring
       AND s.recurrence_frequency IS NOT NULL
       AND lower(btrim(s.description)) = lower(btrim(c2.description))
     ORDER BY s.expense_date DESC, s.created_at DESC
     LIMIT 1
  ) src
 WHERE c.id = c2.id
   AND c.recurrence_source_id IS NULL
   AND NOT COALESCE(c.is_recurring, false)
   AND c.recurrence_frequency IS NULL;

ALTER TABLE public.expenses ENABLE TRIGGER update_expenses_updated_at;
ALTER TABLE public.expenses ENABLE TRIGGER trg_expense_bank_sync;

COMMIT;
