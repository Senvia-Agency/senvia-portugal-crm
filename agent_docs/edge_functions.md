# Edge Functions Reference — Senvia OS

All functions live in `supabase/functions/{name}/index.ts` (Deno runtime). Deployed **manually** via `supabase functions deploy <name> --project-ref chhmfwlimtbsyjmgtokn` (they do NOT auto-deploy; Lovable is no longer used). Most have `verify_jwt = false` in `config.toml`.

## Stripe & Payments

| Function | Trigger | Purpose |
|----------|---------|---------|
| `stripe-webhook` | Stripe webhook | Handles `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated/deleted`. Creates commission records and sale_payments. |
| `reconcile-stripe-payments` | Cron (daily 04:30) | Safety net: lists paid Stripe invoices from the last 10 days and records any missed by the webhook (sale_payments, commission, sale renewal fields). Idempotent — dedupes on `sale_payments.stripe_invoice_id` (unique index). Mirrors `handleInvoicePaid` in stripe-webhook; keep in sync. Auth: `x-cron-secret` header. |
| `stripe-health` | Cron (daily 04:45) + on demand | Read-only audit of the whole Stripe ↔ CRM integration: webhook endpoint config and event delivery, paid invoices without a CRM payment row, live subscriptions vs organization rows. Writes nothing. Auth: `x-cron-secret` header. |
| `create-checkout` | Client call | Creates Stripe Checkout session for subscription. |
| `customer-portal` | Client call | Creates Stripe Customer Portal session. |
| `check-subscription` | Client call | Verifies org subscription status against Stripe. |
| `admin-stripe-stats` | Admin call | Fetches Stripe metrics for system admin dashboard. |

## Invoicing (InvoiceXpress, KeyInvoice and Vendus)

| Function | Purpose |
|----------|---------|
| `issue-invoice` | Issues FT through the active provider. Vendus uses a stable `tx_id` per sale and verifies the returned fiscal total. KeyInvoice writes a durable, idempotent local ledger row before the remote call. |
| `issue-invoice-receipt` | Issues FR only after the sale is marked paid and confirmed unreversed payments cover its gross amount. Vendus uses the same sale `tx_id` as FT to prevent both document kinds for one sale. |
| `generate-receipt` | Issues a receipt for a confirmed payment (Vendus `RG`, InvoiceXpress `RC`). KeyInvoice and Vendus reserve the amount atomically so concurrent partial receipts cannot exceed the FT. |
| `cancel-invoice` | Cancels/voids a document with the `finance.invoices.cancel` permission; KeyInvoice preserves the generated fiscal adjustment identity. |
| `create-credit-note` | Creates NC against an issued source document. Partial KeyInvoice NC remains blocked until its demo API contract is homologated. |
| `send-invoice-email` | Sends a fiscal PDF manually. Automatic recurring delivery uses the protected system flow and Brevo. |
| `get-invoice-details` | Fetches details/PDF from the document's actual provider; the local invoice UUID disambiguates equal provider IDs. |
| `sync-invoices` | Syncs InvoiceXpress and Vendus FT/FR/RG with provider-aware identity; it never guesses a series or overwrites a frozen local document. |
| `sync-credit-notes` | Syncs credit notes from InvoiceXpress. |
| `sync-invoicexpress-items` | Syncs product catalog from InvoiceXpress. |
| `update-invoicexpress-item` | Updates a product in InvoiceXpress. |
| `keyinvoice-auth` | Validates KeyInvoice credentials and caches the SID without returning it to the browser. |
| `keyinvoice-fiscal-worker` | Cron worker with `issue`, `email`, and `reconcile` actions. Claims durable recurring jobs, stores PDFs, sends idempotent Brevo email, and reconciles ambiguous FT/FR writes without blind reissue. |

## Email & Marketing

| Function | Purpose |
|----------|---------|
| `send-template-email` | Sends email using org's email template via Brevo. |
| `send-access-email` | Sends team member access/invite email. |
| `send-proposal-email` | Sends proposal to client via email. |
| `sync-email-statuses` | Syncs email delivery statuses from Brevo. |
| `sync-campaign-sends` | Syncs campaign send records. |
| `brevo-webhook` | Receives Brevo delivery/bounce/click webhooks. |
| `process-scheduled-campaigns` | Sends campaigns scheduled for now. |

## Automations & Scheduling

| Function | Purpose |
|----------|---------|
| `automation-engine` | **Flow engine.** Interprets the node graph of `automation_flows`. Three actions: `enroll` (a trigger fired — enrol the contact and run until it parks), `tick` (cron each minute — wake runs whose `wake_at` passed), `reply` (an inbound WhatsApp message — resume the run parked on `wait_reply` and branch by keyword, or start a `whatsapp_keyword` flow). Auth: service-role bearer or `x-automation-secret`. |
| `process-automation` | **Legacy** single-step automations (one email template + a stamped trigger). Runs alongside the engine until every org has migrated its flows. |
| `process-automation-queue` | Processes queued legacy automations where `scheduled_for <= now()`. |
| `check-renewal-automations` | Finds sales due for renewal today/in 2 days, triggers email automations. |
| `check-reminders` | Processes due reminders and sends notifications. |
| `check-fidelization-alerts` | Checks client fidelization period expiry. |
| `generate-recurring-expenses` | Creates monthly copies of recurring expenses. |

## Subscriptions & Trials

| Function | Purpose |
|----------|---------|
| `check-trial-status` | Checks and updates trial expiration status per org. |
| `cleanup-expired-trials` | Downgrades/blocks orgs with expired trials. |

## Leads & Prospects

| Function | Purpose |
|----------|---------|
| `submit-lead` | Public API: creates a lead from external form. |
| `update-lead` | Updates lead fields (used by automations). |
| `generate-prospects` | Scrapes prospects via Apify and imports them. |
| `check-prospect-job` | Polls Apify job status and imports results when complete. |

## Team Management

| Function | Purpose |
|----------|---------|
| `create-team-member` | Creates new user + org membership + sends invite. |
| `get-team-members` | Lists team members for an org. |
| `manage-team-member` | Updates/deactivates team member. |

## Notifications

| Function | Purpose |
|----------|---------|
| `send-push-notification` | Sends web push notification via VAPID. |
| `notify-finance-request` | Notifies admins of new finance requests. |
| `notify-request-status` | Notifies requester of status change. |

## Other

| Function | Purpose |
|----------|---------|
| `otto-chat` | AI chat assistant (Otto) using Claude API. |
| `meta-capi-event` | Sends conversion events to Meta Conversions API. |
| `store-api` | Public e-commerce store API (products, orders). |

## Cron Jobs (pg_cron via Supabase Dashboard)

These functions are called periodically via `pg_cron` + `pg_net`:
- `check-renewal-automations` — daily, checks renewal dates
- `check-reminders` — periodic, processes due reminders
- `check-trial-status` — daily, expires trials
- `cleanup-expired-trials` — daily cleanup
- `process-automation-queue` — frequent, processes scheduled automations
- `process-scheduled-campaigns` — frequent, sends due campaigns
- `generate-recurring-expenses` — daily at 06:00, generates monthly recurring expenses
- `sync-email-statuses` — periodic, syncs Brevo delivery statuses
- `keyinvoice-fiscal-worker` — issue every 5 minutes, PDF email offset by 2 minutes, reconciliation daily at 04:50 UTC (installed by migration `20260924120000`)
