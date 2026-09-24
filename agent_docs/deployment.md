# Deployment — Senvia OS

## Overview

| Component | Platform | Trigger | Branch |
|-----------|----------|---------|--------|
| Frontend (React SPA) | Vercel | Auto-deploy on push | `main` |
| Edge Functions (Deno) | Supabase | **Manual** `supabase functions deploy` | N/A |
| Database migrations | Manual | SQL Editor in Supabase Dashboard | N/A |
| Cron jobs | Supabase | pg_cron (configured in SQL Editor) | N/A |

## Deploy Steps

### Frontend deploy

```bash
git add <files>
git commit -m "Fix: description"
git push origin main
```

Vercel picks up the push to `main` automatically. No separate deploy command needed.

### Edge Functions deploy (manual)

Edge Functions do **not** auto-deploy. Deploy each changed function explicitly:

```bash
supabase functions deploy <name> --project-ref chhmfwlimtbsyjmgtokn
```

Requires a Supabase access token with privileges on the project.

### Database changes

Run SQL directly in **Supabase Dashboard > SQL Editor**. There is no CLI-based migration runner.

For new tables, always:
1. Create the table with correct types
2. Enable RLS: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
3. Create SELECT/INSERT/UPDATE/DELETE policies using `is_org_member()` pattern
4. Add indexes for columns used in WHERE/JOIN clauses
5. Document in `agent_docs/database_schema.md`

### Version bumps

1. Update `APP_VERSION` in `src/lib/constants.ts`
2. Create announcement via SQL:
```sql
INSERT INTO app_announcements (id, title, content, version, is_active, published_at)
VALUES (gen_random_uuid(), 'Title', 'Markdown content', 'vX.Y.Z', true, now());
```
3. Commit and push

## Environment

### Vercel

- Auto-deploys from `main` branch
- SPA routing via `vercel.json` rewrites (catch-all to `/index.html`)
- Service Worker files excluded from rewrite (`sw.js`, `service-worker.js`)
- No build-time env vars needed (Supabase config comes from `.env` baked at build)

### Supabase

- Project ref: `chhmfwlimtbsyjmgtokn`
- URL: `https://chhmfwlimtbsyjmgtokn.supabase.co`
- Edge Functions secrets managed in Supabase Dashboard > Edge Functions > Secrets
- Key secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BREVO_API_KEY`, `APIFY_API_TOKEN`
- KeyInvoice credentials are per organization in protected `organizations` columns. `KEYINVOICE_ALLOWED_HOSTS` is optional and may only add approved API hosts; the official production/demo hosts are built in.
- Vendus credentials are per organization: `vendus_api_key` is write-only to browser roles. Settings validates the entered or saved key through `vendus-options` and permits saving it even when the account returns no registers or payment methods. Both IDs are optional and selected only from Vendus responses. FT omits `register_id` when no register is selected; FR and RG additionally require an active payment method. Users never need to find or type IDs. The API key belongs to a Vendus user with document permissions. Apply `20260924120000_keyinvoice_recurring_fiscal_ledger.sql` first, then `20260924130000_vendus_fiscal_provider.sql` in SQL Editor before serving the Vendus frontend. Deploy `vendus-options`, `issue-invoice`, `issue-invoice-receipt`, `generate-receipt`, `get-invoice-details`, `sync-invoices`, `sync-credit-notes`, `cancel-invoice`, `create-credit-note`, and `send-invoice-email` manually to the active project. Validate with Vendus test mode or a designated test account before enabling live issuance for an organization.

### Cron Jobs (pg_cron)

Configured via SQL in Supabase Dashboard. Pattern:

```sql
SELECT cron.schedule(
  'job-name',
  '0 6 * * *',  -- cron expression
  $$
  SELECT net.http_post(
    url := 'https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/function-name',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Requires `pg_net` and `pg_cron` extensions enabled.

#### Cron jobs that require a secret

`reconcile-stripe-payments` and `stripe-health` reject unauthenticated calls. Their
shared secret lives **only in Supabase Vault** (`stripe_cron_secret`) and is compared
by `public.verify_stripe_cron_secret(text)` (SECURITY DEFINER, `service_role` only),
so it is never stored in an env var, a cron definition, or this repo. Cron jobs pass
it like this:

```sql
headers := jsonb_build_object(
  'Content-Type', 'application/json',
  'x-cron-secret', trim(both from (
    select decrypted_secret from vault.decrypted_secrets where name = 'stripe_cron_secret'
  ))
)
```

To run either function by hand, use the same `net.http_post` shape from the SQL Editor.

#### Recurring KeyInvoice fiscal rollout

Apply this feature in this order so no worker can see a half-installed schema:

1. Run `supabase/migrations/20260924120000_keyinvoice_recurring_fiscal_ledger.sql` in the SQL Editor. It installs the durable ledger/RPCs and the three inactive-safe cron calls; existing recurrences remain `manual`.
2. Deploy every changed invoicing/Stripe/Brevo function, then deploy `keyinvoice-fiscal-worker` with `--no-verify-jwt`. The worker authenticates its cron request with the Vault `stripe_cron_secret` used by the existing protected crons.
3. In a KeyInvoice **demo** organization, configure explicit FT/FR/RC/NC series and run `_shared/keyinvoice.demo.test.ts` with `KEYINVOICE_DEMO_ENABLED=true` and demo-only credentials. The test refuses any host other than `demo.keyinvoice.com`.
4. Confirm FT, fully paid FR, partial/final RC, void/NC identity, PDF retrieval and email delivery/webhook. Keep retention and automatic/partial NC disabled until those exact demo responses are accepted.
5. Enable `fiscal_mode=automatic` on one test recurrence, observe issue/email/reconciliation queues, then expand tenant by tenant.

The migration creates no new table. Do not activate automatic fiscal mode before the migration, worker deployment, series setup, Brevo sender verification and demo lifecycle all succeed.

> **Note:** `cleanup-expired-trials` requires a `CRON_SECRET` header that its cron job
> does **not** send, so that destructive purge is currently dormant. Verify the safety
> checks before re-arming it.

## Important Notes

- **Never push to `master`** — Vercel deploys from `main` only. A `master` branch exists but is not used.
- **Never use `--force` push** without explicit approval.
- **TypeScript check before push:** `npx tsc --noEmit --skipLibCheck`
- **No test suite exists.** Manual verification only.
- **Edge Functions deploy manually** via `supabase functions deploy <name> --project-ref chhmfwlimtbsyjmgtokn`. They do NOT auto-deploy. (Lovable is no longer used in this project.)

## Stripe Webhook Setup

The Stripe webhook endpoint is: `https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/stripe-webhook` (Stripe Dashboard endpoint name: `senvia-os`). An old endpoint pointing at the dead project `zppcobirzgpfcrnxznwe` may still exist in Stripe — it should be deleted, and the `STRIPE_WEBHOOK_SECRET` in Supabase must be the signing secret of the `senvia-os` endpoint.

Events handled: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.

Product-to-plan mapping is hardcoded in `stripe-webhook/index.ts`:
```
prod_U0wAc7Tuy8w6gA → starter
prod_U0wGoA4odOBHOZ → pro
prod_U0wG6doz0zgZFV → elite
```

Agency org ID (Senvia): `06fe9e1d-9670-45b0-8717-c5a6e90be380` — hardcoded in webhook for commission tracking.
