-- At most five accepted operations of each kind in ANY rolling 60 seconds.
-- Reads, synchronization, Stripe/Meta callbacks and trusted cron jobs are exempt.
ALTER TABLE public.rate_limit_hits ADD COLUMN IF NOT EXISTS request_times timestamptz[] NOT NULL DEFAULT '{}';
CREATE FUNCTION public.user_action_rate_limit(_user_id uuid, _action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bucket_key text; hits_at timestamptz[]; instant timestamptz; remaining_seconds integer;
BEGIN
  IF _user_id IS NULL OR length(_action) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Invalid limiter identity'; END IF;
  bucket_key := 'user-action:' || _action || ':' || _user_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(bucket_key, 0));
  instant := clock_timestamp();
  SELECT coalesce(array_agg(t ORDER BY t), '{}') INTO hits_at
    FROM public.rate_limit_hits r, unnest(r.request_times) t
    WHERE r.bucket = bucket_key AND t > instant - interval '60 seconds';
  IF cardinality(hits_at) >= 5 THEN
    remaining_seconds := greatest(1, ceil(extract(epoch FROM hits_at[1] + interval '60 seconds' - instant))::integer);
    RETURN jsonb_build_object('allowed', false, 'retry_after', remaining_seconds);
  END IF;
  INSERT INTO public.rate_limit_hits(bucket, hits, window_start, request_times)
    VALUES (bucket_key, cardinality(hits_at) + 1, instant, array_append(hits_at, instant))
  ON CONFLICT (bucket) DO UPDATE SET hits = EXCLUDED.hits, window_start = EXCLUDED.window_start, request_times = EXCLUDED.request_times;
  RETURN jsonb_build_object('allowed', true, 'retry_after', 0);
END $$;
REVOKE ALL ON FUNCTION public.user_action_rate_limit(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_action_rate_limit(uuid,text) TO service_role;

-- Email uses PostgREST directly, so enforcement belongs in a DB trigger.
CREATE FUNCTION public.limit_email_send() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NEW.type <> 'send' OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.created_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Invalid sender'; END IF;
  result := public.user_action_rate_limit(auth.uid(), 'email-send');
  IF NOT (result->>'allowed')::boolean THEN
    RAISE SQLSTATE 'PGRST' USING
      MESSAGE = jsonb_build_object('code','RATE_LIMITED','message','Máximo de 5 envios por minuto. Aguarda antes de tentar novamente.','details',null,'hint',null)::text,
      DETAIL = jsonb_build_object('status',429,'headers',jsonb_build_object('Retry-After',result->>'retry_after'))::text;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.limit_email_send() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER limit_email_send BEFORE INSERT ON public.email_commands FOR EACH ROW EXECUTE FUNCTION public.limit_email_send();
