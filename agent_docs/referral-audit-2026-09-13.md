# Referral module audit — 13 September 2026

Status: production release authorized by the user on 2026-09-13, after explicitly deferring sandbox payment tests. Local checks passed, reviewed customer binding and referral migrations were applied. Real Stripe test payment/free-renewal verification remains pending. See release-26.4.0.md for deployment outcome.

## Corrected findings

| Priority | Finding and concrete failure | Local correction |
| --- | --- | --- |
| P1 | A paid invoice with referral metadata could consume a reward even when the coupon produced no discount. Unrelated charges or an already-free subscription line could trigger the same problem. | Retrieve the current invoice with expanded discounts; require an actual positive discount from the referral coupon before redemption. Check eligible, discountable plan/seat lines, including pagination and Basil price shapes, before reserving a month. Validate the coupon's percentage, duration and exact allowed products. |
| P1 | A failed coupon application followed by invoice finalization could leave a month reserved indefinitely. A deletion replay also cleared redemption history. | Reconcile `invoice.finalized`, paid and current terminal states. Release only unredeemed reservations when no effective discount exists. Preserve redeemed history. Add `invoice.finalized` to the release webhook subscriptions. |
| P1 | A delayed event for an old subscription, or a slow earlier fetch, could overwrite the current billing snapshot and next-renewal forecast. | Service-only `sync_referral_billing` locks the binding, rejects obsolete observations and prevents a canceled/replaced subscription from overwriting the current subscription. Retrieve current Stripe invoice/subscription state rather than trusting an old event payload. |
| P1 | Repeated/concurrent checkout requests could create independent checkout sessions before any subscription became active. | Store a stable checkout attempt, expiration and exact parameters under a database row lock; pass that attempt as the Stripe idempotency key. Changed parameters are refused while the attempt is active. |
| P1 | A known SENVIA subscription without its expected customer binding was silently ignored, losing the first-payment signal. | A known subscription with missing binding now returns an error for Stripe retry; unbound legacy subscriptions remain an explicit migration prerequisite. |
| P2 | The interface was admin-only, while ordinary organization members could read the referral tables directly. | Restrict both SELECT policies to `is_org_admin`, retaining that helper's existing MFA and system-admin rules. Browser clients cannot write billing bindings, qualify rewards or claim checkout attempts. |
| P2 | Out-of-order payment deliveries displayed the arrival order as the first payment. | Keep the earliest confirmed invoice timestamp, reject timestamps before referral registration and retain exactly one reward per referred organization. |
| P2 | Replaying an invoice with a manually revoked or already-consumed reservation could return that reward again. | Reservation RPC explicitly refuses revoked/consumed rows rather than reviving them. |
| P2 | A subscription with paused collection still appeared eligible for a free next charge. | Record `collection_paused`, prevent reservation while paused, and show a saved-bonus explanation in the dashboard. Added this administrator preview scenario. |
| P3 | A missing/forbidden backend was polled indefinitely; a privilege change could retain transient preview state. | Stop automatic interval retries for unavailable/forbidden service responses and reset preview state on system-admin changes as well as account/organization changes. |

Implementation: `supabase/functions/_shared/referrals.ts`, `supabase/functions/create-checkout/index.ts`, `supabase/migrations/20260913110000_referral_audit.sql`, `src/lib/referral-dashboard.ts`, `src/lib/referral-preview.ts`, and `src/components/settings/ReferralProgram.tsx`.

## Follow-up: legacy billing routing corrected locally

Removed findOrgByEmail and threaded the service-owned customer binding through plan/access, payment, sales and commission handlers. Fresh Stripe objects are retrieved before handling legacy events. Missing bindings or conflicting organization/customer metadata fail for retry instead of choosing an arbitrary member organization. A replaced subscription cannot clear the current plan; a settled invoice cannot be marked failed by an earlier event. Historical paid invoices retain their original tenant for accounting without updating current access or recurring sale state. Current cancellation works even when Stripe has deleted the customer email.

Checkout/subscription activation no longer marks first_paid_at. Only a confirmed positive invoice in the qualification path records the earliest first payment timestamp. Checkout now also synchronizes its subscription binding. The six HTTP-handler regression checks execute the actual webhook with substituted external transports and signature verification; they do not verify real Stripe signatures.

Access checks on September 13: the available browser opens Stripe at its login page, no test secret exists in the process environment or workspace .env, and no Stripe connector is installed. A read-only production aggregate query found organization_billing_accounts and get_referral_dashboard absent, with one organization having billing history. No reviewed Stripe customer ID can be inferred from that aggregate; existing bindings still need verification from the Stripe account.

## Verification

- 54 automated checks passed across the referral webhook, real migrated embedded PostgreSQL, dashboard rules and preview fixtures. The SQL suite executes the actual webhook helper against actual tables/RPCs; only Stripe transport is substituted.
- Coverage includes tenant isolation, direct non-admin reads, known binding loss, coupon restrictions, actual discount verification, pagination, failed application/finalization, replay, earliest payment, obsolete subscription snapshots, reserved/revoked/consumed months, checkout-attempt reuse/expiration and invitations to an existing organization.
- Browser tests of the actual panel at 1280 px and 390 px passed: real/error states, simulation entry/exit, pending/accumulated/reserved/used/annual/canceled/exempt/paused scenarios, clipboard, hidden ordinary-admin controls and no horizontal overflow.
- Deno checks for the Stripe webhook, checkout and portal passed. Vite production build passed. Full-app TypeScript remains at the previously recorded baseline; it is not a clean project-wide typecheck.
- No real Stripe sandbox credentials are configured in this session. A subsequent authorized production release used the existing cron-authenticated stripe-health service to read live prices, invoices, subscriptions and webhook event coverage without exporting credentials. These tests do not establish live payment delivery or deployed webhook registration.

## Deployment prerequisites

Apply the prepared referral migrations in order: `20260912090000_referral_program.sql`, `20260913100000_referral_billing.sql`, then `20260913110000_referral_audit.sql`. Review dependencies of the shared authorization/rate-limit helpers before deploying their consumers. Register checkout.session.completed, customer.subscription.created/updated/deleted, and invoice.created/finalized/paid/payment_failed/voided/deleted events. Backfill reviewed bindings for existing Stripe customers before enabling checkout/portal for those organizations. Validate the routing fix with Stripe test-mode events before activation. Also verify checkout retry behavior near session expiration against Stripe, including a failed initial session-create request. Do not run the single-plan customer migration as part of this audit.

Refund/chargeback reversal policy is still unspecified; no new forfeiture policy was invented or activated.

## Primary references checked

Stripe explicitly documents out-of-order and duplicate webhook delivery: [webhook delivery behavior](https://docs.stripe.com/webhooks). Expanded discounts identify the actual coupon: [Discount object, Basil API](https://docs.stripe.com/api/discounts/object?api-version=2025-08-27.basil). Invoice totals and discount amounts are distinct from metadata: [Invoice object](https://docs.stripe.com/api/invoices/object).
