-- Recurring expenses: how often (weekly, monthly, quarterly, yearly) and on
-- which day they fall due.
--
-- Until now a recurring expense was always monthly, and its next date was
-- worked out in the browser as `new Date(date).setMonth(+1).toISOString()`:
--   * in summer time (UTC+1) that lands on the previous day, so every edit
--     pulled the due day back by one (2nd → 1st, 10th → 9th);
--   * on the 31st it overflowed (31 Oct → 1 Dec), skipping November.
-- The schedule now lives here, in one place: the due day is stored, and the
-- next date is computed by expense_recurrence_next() — on save by a trigger,
-- and by generate-recurring-expenses when it books each copy.
--
-- The day a schedule falls due:
--   weekly     recurrence_day 1–7 (ISO: 1 = Monday)
--   monthly    recurrence_day 1–31, every month
--   quarterly  recurrence_day 1–31, every 3 months from the expense's month
--   yearly     recurrence_day 1–31 of recurrence_month 1–12
-- A month without that day falls due on its last day (31 → 30 Nov → 28 Feb)
-- and the next one goes back to the 31st.
--
-- One booking per period: the expense itself covers its own period, so the
-- next date is the due date in the FOLLOWING period (a monthly expense dated
-- 12 Oct, due on the 25th, is next due 25 Nov — not 25 Oct).
--
-- Existing recurring expenses become monthly on the day of their own date,
-- and their next date is moved back onto that day.

BEGIN;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS recurrence_frequency text,
  ADD COLUMN IF NOT EXISTS recurrence_day smallint,
  ADD COLUMN IF NOT EXISTS recurrence_month smallint;

COMMENT ON COLUMN public.expenses.recurrence_frequency IS
  'weekly | monthly | quarterly | yearly. NULL when the expense does not recur.';
COMMENT ON COLUMN public.expenses.recurrence_day IS
  'Due day: 1–7 (ISO weekday, 1 = Monday) when weekly, else 1–31 (a shorter month falls due on its last day).';
COMMENT ON COLUMN public.expenses.recurrence_month IS
  'Due month 1–12, yearly schedules only.';

-- The schedule's due date inside the period that contains p_ref.
CREATE OR REPLACE FUNCTION public.expense_recurrence_due_in_period(
  p_ref date, p_frequency text, p_day integer, p_month integer DEFAULT NULL)
RETURNS date
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    -- Out-of-range input yields NULL, so expenses_recurrence_valid is what
    -- rejects it, with its own message rather than a date overflow.
    WHEN p_ref IS NULL OR p_day IS NULL OR p_day NOT BETWEEN 1 AND 31 THEN NULL
    WHEN p_frequency = 'weekly' THEN
      CASE WHEN p_day <= 7 THEN date_trunc('week', p_ref)::date + (p_day - 1) END
    WHEN p_frequency = 'yearly' AND (p_month IS NULL OR p_month NOT BETWEEN 1 AND 12) THEN NULL
    ELSE (
      SELECT make_date(ym.y, ym.m, LEAST(
        p_day, extract(day FROM make_date(ym.y, ym.m, 1) + interval '1 month - 1 day')::integer))
      FROM (SELECT extract(year FROM p_ref)::integer AS y,
                   CASE WHEN p_frequency = 'yearly' THEN p_month
                        ELSE extract(month FROM p_ref)::integer END AS m) AS ym
    )
  END
$$;

-- The next due date after p_after: the schedule's date in the period that
-- follows p_after's own.
CREATE OR REPLACE FUNCTION public.expense_recurrence_next(
  p_after date, p_frequency text, p_day integer, p_month integer DEFAULT NULL)
RETURNS date
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT public.expense_recurrence_due_in_period(
    (p_after + CASE p_frequency
                 WHEN 'weekly'    THEN interval '7 days'
                 WHEN 'quarterly' THEN interval '3 months'
                 WHEN 'yearly'    THEN interval '1 year'
                 ELSE interval '1 month'
               END)::date,
    p_frequency, p_day, p_month)
$$;

-- Existing recurring expenses: monthly, on the day of their own date.
UPDATE public.expenses
SET recurrence_frequency = 'monthly',
    recurrence_day = extract(day FROM expense_date)::smallint
WHERE is_recurring AND recurrence_frequency IS NULL;

-- Put their next date back on that day: the first date of the schedule no
-- earlier than three days before the stored one (the drift was one day back,
-- or forward into the next month from a 31st).
DO $$
DECLARE
  _row record;
  _due date;
BEGIN
  FOR _row IN
    SELECT id, expense_date, next_recurrence_date, recurrence_day
    FROM public.expenses
    WHERE is_recurring AND next_recurrence_date IS NOT NULL
  LOOP
    _due := public.expense_recurrence_next(_row.expense_date, 'monthly', _row.recurrence_day);
    WHILE _due < _row.next_recurrence_date - 3 LOOP
      _due := public.expense_recurrence_next(_due, 'monthly', _row.recurrence_day);
    END LOOP;
    IF _due IS DISTINCT FROM _row.next_recurrence_date THEN
      UPDATE public.expenses SET next_recurrence_date = _due WHERE id = _row.id;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_recurrence_valid;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_recurrence_valid CHECK (
  recurrence_frequency IS NULL
  OR (recurrence_frequency = 'weekly'
      AND recurrence_day BETWEEN 1 AND 7 AND recurrence_month IS NULL)
  OR (recurrence_frequency IN ('monthly', 'quarterly')
      AND recurrence_day BETWEEN 1 AND 31 AND recurrence_month IS NULL)
  OR (recurrence_frequency = 'yearly'
      AND recurrence_day BETWEEN 1 AND 31 AND recurrence_month BETWEEN 1 AND 12)
);

-- Keeps the schedule and its next date consistent on every save.
CREATE OR REPLACE FUNCTION public.expenses_recurrence_schedule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _due date;
BEGIN
  IF NOT COALESCE(NEW.is_recurring, false) THEN
    NEW.recurrence_frequency := NULL;
    NEW.recurrence_day := NULL;
    NEW.recurrence_month := NULL;
    NEW.next_recurrence_date := NULL;
    RETURN NEW;
  END IF;

  -- Whatever the caller leaves out follows the expense's own date.
  NEW.recurrence_frequency := COALESCE(NEW.recurrence_frequency, 'monthly');
  IF NEW.recurrence_day IS NULL THEN
    NEW.recurrence_day := CASE WHEN NEW.recurrence_frequency = 'weekly'
      THEN extract(isodow FROM NEW.expense_date)::smallint
      ELSE extract(day FROM NEW.expense_date)::smallint END;
  END IF;
  IF NEW.recurrence_frequency = 'yearly' THEN
    NEW.recurrence_month := COALESCE(NEW.recurrence_month, extract(month FROM NEW.expense_date)::smallint);
  ELSE
    NEW.recurrence_month := NULL;
  END IF;

  -- A new schedule starts in the period after the expense.
  IF TG_OP = 'INSERT' OR NOT COALESCE(OLD.is_recurring, false) OR OLD.next_recurrence_date IS NULL THEN
    NEW.next_recurrence_date := public.expense_recurrence_next(
      NEW.expense_date, NEW.recurrence_frequency, NEW.recurrence_day, NEW.recurrence_month);
    RETURN NEW;
  END IF;

  IF NEW.recurrence_frequency IS NOT DISTINCT FROM OLD.recurrence_frequency
     AND NEW.recurrence_day IS NOT DISTINCT FROM OLD.recurrence_day
     AND NEW.recurrence_month IS NOT DISTINCT FROM OLD.recurrence_month
     AND NEW.expense_date IS NOT DISTINCT FROM OLD.expense_date THEN
    -- Same schedule. Only generate-recurring-expenses (service role) moves
    -- the next date forward; a browser save keeps it where it is.
    IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
      NEW.next_recurrence_date := OLD.next_recurrence_date;
    END IF;
    RETURN NEW;
  END IF;

  -- The schedule changed and nothing was booked yet: restart from the expense.
  IF OLD.next_recurrence_date = public.expense_recurrence_next(
       OLD.expense_date, OLD.recurrence_frequency, OLD.recurrence_day, OLD.recurrence_month) THEN
    NEW.next_recurrence_date := public.expense_recurrence_next(
      NEW.expense_date, NEW.recurrence_frequency, NEW.recurrence_day, NEW.recurrence_month);
    RETURN NEW;
  END IF;

  -- Copies already booked up to the period before OLD.next: the new schedule
  -- picks up in that same period, so none is skipped or booked twice.
  _due := public.expense_recurrence_due_in_period(
    OLD.next_recurrence_date, NEW.recurrence_frequency, NEW.recurrence_day, NEW.recurrence_month);
  IF NEW.recurrence_frequency IS DISTINCT FROM OLD.recurrence_frequency
     AND _due < OLD.next_recurrence_date THEN
    _due := public.expense_recurrence_next(
      _due, NEW.recurrence_frequency, NEW.recurrence_day, NEW.recurrence_month);
  END IF;
  NEW.next_recurrence_date := _due;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS expenses_recurrence_schedule_trg ON public.expenses;
CREATE TRIGGER expenses_recurrence_schedule_trg
  BEFORE INSERT OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.expenses_recurrence_schedule();

COMMIT;
