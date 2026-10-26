# Database Schema — Senvia OS

## Core Tables

### Authentication & Multi-tenancy

| Table | Purpose |
|-------|---------|
| `organizations` | Tenant root. Holds plan, niche, settings (sales_settings, form_settings, tax_config, integrations_enabled), fiscal-provider and WhatsApp credentials. |
| `profiles` | User profile. Links to `organization_id` (primary org). Has `full_name`, `avatar_url`. |
| `organization_members` | Many-to-many: users ↔ orgs. Holds `role` (admin/member), `commission_rate`, `is_active`. |

**RLS pattern:** All business tables use `organization_id` FK + policy `is_org_member(auth.uid(), organization_id)`.

### CRM Pipeline

| Table | Purpose |
|-------|---------|
| `leads` | Lead records. Has `status` (matches pipeline_stages.key), `assigned_to`, `source`, `organization_id`. |
| `pipeline_stages` | Customizable per-org. Has `key`, `label`, `order`, `is_final_positive`, `is_final_negative`. |
| `crm_clients` | Converted leads. Has `name`, `email`, `phone`, `company`, `nif` (tax ID), `company_nif`, and separate `company_address_line1`, `company_address_line2`, `company_city`, `company_postal_code`, `company_country` for company invoicing. `company_address_same_as_client` explicitly selects the contact address for company invoices; defaults to false. |
| `lead_labels` | Tags for leads. Many-to-many via `lead_label_assignments`. |
| `lead_imports` | History of CSV/bulk lead imports. |

### Sales & Payments

| Table | Purpose |
|-------|---------|
| `sales` | Sale records. Key fields: `code`, `total_value`, `status` (pending/in_progress/fulfilled/delivered/cancelled), `created_by`, `client_id`, `client_org_id`, `billing_target` (`client` or `company` for this sale; null uses the client preference on legacy rows), `payment_method`, `has_recurring`, `recurring_value`, `recurring_status`, `next_renewal_date`, `last_renewal_date`. |
| `sale_items` | Line items per sale. Links to `products` table. |
| `sale_payments` | Payment schedule/records. Fields: `amount`, `payment_date`, `status` (pending/paid), `payment_method` (mbway/transfer/cash/card/check/other), `invoice_reference`. **This is what appears in Finance > Payments.** |
| `products` | Org-level product catalog. Has `price`, `is_recurring`, `tax_value`. |
| `proposals` | Proposal documents. Linked to leads/clients. |

### Finance

Telecom commission timing: `operators.commission_payment_month_offset` configures a calendar-month offset (0 preserves immediate recognition). `sales.commission_payment_month_offset` and `commission_expected_date` record the applicable rule and expected month. A BEFORE trigger derives them from frozen per-line operator IDs in the same organization and the effective `activation_date` (also used when recording an installation; installed sales can fall back to the installation slot). Deferred dates use the first day only as a month marker, never as a promised payment day. Pending sales have no deferred receipt month. A mixed-operator sale uses the latest configured month. BDS Digi is M+2. Existing RLS on operators/sales is unchanged; no new tables. Financial period filters use this expected month; unfiltered totals exclude future deferred commissions. Actual receipt/payment flags remain separate.

| Table | Purpose |
|-------|---------|
| `expenses` | Expense records. Has `category_id`, `is_recurring`, `bank_account_id`. A recurring expense stores its schedule in `recurrence_frequency` (weekly/monthly/quarterly/yearly), `recurrence_day` (ISO weekday 1–7 when weekly, else 1–31, clamped to short months) and `recurrence_month` (yearly only); the trigger `expenses_recurrence_schedule` keeps `next_recurrence_date` from `expense_recurrence_next()` — browser saves cannot move it, only the service role (the generator). A schedule that starts (new, or switched back on) goes to its first due date on or after today (`expense_recurrence_upcoming`), so it never re-books past periods. |
| `expense_categories` | Org-level categories with `name`, `color`. |
| `bank_accounts` | Bank accounts for expense tracking. |
| `invoices` | Fiscal documents from InvoiceXpress, KeyInvoice or Vendus (after the local provider migrations are applied). |
| `credit_notes` | InvoiceXpress synced credit notes. |
| `stripe_commission_records` | Commission tracking for recurring Stripe payments. Fields: `sale_id`, `user_id` (salesperson), `client_org_id`, `amount`, `commission_rate`, `commission_amount`, `stripe_invoice_id`, `plan`, `status` (pending/paid). |
| `internal_requests` | Finance requests (advances, reimbursements). |

### Vendus fiscal provider (local migration 20260924130000)

`organizations.vendus_api_key` stores the API credential for server-side use.
The generated `tem_vendus_api_key` flag is readable by the browser, while the
key itself is excluded from its column-level SELECT grants. The optional
positive IDs `vendus_register_id` and `vendus_payment_method_id` select the
default register and payment method used to issue documents. Both IDs are
non-secret and readable subject to organization RLS. The existing `invoices`
ledger accepts `provider = 'vendus'`; its provider identity constraint and
unique provider/type/series/number index apply without a separate table. A
partial unique index allows at most one active Vendus RG per payment. Apply
this migration after the local KeyInvoice fiscal-ledger migration. The
service-role-only `reserve_manual_vendus_receipt` RPC locks the source FT,
checks the confirmed payment and remaining invoice value, and reserves each RG
before its Vendus API request.

### Recurring KeyInvoice fiscal ledger (local migration 20260924120000)

This migration is prepared locally and must be reviewed/applied before the
feature is enabled. It adds no table: `sale_recurring_cycles` is the commercial
schedule and `invoices` is both the durable fiscal outbox and immutable document
ledger.

- `sale_recurrences` selects `fiscal_mode` (`manual` or `automatic`) and the
  document policy. `invoice_then_receipt` queues an FT when the cycle becomes
  due and one RC for each confirmed payment. `invoice_receipt_when_paid` queues
  one FR only after paid payments cover the cycle. Existing recurrences remain
  manual. Email delivery is opt-in through `fiscal_auto_email` and
  `fiscal_email_config`. Automatic credit notes are reserved and rejected until
  the KeyInvoice demo contract is validated.
- Migration `20260925230000` adds `sale_recurrences.fiscal_auto_start_after`.
  When automatic issuance is activated, the boundary is the later of the
  Lisbon activation date and the latest existing cycle period start. Only
  cycles after that boundary may be queued or claimed. Existing automatic
  recurrences are backfilled conservatively, and their pending/retry jobs for
  older periods require manual reconciliation. This protects cycles invoiced
  outside Senvia, which are not necessarily represented in `invoices`.
- `organizations.keyinvoice_series_config` is an object keyed by `invoice`,
  `invoice_receipt`, `receipt`, and `credit_note`. Each value contains the exact
  KeyInvoice `provider_document_type_code` and `series`; optional validation
  metadata may be stored there, but never credentials. The series must already
  exist in KeyInvoice and be communicated to AT. SENVIA never constructs an
  ATCUD: `invoices.provider_atcud` only stores the value returned by KeyInvoice.
  FT uses KeyInvoice document type `4` and FR uses `34`; configuration and queue
  RPCs reject different values.
- `products` stores the exact `keyinvoice_product_id`, `price_includes_vat`, and
  `retention_rate`. New `sale_items` copy editable fiscal defaults (`tax_value`,
  exemption, VAT-in-price, retention, discount); historical rows are not
  rewritten. A recurring snapshot uses recurring product rows only. If a legacy
  sale has no recurring row, it creates an explicit synthetic recurrence line
  instead of billing one-time products again.
- Each snapshot freezes tenant/sale/cycle/payment IDs, Lisbon fiscal date,
  client identity/address, organization tax config, series/email config, totals,
  and line values. `sourceLineTotal` values sum exactly to the cycle amount;
  `billedUnitPrice` already allocates the discount and removes IVA once from the
  gross amount charged before KeyInvoice reapplies the frozen tax rate.
  Workers send `billedUnitPrice` and do not reapply discount or IVA. The snapshot
  cannot change after a job is claimed; provider identity and document links are
  immutable after assignment.
- `invoices` identifies a fiscal document by
  `(organization_id, provider, provider_document_type_code, provider_series,
  provider_document_number)`. Before issuance, the unique
  `fiscal_idempotency_key` protects retries. `invoicexpress_id` is nullable and
  remains only a provider/legacy numeric ID. A cycle has at most one FT/FR and
  one RC per payment. NCs require an issued source document and cannot exceed
  its remaining value.
- Issuance states are `pending`, `processing`, `issued`, `retry`, `failed`,
  `reconciliation_required`, `reconciling`, `manual_review`, `cancelled`, and
  `void` (`legacy` is retained for imported rows). Email states are
  `not_requested`, `pending`, `processing`, `sent`, `delivered`, `bounced`,
  `blocked`, `retry`, `failed`, and `suppressed`. Claims use `FOR UPDATE SKIP
  LOCKED`, attempt counters, UUID claim tokens, and explicit retry timestamps.
  A normal completion does not mark a row reconciled; only a completion claimed
  from `reconciling` records `reconciled_at`.
- The issue claim intentionally includes snapshots without an existing provider
  product mapping. The worker atomically owns the job, resolves/creates the exact
  product from the frozen code and values, and stores the resolved map in
  `raw_data`. This avoids unclaimed mapping jobs getting stuck silently. Invalid
  mappings go to manual review, transient failures retry, and ambiguous remote
  responses require reconciliation.
- `sale_payments` supports several partial payments per cycle and records Stripe
  payment/charge IDs plus reversal metadata. Net paid is
  `sum(max(amount - reversed_amount, 0))` for confirmed payments. A refund or
  chargeback does not reopen commercial debt or emit an NC automatically; it
  moves fiscal work to manual review. An RC already accepted remotely can still
  complete from the immutable pre-reversal snapshot so the local ledger never
  hides a real fiscal document.
- Authenticated configuration RPCs require MFA and the finance invoice-issue
  permission. Queue claims and completion/failure/reconciliation/email RPCs are
  service-role only. Direct authenticated writes to the fiscal ledger are
  revoked. Automatic mode additionally requires KeyInvoice to be the active and
  enabled provider with a configured credential. Switching to manual mode leaves
  a queued job dormant and preserves its idempotency key/snapshot; switching it
  back on resumes the same job. The worker endpoint uses actions `issue`, `email`, and `reconcile`;
  issue/email run every five minutes and reconciliation is scheduled at 04:50
  UTC (the worker must interpret fiscal dates in `Europe/Lisbon`).

The main service RPCs are:

```text
schedule_due_recurring_fiscal_documents(limit) -> integer
claim_recurring_fiscal_documents(limit, worker_uuid) -> setof invoices
complete_recurring_fiscal_document(invoice, claim, provider identity, raw/pdf) -> invoice
fail_recurring_fiscal_document(invoice, claim, error, retry|reconciliation_required|manual_review, retry_at) -> invoice
claim_fiscal_reconciliation(limit, worker_uuid) -> setof invoices
mark_fiscal_reconciliation_unresolved(invoice, claim, error) -> invoice
claim_fiscal_email_deliveries(limit, worker_uuid) -> setof invoices
complete_fiscal_email_delivery(invoice, claim, message_id) -> invoice
fail_fiscal_email_delivery(invoice, claim, error, retryable, retry_at) -> invoice
record_fiscal_email_event(message_id, event, event_at, payload) -> invoice
```

### Marketing

| Table | Purpose |
|-------|---------|
| `email_templates` | Reusable email templates with automation triggers. |
| `campaigns` | Email campaigns with scheduling. |
| `campaign_sends` | Individual send records per campaign. |
| `contact_lists` | Segmented contact lists for campaigns. |
| `automation_queue` | Queued automation actions with `scheduled_for`. |

### System

| Table | Purpose |
|-------|---------|
| `app_announcements` | Version update popups. Has `title`, `content` (Markdown), `version`, `is_active`, `expires_at`. |
| `calendar_events` | Per-org calendar. |
| `reminders` | Scheduled reminders for leads/sales. |

## Key Relationships

```
organizations ─┬── profiles (1:N via organization_id)
               ├── organization_members (1:N, links users to orgs)
               ├── leads (1:N)
               ├── crm_clients (1:N)
               ├── sales (1:N) ──── sale_items (1:N) ──── products
               │                └── sale_payments (1:N)
               ├── proposals (1:N)
               ├── expenses (1:N) ── expense_categories
               ├── stripe_commission_records (1:N)
               ├── email_templates (1:N)
               └── campaigns (1:N)

sales.client_id → crm_clients.id
sales.client_org_id → organizations.id (client's org, for Stripe matching)
sales.created_by → profiles.id (salesperson, used for commissions)
stripe_commission_records.user_id → profiles.id
stripe_commission_records.sale_id → sales.id
```

## RLS Patterns

All tables use Row Level Security. Common patterns:

```sql
-- SELECT: org members can view
CREATE POLICY "Members can view [table]"
  ON public.[table] FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT: org members can create
CREATE POLICY "Members can insert [table]"
  ON public.[table] FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

-- UPDATE: org members can update
CREATE POLICY "Members can update [table]"
  ON public.[table] FOR UPDATE TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

-- Service role (Edge Functions): full access
CREATE POLICY "Service role can insert [table]"
  ON public.[table] FOR INSERT WITH CHECK (true);
```

## Commission Flow

1. **Stripe webhook** (`invoice.paid`) → creates `stripe_commission_records` + `sale_payments`
2. **Manual renewal** (`useRenewSale`) → creates `stripe_commission_records` + `sale_payments`
3. **Admin marks paid** → updates `stripe_commission_records.status = 'paid'` + creates `expenses` record

Rate resolution: `organizations.sales_settings.commission_percentage` (global) > `organization_members.commission_rate` (per-member) > 0.

## Payment Method Values

Enum-like string: `mbway`, `transfer`, `cash`, `card`, `check`, `other`. Labels in `src/types/sales.ts` → `PAYMENT_METHOD_LABELS`.

## Multicanal (WhatsApp / Instagram / Facebook inbox)

Omnichannel messaging built on **Chatwoot** (headless backend) + **Evolution API** (WhatsApp). Each organization gets its own isolated Chatwoot account; each connected channel is one row in `messaging_channels`.

**`organizations` (new columns):**
- `chatwoot_account_id` `integer` — the org Chatwoot account id (provisioned on first connect via the Chatwoot Platform API).
- `chatwoot_account_token` `text` — access token for that account (used to read conversations in Phase 2).

**`messaging_channels`** (1 row per channel per org, unique `(organization_id, channel_type)`):
- `channel_type` — whatsapp | instagram | facebook
- `provider` — evolution | meta
- `evolution_instance` — Evolution instance name (`senvia-<org-id-prefix>`)
- `chatwoot_inbox_id` — inbox auto-created in Chatwoot
- `status` — disconnected | connecting | connected | error
- `phone_number` — filled once connected
- `metadata` `jsonb`

RLS mirrors `forms`: members SELECT, admins manage (`get_user_org_id` + `has_role('admin')`), super_admin full access. Edge functions (`whatsapp-connect`, `whatsapp-status`) use the service role and validate org-admin membership manually.

Required Supabase secrets: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `CHATWOOT_URL`, `CHATWOOT_PLATFORM_TOKEN`.

## Referral rewards (local migration, September 2026)

Pending release: `20260912090000_referral_program.sql` defines permanent billing attribution. It has not been applied to production.

- `referral_codes`: one random UUID invitation code per organization. Primary key/FK is `organization_id`; deleting an organization cannot cascade away its attribution.
- `organization_referrals`: referring organization, unique referred organization, first qualifying paid invoice, optional reserved redemption invoice, redemption/revocation timestamps. Self-referrals are rejected. Invoice IDs are unique for retry safety.
- Organization members can SELECT only their referring organization's records through RLS. Authenticated clients cannot insert/update/delete either ledger table. The dashboard RPC requires organization admin membership and returns only referred company names and reward state.
- Signup attribution checks new organization ownership and the signup metadata code; adding a member to an existing organization does not earn a referral. Qualification and redemption RPCs are service-role only.
- Rewards become eligible after a positive Stripe invoice payment, excluding out-of-band payments. A monthly renewal reserves one reward under an organization lock. Stripe invoice metadata and stable idempotency keys protect webhook retries. Unused qualified rewards have a partial index by organization and qualification date.
- No automatic reversal for refunds/chargebacks is defined in this release. `revoked_at` is reserved for a separately agreed policy; do not delete accounting history.

## User action limiter (local migration, September 2026)

`20260912091000_user_action_rate_limit.sql` extends `rate_limit_hits` with a bounded rolling timestamp array. A transaction advisory lock serializes the action/user bucket. The first five requests in a rolling 60 seconds pass; later requests return a retry interval. The service-role RPC is not directly executable by customers. Email send commands enforce the same rule with an authenticated database trigger. Reads and polling are outside this action limiter.

`20260912092000_single_plan_features.sql` retains legacy plan IDs and contracted user allowances while aligning features/prices. `20260912093000_support_attachment_types.sql` allows bounded support document formats and adds a restrictive organization-folder upload policy.

### organization_billing_accounts (local migration 20260913100000)

One permanent, service-owned Stripe binding per organization. organization_id is the primary key and restrictive FK; stripe_customer_id and stripe_subscription_id are unique. Status, interval, next renewal, cancellation and synchronization fields are webhook-derived snapshots for the referral dashboard. No client SELECT or write grants/policies; RLS is enabled. Admins only receive a safe summary via get_referral_dashboard, without Stripe identifiers. This prevents clients from replacing another tenant's customer association. Primary-key and unique indexes support org/customer/subscription lookups. Legacy bindings must be inventoried and approved before activation; never infer a tenant by an arbitrary first membership or unverified email match.

### Referral audit migration (local, 20260913110000)

Referral SELECT policies now require is_org_admin, matching dashboard permissions. qualify_referral preserves the earliest confirmed payment after registration; reserve_referral_month refuses reused revoked/consumed reservations. organization_billing_accounts adds collection_paused plus checkout_attempt, checkout_expires_at and checkout_parameters. All remain service-only. sync_referral_billing serializes current-subscription snapshots and rejects obsolete observations/subscriptions. claim_referral_checkout serializes a one-hour checkout attempt with stable parameters/idempotency key. No new table is introduced by this audit migration. get_referral_dashboard adds the safe collection_paused flag without exposing checkout parameters or Stripe identifiers.


### Production activation, 2026-09-13

The six prepared referral, action-limit, single-plan and support-attachment migrations were applied in one transaction after explicit publication approval. The known legacy Stripe customer was bound to Escolha Inteligente using matching Stripe invoice IDs in CRM sales. BDS Telecomunicações was attributed to Escolha Inteligente by explicit user instruction, with attribution dated to BDS creation and no qualified reward: no first payment was present in the CRM or available Stripe invoice history. The organizations' current access, exemptions, extra seats and limits were preserved.

### Referral reward coupons (local migration 20260925210000)

Each confirmed referral reward can store a unique `stripe_coupon_id` in `organization_referrals`. The service-role-only `reserve_referral_month_for_reward` RPC binds a renewal invoice to the exact reward identified by its coupon, under the organization lock. This prevents a pre-applied coupon from consuming a different earned month. The existing reservation RPC remains for legacy shared coupons. Apply this migration before deploying the referral webhook and reconciliation changes.

### Telecom chargeback accounting month (20261007173000)

`sale_chargebacks` and `bds_manual_chargebacks` retain `created_at` for audit and add `application_month` (the first day of the commission month chosen on confirmation) and `applied_at` (when the deduction is included in a commission payment). Confirmed chargebacks require an application month. Pending or dismissed chargebacks do not reduce commissions. Both tables remain isolated by organization RLS; the new indexes support organization, month and status lookups. Existing confirmed rows are initially assigned their creation month. The separate `20261007174000` data patch assigns the six reviewed BDS chargebacks to September 2026 only when the expected records match exactly.

## Workplace Feed (20261023122606, 20261026120000)

Organization feed for the Workplace preview. All tables carry `organization_id`; a restrictive `workplace_scope` policy requires `meets_mfa_policy` and active membership (or super_admin) for every operation, and a permissive SELECT lets members read everything in their organization. No client DELETE on posts or comments: publications and recognitions are permanent.

- `workplace_posts`: `author_id` (profiles), `body`, `kind` (`publication` | `announcement` | `recognition`), `pinned`, `created_at`, `updated_at`. Members insert publications and recognitions unpinned; announcements and pinning require `is_org_admin`. The update trigger keeps id, organization, author, creation time, recipient and recognition type immutable.
  - Recognitions add `recipient_id` (profiles, must be an active member and not the author) and `recognition_type` (`great_work`, `team_spirit`, `creativity`, `leadership`, `helpful`, `professional`, `innovation`, `dedication`, `congrats`, `thanks`); the body is the reason, 30–1000 characters. Both columns are NULL for other kinds. An insert trigger for authenticated clients fixes `created_at` to `now()` and limits each author to 3 recognitions per 24 hours per organization, and 1 per recipient per 24 hours. Partial indexes: `(organization_id, recipient_id, created_at DESC)` and `(organization_id, author_id, created_at DESC)` where `kind = 'recognition'`.
- `workplace_comments`: `post_id` (composite FK with organization), `author_id`, `body` (1–2000). Members insert their own.
- `workplace_reactions`: `post_id`, `user_id`, `emoji` (one of 👍 ❤️ 👏 🎉 😂 😮 😢 🙏; defaults to ❤️, which also covers likes made before emojis). Primary key `(post_id, user_id, emoji)`: a person may add several different emojis. Members insert and delete only their own rows.

All three tables are in the `supabase_realtime` publication.

## Workplace Mensagens (20261026150000)

Internal conversations between members of the same organization. Only conversation members read messages; organization admins have no access to other people's conversations. Conversations and memberships are created only through SECURITY DEFINER functions that validate the organization (`workplace_chat_require_org`: active member and `meets_mfa_policy`). `workplace_chat_is_member(conversation)` (member + still an active organization member + MFA) gates every policy, the file bucket and the private realtime topic.

- `workplace_chat_conversations`: `organization_id`, `kind` (`direct` | `group` | `channel`), `title` (required except 1:1), `direct_key` (`<org>:<smaller user>:<larger user>`, unique, one 1:1 per pair), `is_default` (one "Geral" channel per organization, partial unique index), `created_by`, `last_message_at`/`last_message_id`. Read-only for clients.
- `workplace_chat_members`: `(conversation_id, user_id)` primary key, `role` (`owner` | `admin` | `member`), `joined_at`, `last_read_at` (visible to the other members: unread counts and "Visto"). Read-only for clients.
- `workplace_chat_member_settings`: personal `is_pinned`, `is_muted`, `is_archived`, visible and writable only by their owner (FK to the membership, removed with it).
- `workplace_chat_messages`: `conversation_id`, `organization_id` (set by trigger), `sender_id`, `kind` (`text` | `image` | `file` | `audio`), `body` (≤ 4000), attachment path/name/size (≤ 25 MB)/mime, `duration_sec`, `reply_to_id` (same conversation only), `forwarded`, `edited_at`, `deleted_at`. Clients may update only `body` (text edits) and `deleted_at`; deleting clears body and attachment fields and is final. No client DELETE. Index `(conversation_id, created_at DESC)` and `(organization_id, created_at DESC)`.
- `workplace_chat_reactions`: `(message_id, user_id, emoji)` primary key, composite FK `(message_id, conversation_id)`; emoji one of 👍 ❤️ 👏 🎉 😂 😮 😢 🙏. Members add and remove their own.

Functions (authenticated): `workplace_chat_bootstrap(org)` (creates/joins "Geral"), `workplace_chat_start_direct(org, user)`, `workplace_chat_create_group(org, title, members)` (1–99 colleagues, creator owner), `workplace_chat_add_members(conversation, members)` (group owner/admin), `workplace_chat_leave_group(conversation)` (oldest member becomes owner if none remains), `workplace_chat_rename_group(conversation, title)` (any member), `workplace_chat_mark_read(conversation)`, `workplace_chat_list_conversations(org)` (preferences, member count, unread, 1:1 peer, last message preview), `workplace_chat_search_messages(org, term, limit)` (accent/case-insensitive via `immutable_unaccent`, RLS applies).

Storage: private bucket `workplace-chat-files` (25 MB; images, PDF, text/CSV, ZIP, Office, audio), paths `<conversation>/<file>`; members read and upload, the uploader deletes. Realtime: messages, members, settings and conversations are in `supabase_realtime`; typing and reaction nudges use the private broadcast topic `workplace-chat-<conversation>` (policies on `realtime.messages`).

### Feed attachments (20261026170000)

`workplace_posts.attachments` is a JSON array (max 4) of `{ path, name, size, mime }`; a trigger requires each `path` to start with `<post id>/`, a name of 1–255 characters, a numeric size up to 15 MB and a MIME type. Files live in the private bucket `workplace-feed-files` (15 MB; images, PDF, Word, Excel, PowerPoint) under `<post>/<file>`: organization members (or super admin) with MFA read them (`workplace_feed_can_see`), only the post's author uploads (`workplace_feed_is_author`, so the post is created first and its attachment list updated after the upload), and the uploader deletes.

## WebMail (20261026190000)

Personal layer of the WebMail on top of the email caixas (`messaging_channels` with `channel_type = 'email'`, still created by admins and synced by `email-gateway`). Every row belongs to one person and only they see it. Rows tied to a caixa also require `pode_aceder_caixa(auth.uid(), channel_id)`; contact rows require `is_org_member`. A trigger (`email_personal_row_org`) always copies `organization_id` from the caixa and refreshes `updated_at`.

- `email_account_preferences`: primary key `(user_id, channel_id)`. Columns: `label` (the person's own name for the caixa, 1–60 characters; the admin's `messaging_channels.label` stays the shared name), `color` (`#rrggbb`), `notify` (new-mail push, default true), `is_default` (the caixa "Escrever" opens with; partial unique index, one per person and organization), `position` (sidebar order).
- `email_signatures`: `id`, `user_id`, `channel_id`, `name` (1–60), `html` (≤ 20 000), `is_default` (partial unique index, at most one per person and caixa), `position`. Written through `email_save_signatures(channel, items)`, which replaces the person's list for that caixa in one step and leaves exactly one default (the first one when none is marked). The caixa-wide signatures in `messaging_channels.metadata.signatures` remain the fallback while a person has none.
- `email_contacts`: primary key `(user_id, organization_id, email)`; `email` lowercase, `name`, `uses`, `last_used_at`. Filled by `email_remember_contacts(org, items)` after each send (up to 100 addresses per call; known addresses get `uses + 1`). Index `(user_id, organization_id, uses DESC, last_used_at DESC)`.
- `email_contact_lists`: `id`, `user_id`, `organization_id`, `name` (1–60, unique per person and organization, case-insensitive), `members` (JSON array of `{ email, name }`, max 500).

Storage: public bucket `email-signatures` (5 MB; PNG, JPEG, GIF, WebP) so recipients can load signature images; each person uploads and deletes only under `<user id>/`.

`notificar_email_novo` (new mail in an Inbox folder) now leaves out people whose `notify` is false for that caixa: assignees minus muted people, or, when the caixa has no assignees and someone muted it, the active organization members minus muted people. With nobody left, no push is sent.
