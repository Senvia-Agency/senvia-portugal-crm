# Database Schema — Senvia OS

## Core Tables

### Authentication & Multi-tenancy

| Table | Purpose |
|-------|---------|
| `organizations` | Tenant root. Holds plan, niche, settings (sales_settings, form_settings, tax_config, integrations_enabled), InvoiceXpress/WhatsApp credentials. |
| `profiles` | User profile. Links to `organization_id` (primary org). Has `full_name`, `avatar_url`. |
| `organization_members` | Many-to-many: users ↔ orgs. Holds `role` (admin/member), `commission_rate`, `is_active`. |

**RLS pattern:** All business tables use `organization_id` FK + policy `is_org_member(auth.uid(), organization_id)`.

### CRM Pipeline

| Table | Purpose |
|-------|---------|
| `leads` | Lead records. Has `status` (matches pipeline_stages.key), `assigned_to`, `source`, `organization_id`. |
| `pipeline_stages` | Customizable per-org. Has `key`, `label`, `order`, `is_final_positive`, `is_final_negative`. |
| `crm_clients` | Converted leads. Has `name`, `email`, `phone`, `company`, `nif` (tax ID). |
| `lead_labels` | Tags for leads. Many-to-many via `lead_label_assignments`. |
| `lead_imports` | History of CSV/bulk lead imports. |

### Sales & Payments

| Table | Purpose |
|-------|---------|
| `sales` | Sale records. Key fields: `code`, `total_value`, `status` (pending/in_progress/fulfilled/delivered/cancelled), `created_by`, `client_id`, `client_org_id`, `payment_method`, `has_recurring`, `recurring_value`, `recurring_status`, `next_renewal_date`, `last_renewal_date`. |
| `sale_items` | Line items per sale. Links to `products` table. |
| `sale_payments` | Payment schedule/records. Fields: `amount`, `payment_date`, `status` (pending/paid), `payment_method` (mbway/transfer/cash/card/check/other), `invoice_reference`. **This is what appears in Finance > Payments.** |
| `products` | Org-level product catalog. Has `price`, `is_recurring`, `tax_value`. |
| `proposals` | Proposal documents. Linked to leads/clients. |

### Finance

| Table | Purpose |
|-------|---------|
| `expenses` | Expense records. Has `category_id`, `is_recurring`, `next_recurrence_date`, `bank_account_id`. |
| `expense_categories` | Org-level categories with `name`, `color`. |
| `bank_accounts` | Bank accounts for expense tracking. |
| `invoices` | InvoiceXpress synced invoices. |
| `credit_notes` | InvoiceXpress synced credit notes. |
| `stripe_commission_records` | Commission tracking for recurring Stripe payments. Fields: `sale_id`, `user_id` (salesperson), `client_org_id`, `amount`, `commission_rate`, `commission_amount`, `stripe_invoice_id`, `plan`, `status` (pending/paid). |
| `internal_requests` | Finance requests (advances, reimbursements). |

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
