# SENVIA OS 26.4.0 — release on 2026-09-13

The user explicitly authorized publication of all prepared changes, after deferring Stripe sandbox tests. Terms and the automation module remain deferred as previously requested.

## Included

- Email mobile editor, draft/send/error handling, individual-message selection, folder counts and recipient suggestions. Direct email-body loading had already been deployed with earlier authorization.
- Dedicated referral area, shareable invitation link, payment/bonus statuses and accumulated free months. The simulation controls remain development-only.
- Single displayed EUR 49 monthly plan with the existing contracted user allowances and EUR 5 extra users retained. Ecommerce navigation/routes hidden.
- Five accepted operations per rolling minute, per authenticated user and action; mailbox reads/polling and trusted callbacks excluded.
- Otto clipboard/drop attachments, safe private attachment loading and image/text transport. PDF end-to-end support still depends on an isolated OpenClaw document endpoint; the shared VPS configuration was not changed.
- Upgrade modal crash and news-bell navigation fixes.
- Stripe customer/organization binding used by the webhook, checkout, portal, subscription check, plan reconciliation and extra-seat management. Only confirmed paid invoices record the first payment. Seat updates persist after Stripe acceptance.

## Database and financial verification

Six migrations applied atomically: 20260912090000, 20260912091000, 20260912092000, 20260912093000, 20260913100000 and 20260913110000. A private before-release snapshot is retained in the ignored local review directory.

BDS Telecomunicações is registered as referred by Escolha Inteligente, pending first payment. No bonus was fabricated. The legacy customer binding was reviewed by matching paid Stripe invoice IDs to CRM sales for Escolha Inteligente. That Stripe account has no active subscriptions; the historical base subscriptions are canceled and two other attempts are incomplete_expired. Therefore no active subscription needed a price migration or reactivation. Existing CRM access was preserved.

The live EUR 49 base and EUR 5 seat prices are active EUR monthly prices. The enabled webhook points to the current Supabase project and already includes all referral invoice/subscription events. The authenticated read-only health report found no missing recent invoice records. These checks are not a substitute for the deferred sandbox payment/renewal test.

## Validation

- Frontend production build passed. Root TypeScript check passed; the full app check matches the recorded existing baseline (115 errors) with no new diagnostics.
- 76 automated checks passed across referral ledger/SQL, actual HTTP handler routing with mocked transports, tenant checks, seat billing errors, recipient history, UI rules, attachments and plan migration policy.
- Deno typechecks passed for all 23 deployed action/function entrypoints after correcting preexisting type errors in three consumers.
- No real payment, invoice, email, subscription reactivation or mailbox mutation was performed during release verification.

## Deployment

Database migrations and referral association applied. All 23 release functions were deployed, plus the updated read-only stripe-health inventory. Frontend publication uses main and targets https://app.senvia.pt with APP_VERSION 26.4.0.
