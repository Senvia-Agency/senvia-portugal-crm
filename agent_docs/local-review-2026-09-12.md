# Local review — 12 September 2026

Branch: `codex/revisao-local-inbox-indicacoes`, based on `d022e06c`. No changes have been pushed, deployed, applied to the production database, or applied to Stripe subscriptions. Existing unrelated work in `.omo/` and the user's `AGENTS.md` was preserved.

## Implemented locally

- Email composer: 16 px mobile editing to avoid focus zoom, visual viewport sizing, serialized draft saves, duplicate-send guards, recipient validation, forwarded attachment loading protection and honest queued-send notification.
- Otto: paste images/files, drag and drop, previews/removal, bounded uploads, organization-scoped chat history, private Storage resolution into actual model image/text content, explicit PDF transport support, and preserved OpenClaw tool-call history. Attachments are treated as untrusted data. No arbitrary public URLs are fetched.
- Ecommerce navigation and routes hidden; module reports disabled.
- One displayed monthly plan at EUR 49; existing contracted user counts and EUR 5 extra-seat pricing retained. Old plan IDs remain internally to retain 5/15/unlimited user allowances.
- Referral signup attribution, admin dashboard and cumulative reward ledger. First positive payment qualifies one reward. One monthly renewal consumes one reward, including seat add-ons; the coupon is restricted to SENVIA subscription products. Annual subscriptions bank rewards until monthly billing begins.
- Rolling five requests per minute per authenticated user AND action for protected send/paid operations. Otto's two endpoints share one bucket. Read/poll traffic is excluded; existing stricter prospect and organization quotas remain. Limiter errors fail closed.

## Verified access and operational boundary

GitHub Senvia access, Supabase SQL read access on `chhmfwlimtbsyjmgtokn`, Vercel team/project access and SSH host `senvia` were verified. Credentials were not committed.

The VPS runs OpenClaw 2026.7.1-2; Otto uses its own agent workspace and model. The shared `openclaw.json` has the chat-completions endpoint enabled and the responses endpoint disabled. It was read selectively and was NOT modified. No service was restarted.

PDF end-to-end operation remains pending: the adapter supports the documented OpenResponses file format, but that endpoint is not enabled on the shared gateway. Default transport remains chat completions, so PDF requests fail explicitly with instructions instead of pretending the file was read. Images and text use the current transport. A future PDF deployment must use an isolated Otto document endpoint or another scoped adapter; do not enable a global gateway endpoint by blindly editing shared configuration. Any eventual Otto-only JSON edit requires a private timestamped backup, validation and a diff proving all other keys unchanged. Keep tokens out of logs and reports.

## Local verification

- Production Vite build passed (existing chunk-size warnings).
- Root TypeScript command passed. The actual app TypeScript project has 115 pre-existing errors; compared with a pristine worktree at the same base, the diagnostics were identical. This is not a clean full-project typecheck.
- Deno typecheck passed for Otto, checkout and Stripe webhook.
- All 19 Node regression checks passed and cover attachment/path validation, input/email helpers, Stripe reward replay/failure handling and migration policy.
- Five isolated PGlite PostgreSQL tests passed for referral isolation/qualification/reservation and rolling rate-limit/email enforcement. No production SQL was used by these tests.
- An isolated browser fixture passed paste + drop + mocked upload/request + streamed response, 16 px email mobile editing/no horizontal overflow and referral rendering. This does NOT verify real SMTP, Stripe payment delivery or VPS model responses.

## Review locally

The regular app is running at `https://localhost:8080/` (`npm run dev`, port 8080). Its existing environment points at the live Supabase project: new backend migrations/features are not available there until a release is authorized. Do not mistake the frontend dev server for a separate database.

A temporary isolated demo is running at `http://127.0.0.1:8081/?screen=otto` (also `screen=email`, `screen=referrals`; no screen for pricing). `.local-review/` is excluded from git. It uses mocked data and blocks external requests during browser verification. Screenshots are there for review.

## Remaining release work — only after the user says "pulicar"

1. Review and apply the four local SQL migrations; regenerate Supabase types. Verify RLS with two separate organizations in a staging environment.
2. Deploy dependent edge functions together, including functions importing the changed authorization helper, and verify webhook subscriptions include `invoice.created`, `invoice.paid`, `invoice.voided` and `invoice.deleted`. Test real payment/retry flows in Stripe test mode before live activation.
3. Review current Stripe subscription inventory using `scripts/migrate-single-plan.mjs` in read-only mode. Snapshots go to the OS temporary directory. `--apply` is separately gated by `SENVIA_RELEASE_APPROVAL=pulicar`; it has not been run. Monthly base items change without proration. Simple annual contracts transition at renewal; existing schedules, annual cancellation/discount/tax settings and mixed intervals require individual review. Never overwrite these automatically.
4. Resolve Otto's PDF transport without changing the shared Cactus gateway. Validate actual image/PDF responses and authorized support tool use against an isolated organization.
5. Publish the frontend only after user localhost review. Prepare the version announcement as part of that release; no production announcement was inserted.

Refund/chargeback reward reversals have no agreed policy. Automated enforcement currently covers the enumerated action endpoints, not every direct database mutation or public webhook. Terms and the automations module are deliberately deferred until working with the user.


## Follow-up — 13 September 2026: navigation crash

The user found a runtime regression missed by the initial isolated feature previews: both navigation components mount `UpgradeModal` closed with `requiredPlan: ''`. Its old fallback accessed `STRIPE_PLANS[1]`, which no longer exists in the single-plan catalog. Reading `.name` then crashed the authenticated layout, even before opening a modal. The earlier successful build did not prove this render path worked.

Corrected `UpgradeModal` to use the named canonical `SENVIA_OS_PLAN`, independent of an empty or legacy tier name; updated its copy for the single offer. Searched all other indexed plan consumers: pricing indexes previous items only inside a non-first iteration, and Billing/Team next-plan reads are guarded by catalog bounds.

Verification: six automated regressions render the actual closed modal with empty, Starter, Pro, Elite, current and unknown names. An isolated browser additionally mounted the actual `MobileBottomNav` and `AppSidebar`, ran 12 open/close cycles, verified EUR 49 and the correct checkout price argument, and recorded no uncaught browser errors. API hooks were mocked; no checkout or production writes occurred. This fixes the reported crash and does not imply the broader release or live Otto PDF flow is complete.

## Follow-up — 13 September 2026: bell and email queue

The bell was wired to the announcement popup store instead of the `/novidades` page. It is now a router link to the release history, including when no popup announcement is active. Mobile header and desktop sidebar were verified in the browser against the real page with isolated data.

Read-only production checks showed the reported send command completed on 13 September at 07:15:46 UTC. This establishes SMTP submission as recorded by the worker, not recipient delivery. The three reported failures were `fetch_body`, a command missing from the gateway dispatcher. The deletion batch was still draining when first inspected; all 88 deletion commands in that interval had completed by 07:18:39 UTC. No failed sends or deletions were replayed by this work.

The Notification folder had 25 cached messages and four unread at first inspection. The unread list then contained three messages in one thread, while a read-mark command updated that folder. The old UI showed only the newest message per thread and counted individual messages. The list now renders each message individually, matching selection and visible counts.

Additional local fixes:
- Durable pending/processing queue indicator; updates on command changes and polling.
- Body reads refresh when message/command updates arrive.
- A `fetch_body` failure no longer restores unrelated optimistic deletions.
- The generic claim that the mailbox was unchanged was removed: other actions may have succeeded.
- Unsupported body-read commands have an actionable error message and no longer show an endless loading state after a recorded failure.

Browser verification passed: bell navigation with/without an active announcement, four same-thread messages displayed separately, selecting/deleting all four queued four distinct message IDs, pending deletions stayed hidden despite an unrelated body failure, and queue progress was visible. External network calls were blocked and writes were mocked. The Vite build passed. Full-app TypeScript diagnostics remained identical to the pre-existing baseline.

`scripts/gateway-patches/fetch-body.patch` and its README contain the prepared backend compatibility fix and validation. The patch was tested against a read-only copy of the actual source with fake dependencies; no VPS file, gateway service, OpenClaw configuration or production data was changed. The active email worker deployment must be located and the patch applied only after production authorization. Until then localhost still reaches the unpatched backend and real body fetching can continue to fail.

## Resolution — direct Supabase email reading, 13 September 2026

The user explicitly authorized application of the email fix. No general frontend/billing/referral release was authorized. The VPS contains OpenClaw; no VPS service was changed. The repository already included a newer gateway handler; the older VPS source copy was not evidence of the active deployment. The previous patch was superseded and removed.

Deployed the new authenticated `email-fetch-body` Supabase function and applied only `20260913090000_email_body_cache.sql`. The local frontend now invokes that function directly. Message RLS enforces mailbox access/MFA before server-only credentials are read; the cache RPC is inaccessible to anon/authenticated roles. Reads use verified IMAP TLS, public address checks, a read-only mailbox and a 15 MB limit. No mail was sent, moved or deleted during verification. No private credentials or message content were committed; temporary credential/content fixtures were removed.

Validation: Deno check; PGlite transaction/replay/role tests; real IMAP read of the user's five-character test message; live cache RPC replay; deployed anonymous request rejected with 401; browser test confirmed the real frontend calls the new endpoint, refreshes its query and displays content without queueing `fetch_body` (API mocked in browser test). The authenticated deployed Edge-to-IMAP path still needs observation when the user opens an uncached email. Vite build passed and app TypeScript diagnostics match the baseline.

Old `fetch_body` errors are hidden once their message body is confirmed cached; audit records remain in the database. The local UI is ready for reload at https://localhost:8080/. Vercel/frontend publication and every other migration remain pending.

## Sent recipient autocomplete — 13 September 2026 (local only)

The composer now merges sent-recipient history with existing CRM/contact suggestions in To, Cc and Bcc. It reads only recipient headers from the latest 1,000 cached Sent messages and recipient JSON projections from the latest 1,000 successful sends authored by the signed-in user. Pending/failed sends and other users' Bcc recipients are excluded. No new table, migration, localStorage copy or deployment is required. Historical messages not yet synchronized into the CRM are outside this history window.

A five-minute React Query cache is shared by composer fields and scoped to mailbox, organization and user; successful send and message realtime events invalidate it. Search matches names/addresses without case or accent distinctions, prefers sent history, deduplicates addresses and excludes already-selected recipients. Remote CRM searches are debounced. The dropdown supports mouse, keyboard and accessible combobox semantics.

Validation: four node:test regressions for ordering/normalization, matching, query scope, private Bcc and failed-send exclusion; actual hook/composer browser tests with isolated API fixtures at 1280 px and 390 px (To/Cc/Bcc selection, accent search, keyboard/mouse, duplicates, shared cache, reload). Build passed; TypeScript diagnostics match the existing baseline. No test mail was sent and this frontend change has not been published.

## Referral completion follow-up — 13 September 2026 (not activated)

The previous embedded billing card was not usable against the live backend: the RPC was not deployed. Do not describe the feature as operational. A dedicated Settings > A Minha Conta > Indicações tab and billing shortcut now show a copyable link, per-company signup/first-payment dates, separate available/reserved/used month counts, and a next-renewal explanation. Exempt organizations, annual plans, cancellation, missing subscription data and unavailable backend have explicit states. Stale balances are not shown as confirmed after an RPC error.

Schema validation found a real implementation defect: the prepared checkout/referral/portal functions referenced organizations.stripe_customer_id, which does not exist in the live schema. New local migration 20260913100000_referral_billing.sql creates a service-only organization_billing_accounts table with unique customer/subscription bindings and a safe admin-only billing summary in get_referral_dashboard. Checkout and portal now use this binding. The referral webhook retrieves current subscription state, verifies the invoice customer and any organization metadata against the binding, and updates renewal/cancellation status. Previously paid organizations without a reviewed binding cannot create another checkout.

Verification: actual referral webhook helper executed against the migrated PGlite SQL schema (Stripe transport substituted), covering payment qualification, duplicate delivery, discount reservation, dashboard state, redemption and void release. Private billing mapping grants/uniqueness and tenant isolation checked. Seven UI-state regressions and browser verification at 1280/390 px covered active, exempt, annual, reserved, empty, backend missing/offline, clipboard and overflow. Deno checks passed for checkout, portal and Stripe webhook. Full-app TypeScript remains at the baseline apart from shifted source line numbers.

Release boundary: no referral migration or billing function has been published. Activation requires the referral_program and referral_billing migrations, dependent authorization/rate-limit migrations if deploying current shared imports, compatible checkout/portal/Stripe webhook releases, reviewed Stripe customer bindings for legacy organizations, and subscription.created/updated/deleted plus invoice.created/paid/voided/deleted webhook events. The frontend remains local. Real Stripe test-mode payment validation and the legacy binding inventory are still release prerequisites; isolated tests are not proof of a live Stripe checkout. Do not run the single-plan customer migration as part of this referral activation.

## Local administrator simulation — 13 September 2026

The real Indicações page now has a development-only, super-admin-only “Testar como organização pagante” control. It works even when the live referral RPC is absent and lets the administrator view the unchanged customer dashboard with nine disposable scenarios: empty, awaiting payment, first payment, accumulated months, reserved reward, consumed reward, annual subscription, cancellation and billing exemption.

An explicit simulation banner and non-routable example.invalid invitation link distinguish this from real customer data. Simulation disables referral queries/polling, never writes billing data, and uses no persistent storage or query-cache replacement. Exiting restores the actual organization result, including exemption or backend-not-activated state. Account/organization changes remount the panel to discard simulation state. Controls are absent from production builds and ordinary organization-admin sessions.

Verified with nine preview/dashboard unit regressions and real component browser tests at 1280/390 px: entry despite RPC failure, scenario switching without more backend requests, copying only the invalid demo link, no overflow, returning to real exempt state, and ordinary-admin controls hidden. This is a visual/behavioral preview, not a Stripe test transaction or live referral activation.

## Referral audit — 13 September 2026

See referral-audit-2026-09-13.md for corrected findings and verification. Local audit migration 20260913110000 adds guarded snapshot updates, protected checkout attempts, admin-only reads, earliest-payment handling and reservation replay protection. The webhook verifies actual discounts, eligible line items, current invoice state and coupon configuration; it reconciles finalization failures. Paused collection and unavailable-service polling were corrected in the panel. Nothing was applied or published.

Release remains blocked by legacy billing organization selection in stripe-webhook/index.ts (email plus first membership), reviewed legacy customer bindings, and real Stripe sandbox validation. The referral helper's fixes do not fix every independent legacy billing branch.


## Stripe validation follow-up (2026-09-13)

Corrected legacy email-based organization routing in the local Stripe webhook. Current customer/subscription binding is passed through plan, access, payment, sale and commission handlers; late cancellation/failure events are guarded and missing bindings fail for retry. Checkout activation no longer fabricates a first payment. Added HTTP-handler and resolver regressions; updated the local audit SQL to persist earliest confirmed first payment. See referral-audit-2026-09-13.md for validation and pending real Stripe sandbox access. Read-only live aggregate found one organization with billing history and no new billing bindings/referral dashboard deployed. Stripe browser is signed out and local test credentials are absent. No production mutations or Stripe financial actions in this follow-up.
