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
| `crm_clients` | Converted leads. Has `name`, `email`, `phone`, `company`, `nif` (tax ID), `company_nif`, and separate `company_address_line1`, `company_address_line2`, `company_city`, `company_postal_code`, `company_country` for company invoicing. Personal address fields are never reused as the company fiscal address. |
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
| `expenses` | Expense records. Has `category_id`, `is_recurring`, `next_recurrence_date`, `bank_account_id`. |
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
