ALTER TABLE public.inbox_tasks
  ADD COLUMN priority text NOT NULL DEFAULT 'normal'
  CONSTRAINT inbox_tasks_priority_check CHECK (priority IN ('low', 'normal', 'high'));
