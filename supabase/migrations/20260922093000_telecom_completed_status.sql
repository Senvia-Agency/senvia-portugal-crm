-- Telecom keeps an operational state (ativo) separate from the terminal
-- state (instalado). The generic sales.status remains in sync for shared
-- finance and reporting queries.

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_telecom_status_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_telecom_status_check
  CHECK (telecom_status IS NULL OR telecom_status IN
    ('pendente', 'em_instalacao', 'ativo', 'instalado', 'anulado', 'cancelado'));

COMMENT ON COLUMN public.sales.telecom_status IS
  'Telecom lifecycle: pendente | em_instalacao | ativo (operational) | instalado (closed) | anulado (before install, no chargeback) | cancelado (after install, chargeback). NULL for non-telecom organizations.';

-- Existing active telecom sales were previously written as generic
-- "delivered" (Instalada). They must be "fulfilled" while still active.
UPDATE public.sales
SET status = 'fulfilled', updated_at = now()
WHERE telecom_status = 'ativo' AND status = 'delivered';
