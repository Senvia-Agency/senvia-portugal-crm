# Automations — flow engine

Customer-facing automation builder: node graphs that send WhatsApp/email, wait,
branch on conditions, and — the conversational part — **wait for the contact's
reply and branch on what they wrote**.

The Automations page also shows one protected system flow: **“Documento fiscal
emitido → Enviar PDF ao cliente”**. It is backed by the immutable `invoices`
outbox rather than an editable customer graph. Each recurring sale chooses its
fiscal policy, recipient, sender and message; the worker sends only after the
provider confirms the fiscal identity and stores/retrieves the PDF. Brevo
retries reuse the invoice UUID as the idempotency key, and delivery/bounce
events update the same ledger row through a service-only RPC. Users may
configure this flow from the recurring sale, but cannot delete or rewire it.

## Two systems, on purpose

| | Legacy | Flows |
|---|---|---|
| Definition | `email_templates.automation_*` (one template = one automation) | `automation_flows.graph` |
| Steps | exactly one (send an email) | any number |
| Channels | email only | email + WhatsApp |
| State | none | `automation_runs` |
| History | none | `automation_run_steps` |
| Executor | `process-automation` | `automation-engine` |

Both run side by side. The DB trigger dispatches every CRM event to **both**, so
nothing an org already relies on stops working. The 10 pre-existing automations
were converted to flows by `20260807120000_migrate_legacy_automations.sql`, but
land in `draft` — visible and editable, enrolling nobody — so the same email can
never go out twice. Switching an org over means activating the flow and turning
off `automation_enabled` on the matching template.

## Tables

- **`automation_flows`** — the design. `graph` is `{nodes:[{id,type,config,position}], edges:[{id,source,target,branch}]}`.
  `status` is `draft` (inert) / `active` / `paused` (keeps running paths, enrols nobody).
- **`automation_runs`** — one contact travelling through one flow. `status`:
  `running`, `waiting` (time wait), `awaiting_reply` (parked for the contact's
  answer), `completed`, `failed`, `cancelled`.
- **`automation_run_steps`** — what happened at each node, including the branch
  taken and why. This is the answer to "why did this client get this message?".

### Guarantees enforced by the schema, not just the code

- `uniq_active_run_per_subject` — a contact cannot have two live runs in the
  same flow, so a trigger firing twice does not duplicate a sequence.
- `uniq_step_per_run_node` — a node executes at most once per run, so a
  redelivery cannot re-send a message.
- `automation_phone_key()` — last 9 digits. Both sides of the inbound match use
  it, so `+351 912 345 678`, `00351912345678` and `912345678` are the same
  contact.

## Engine

`supabase/functions/automation-engine`, four actions:

| Action | Called by | Does |
|---|---|---|
| `enroll` | `notify_automation_trigger` (DB trigger) for CRUD events; `submit-lead` directly for `form_submitted` and the temperature triggers; `automation-engine`'s own `handleKeywordStart` for `whatsapp_keyword` | Finds active flows for `(org, trigger_type)`, applies any trigger-level filter (`trigger_config.form_id`, `.to_stage`, `.keywords`), creates a run, walks the graph until it parks. |
| `tick` | cron `automation-engine-tick`, every minute | Wakes runs whose `wake_at` passed. For `awaiting_reply` that means the reply never came → takes the `timeout` branch. |
| `reply` | `chatwoot-webhook` on every inbound message | Resumes the run parked on this phone number and branches by keyword; if none is parked, tries to **start** a `whatsapp_keyword` flow. |
| `test` | the editor's "Testar" button | Runs a flow against a chosen contact, ignoring `status`/reentry — for trying a flow before activating it. Authorised per-request (admin of the flow's org), not by the shared secret. |

Both `tick` and `reply` claim a run with a conditional `UPDATE … WHERE status = …`
before touching it, so two concurrent runs of the cron cannot double-execute a
path. (`process-automation-queue`, the legacy drain, does *not* do this.)

### Node types

`send_whatsapp` (optionally waits for a reply itself — see below), `send_email`,
`wait`, `wait_reply`, `condition`, `move_stage`, `assign_user`, `add_to_list`,
`create_task`, `webhook`, `end`.

The conversational shape lives on **`send_whatsapp`**: `config.wait_reply: true`
+ `config.rules` (`{id, label, keywords[]}[]`) sends the message (as WhatsApp
buttons when `use_buttons`, degrading to numbered text options if the API
rejects buttons) and parks the run on the reply — one node for "ask and wait",
matching how ManyChat-style builders model it. The standalone **`wait_reply`**
node (not offered when creating a new flow, but fully supported) covers the
narrower case where the question was already asked by something outside this
flow — it only waits, never sends.

### Trigger types worth a note

- **`lead_created_hot` / `_warm` / `_cold`** — same event as `lead_created`,
  filtered to one AI-classified temperature. Dispatched **directly by
  `submit-lead`** (`dispatchLeadTemperature`), not by the generic DB trigger —
  temperature isn't known at INSERT time (classification is an async Gemini
  call). Classification only runs for leads submitted through the **public
  form** path (not `mode=webhook`, not leads inserted directly by other
  functions like `notify-new-trials`) and only calls the AI when the org (or
  form, in `per_form` mode) has "Regras de Qualificação por IA" configured —
  otherwise every lead defaults to `warm`, same as before this existed.
  Classification is decoupled from the legacy per-form WhatsApp welcome
  message on purpose: these triggers fire whether or not that old feature is
  even configured for the org.
- **`form_submitted`** — dispatched directly by `submit-lead` for the same
  reason `form_submitted` needs the form's identity, which the generic
  `lead_created` DB trigger payload doesn't carry.
- **`whatsapp_keyword`** — has no DB trigger at all; only fires when a message
  arrives that doesn't match any parked run (see `reply` above).

### Safety rails

- **Quiet hours** (`automation_flows.quiet_hours`, Europe/Lisbon) — a send that
  lands inside the window is postponed to the end of it, not dropped.
- **`max_steps_per_run`** — a cycle in the graph fails the run instead of
  looping forever.
- Every failure is `console.error` and a `failed` step row, never a silent
  return. This module exists partly because two earlier incidents in this
  codebase (the Stripe webhook, and automations 401ing) were invisible.

## Auth

Postgres cannot read `SUPABASE_SERVICE_ROLE_KEY`, so DB triggers authenticate
with a shared secret that lives **only in Supabase Vault**
(`automation_internal_secret`), compared by `verify_automation_secret()` which
returns a boolean and never the secret. Edge functions calling the engine use
the service-role bearer instead. Both are accepted; anything else is 401.

To call the engine by hand from the SQL Editor:

```sql
SELECT net.http_post(
  url := 'https://chhmfwlimtbsyjmgtokn.supabase.co/functions/v1/automation-engine',
  body := '{"action":"tick"}'::jsonb,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-automation-secret', public.automation_internal_secret()
  )
);
```

## Other automated behaviour NOT (yet) in this module

Found while auditing what already runs for an org (2026-08-10). None of these
are `automation_flows` — each is its own hardcoded mechanism, config-driven but
not user-buildable. Listed so nobody rediscovers them from scratch, and as
candidates for future migration.

| Where | What it does | Config |
|---|---|---|
| `submit-lead` → `sendWelcomeMessage` | Legacy per-form/org WhatsApp welcome by temperature (hot/warm/cold template). The reason `lead_created_hot/warm/cold` exist as flow triggers — recreate the same behaviour there, then delete the org's `msg_template_*`. | `organizations.msg_template_hot/warm/cold` (or per-form, in `ai_response_mode='per_form'`) |
| `chatwoot-webhook` | Out-of-hours WhatsApp auto-reply (one per conversation per 6h) | `messaging_channels.metadata.auto_reply` — currently unset for every org checked |
| `chatwoot-webhook` | Round-robin auto-assign of new conversations | `messaging_channels.assigned_user_ids` — currently unset for every org checked |
| `chatwoot-webhook` → `suggestTaskFromMessage` | AI-suggested tasks from promises/requests detected in a message | `messaging_channels.metadata.ai_tasks_enabled` |
| `notify-new-trials` (cron, */15 min) | Creates the Senvia-CRM lead for every new trial signup, with `temperature: 'hot'` and **`automation_enabled: false`** hardcoded | not configurable |
| `enqueue_trial_whatsapp_nudges()` (cron, hourly) | Drip of up to 4 WhatsApp nudges to trial orgs inactive 24h+ | `organizations.wa_nudge_*`, hardcoded message bodies in the SQL function |
| `check-renewal-automations` / `check-trial-status` / `stripe-webhook` | Already dispatch into the **same** trigger_type space this module reads (`sale_renewal_due_*`, `trial_*`, `stripe_subscription_*`) — not a separate system, just other trigger *sources* for flows/legacy templates | — |

**Known bug, not yet fixed:** `leads.automation_enabled` (set to `false` by
`notify-new-trials`, intending "don't run normal lead automations on this
internal/trial-signup contact") is **not checked anywhere** —
`notify_automation_trigger` dispatches `lead_created` regardless. In practice
this means a trial signup can receive the agency's ordinary "novo lead"
automations (e.g. a client-facing welcome email) despite the flag saying it
shouldn't.
