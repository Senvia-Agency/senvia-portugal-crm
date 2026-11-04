-- Clients no longer have a VIP status: only active and inactive. A client saved as VIP was an
-- active client, so it becomes one. Nothing is deleted. Running it again changes nothing.
BEGIN;

UPDATE public.crm_clients
   SET status = 'active', updated_at = now()
 WHERE status = 'vip';

COMMIT;

-- Check (expected: 0)
-- SELECT count(*) FROM public.crm_clients WHERE status = 'vip';
