-- Recurring expenses: a schedule that starts (a new recurring expense, or one
-- switched back on) never falls due in the past.
--
-- 20261012120000 started a new schedule in the period after the expense's own
-- date. For an old expense that is wrong: switching "Recorrente" back on for
-- June's rent, in October, set the next date to July — and the generator then
-- booked July, August, September and October again, all already booked.
-- A starting schedule now goes forward to its first due date on or after
-- today, keeping its own cycle (a quarterly one stays on its months).
-- Schedules already running are unchanged: the generator still books every
-- period it missed.
--
-- Also: switching recurrence off no longer wipes the schedule. With
-- recurrence_* kept it is a pause, and resuming books from the next due date
-- on — nothing for the weeks or months it was paused.

BEGIN;

-- First due date of the schedule after p_after's period that is not before
-- p_from.
CREATE OR REPLACE FUNCTION public.expense_recurrence_upcoming(
  p_after date, p_frequency text, p_day integer, p_month integer, p_from date)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _due date := public.expense_recurrence_next(p_after, p_frequency, p_day, p_month);
  _steps integer := 0;
BEGIN
  -- Bounded: weekly from twenty years back is about a thousand steps.
  WHILE _due IS NOT NULL AND _due < p_from AND _steps < 2000 LOOP
    _due := public.expense_recurrence_next(_due, p_frequency, p_day, p_month);
    _steps := _steps + 1;
  END LOOP;
  RETURN _due;
END;
$$;

CREATE OR REPLACE FUNCTION public.expenses_recurrence_schedule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _due date;
BEGIN
  -- Not recurring: nothing is booked. A schedule left in place is a pause
  -- (is_recurring = false, recurrence_* kept) — "Retomar" switches it back
  -- on; clearing recurrence_* too ends the recurrence for good.
  IF NOT COALESCE(NEW.is_recurring, false) THEN
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

  -- A schedule that starts: the period after the expense, but never a date
  -- already gone.
  IF TG_OP = 'INSERT' OR NOT COALESCE(OLD.is_recurring, false) OR OLD.next_recurrence_date IS NULL THEN
    NEW.next_recurrence_date := public.expense_recurrence_upcoming(
      NEW.expense_date, NEW.recurrence_frequency, NEW.recurrence_day, NEW.recurrence_month, CURRENT_DATE);
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

  -- The schedule changed and nothing was booked yet: it starts over.
  IF OLD.next_recurrence_date IN (
       public.expense_recurrence_next(
         OLD.expense_date, OLD.recurrence_frequency, OLD.recurrence_day, OLD.recurrence_month),
       public.expense_recurrence_upcoming(
         OLD.expense_date, OLD.recurrence_frequency, OLD.recurrence_day, OLD.recurrence_month, CURRENT_DATE)) THEN
    NEW.next_recurrence_date := public.expense_recurrence_upcoming(
      NEW.expense_date, NEW.recurrence_frequency, NEW.recurrence_day, NEW.recurrence_month, CURRENT_DATE);
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

COMMIT;
