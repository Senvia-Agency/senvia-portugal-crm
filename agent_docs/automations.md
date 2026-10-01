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

### Parallel paths (fan-out)

A step may have **several unbranched outgoing edges**, and the engine walks them
all. "Send the email *and* create the task" is one step with two successors,
rather than a chain. Branches are still exclusive: a `condition`, or a step that
waits for a reply, picks exactly one path, and the canvas refuses a second edge
on the same branch key.

On the canvas a standing `+` marks only a genuinely open end — a step with no
successor, or a free branch. A permanent one on every step would have buried the
flow in placeholders.

There is a single gesture for shape, and the `+` is not an exception to it: a
line is pulled out of a step's connection point, or out of a `+`, which is only
a placeholder for the step behind it. Released on another step it links the two;
released on empty canvas it opens the picker and puts the new step exactly
there; released without moving — an ordinary click on the `+` — it adds the step
in place. The `+` therefore carries a source handle over its whole face and no
click handler of its own, or both would fire and add two steps.

This changed the run's shape. A run used to hold one position in
`current_node_id`; it can now be parked on several paths at once, so the list
lives in `context.__cursors` as `[{node, status, wake_at, resume_self?}]`.
`current_node_id` still names one of them, which is what `handleReply` matches
on and what keeps a single-path flow behaving exactly as before. The run's
`wake_at` is the **earliest** of the parked paths, so the existing tick index
keeps working; `tick` then resumes only the cursors whose time has come and
re-parks the rest untouched. The run completes when no path can move and none
is parked — an `end` node closes its own path, not the whole run.

`advance` loads the run's already-executed node ids **before** walking. Two
paths meeting on the same step (a join) then skip the effect instead of
repeating it: `uniq_step_per_run_node` only catches a duplicate *after* the send
has already gone out, which is too late.

## Engine

`supabase/functions/automation-engine`, four actions:

| Action | Called by | Does |
|---|---|---|
| `enroll` | `notify_automation_trigger` (DB trigger) for CRUD events; `submit-lead` directly for `form_submitted` and the temperature triggers; `automation-engine`'s own `handleKeywordStart` for `whatsapp_keyword` | Finds active flows for `(org, trigger_type)`, applies any trigger-level filter (`trigger_config.form_id`, `.to_stage`, `.keywords`), creates a run, walks the graph until it parks. |
| `tick` | cron `automation-engine-tick`, every minute; `evolution-webhook` when a message buffer ends | Wakes runs whose `wake_at` passed. For `awaiting_reply` that means the reply never came → takes the `timeout` branch. |
| `reply` | `evolution-webhook` on every inbound WhatsApp (QR) message | Resumes the run parked on this phone number and branches by keyword; if none is parked, tries to **start** a `whatsapp_keyword` flow, then a `message_received` one. Returns `buffered_until` when a run is waiting for more messages. |
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
  arrives that doesn't match any parked run (see `reply` above). The
  conversation is the subject (when the message came through `evolution-webhook`),
  so a contact who sends the keyword twice in a row gets one run, and
  `reentry_policy` decides whether they can get it again later.
- **`message_received`** — any message to a QR-code caixa (`trigger_config.channel_id`,
  or any caixa when empty), started by `handleMessageStart` only when no keyword
  flow claimed the message. Protection against one contact firing it many times,
  modelled on how n8n WhatsApp flows do it (dedupe by message id + a per-number
  message buffer + a per-number lock):
  1. **Dedupe by message id** — `meta_messages` is unique on
     `(conversation_id, external_id)`; `evolution-webhook` only notifies the engine
     for a message it actually stored, so Evolution re-sending an event is a no-op.
     Messages older than 10 minutes (history replayed on reconnect) are stored
     but never notify.
  2. **Buffer** — `trigger_config.buffer_seconds` (default 15, max 60, 0 = off).
     The first message inserts the run as `waiting` with `wake_at = now + buffer`,
     `context.__resume_node = entry` and `context.__collect_from = message time − 1s`.
     Each further message from the same conversation pushes `wake_at` back while
     the run is still parked on the trigger. When it wakes, the tick re-runs the
     trigger node, which joins every incoming message since `__collect_from` into
     `mensagem_inicial` (one per line) and sets `mensagens_agrupadas`. The webhook
     sleeps until `buffered_until` and calls `tick` itself, so the answer does not
     wait for the next cron minute.
  3. **Lock** — the conversation is the subject (`subject_type = 'contact'`,
     `subject_id = meta_conversations.id`; the `subject_type` check has no
     `'conversation'`), so `uniq_active_run_per_subject`
     allows one active run per conversation and flow; a concurrent insert gets
     23505 and joins the winner's buffer instead. Messages that arrive once the
     run has started stay in the Caixa de Entrada only.
  After the run ends, `reentry_policy` decides whether the number can enter
  again. The editor shows it on both message triggers as the switch **«Só uma
  vez por número»**: on = `once` (checked by `contact_phone_key` across caixas,
  test runs excluded since their `subject_id` is null), off = `after_completion`
  (fires on every message; a Condição after the trigger filters who carries
  on). The same value is the «Quem pode voltar a entrar» select in Definições;
  the editor keeps one state for both and saves it with the flow.
- **`referral_month_earned`** — the referral programme. Fires for the
  **agency** (the flow is Senvia's) when a referred organization makes its
  first paid invoice, i.e. the moment the referrer earns a free month.
  Dispatched by `announceReferralMonth` in `_shared/referrals.ts`, right after
  `qualify_referral`, and only when *that* invoice is the qualifying one — so
  later invoices from the same customer stay silent and rewards that qualified
  before the trigger existed are never announced retroactively. The contact is
  the referrer's earliest active admin; `record` carries `empresa` (referrer)
  and `indicada` (referred) for templates. Runs from both `stripe-webhook`
  and `reconcile-stripe-payments`, since both call `handleReferralEvent`.
- **`referral_month_started`** — the same programme, one step later: the
  referrer's 100%-off invoice is paid and the free month is actually running.
  Dispatched from `reconcileReservation` the moment `redeemed_at` is set, and
  only when that update flips the row — a redelivery finds nothing to flip and
  stays silent. Same contact and `record` shape as `referral_month_earned`,
  plus `fim_periodo` (the period end, pt-PT long date) for the template.
- **`referral_month_ending_2d`** — two days before that free month ends and
  billing resumes. Not an event: `announceEndingReferralMonths` runs inside
  the daily `reconcile-stripe-payments` pass (04:30) and picks organizations
  whose `current_period_end` falls in a 24-hour window centred 48h ahead, with
  a redeemed, unrevoked reward from the last 45 days — the fence that keeps a
  reward spent months ago from matching a later period. Same `record` shape,
  with `fim_periodo`.

  All three referral triggers use the **reward id** as the run subject, not
  the organization: the engine de-duplicates per subject, and keyed on the
  organization a second referral would never be announced. `record` still
  carries the organization as `organizacao_id`.
- **`subscription_renewal_due_2d`** — the SENVIA OS plan itself renews in two
  days. `announceUpcomingRenewals` in `_shared/agency-automations.ts` runs in
  the same daily `reconcile-stripe-payments` pass and reads
  `organization_billing_accounts` (status `active`, not cancelling, not
  paused), the snapshot Stripe keeps current. It skips organizations the
  referral programme is about to mail instead — a pending free month (nothing
  to pay) or a current one (they get "your free month ends"). A renewal has no
  row of its own, so the subject is a deterministic UUID of
  `renewal:<org>:<date>`, which is what makes once-per-renewal hold across a
  re-run. `record` adds `plano` and `data_renovacao`.

  `_shared/agency-automations.ts` is where "email one of this organization's
  admins" lives (`organizationAdminContact`, `dispatchAgencyAutomation`); the
  referral triggers go through it too.
- **`stripe_subscription_past_due`** — not new, but it was hidden from the
  picker with the legacy set while `stripe-webhook` dispatched it all along
  (on `customer.subscription.updated` with status `past_due`). Now offered
  under Subscrição. Its `record` used to be `{email, plan, nome: <org name>}`
  with no `id`, so `{{primeiro_nome}}` printed the first word of the company
  and every Stripe retry re-fired it with nothing to de-duplicate on. It now
  carries a deterministic subject (`past_due:<org>:<failing invoice>` — one
  overdue episode is one invoice), the admin's name, `empresa`, a readable
  `plano`, and `dias_carencia` / `bloqueio_em` from `PAYMENT_GRACE_DAYS`,
  which mirrors `GRACE_DAYS` in `check-subscription` and must move with it.
  The recipient stays the Stripe customer email: a failed payment goes to
  whoever pays.

  The engine's entry-node switch now lists every trigger the product
  dispatches, so none of them falls into the default branch and logs "tipo de
  nó desconhecido" on each run.
- **`sale_renewal_due_in_2_days` / `sale_renewal_due_today` /
  `sale_renewal_overdue`** — a TENANT's recurring sales, manual billing only.
  The first two existed by name but never reached the engine:
  `check-renewal-automations` walked only the legacy per-template path, off
  `sales.next_renewal_date`, which the cycle generator does not maintain (stale
  on 10 of 15 active recurrences). `announceSaleCycles` in
  `_shared/sale-cycle-automations.ts` now runs first in that daily job (08:00)
  and reads the per-period ledger instead: `sale_recurring_cycles.due_date`,
  unpaid, recurrence active. It enrols the engine **directly**, not through
  process-automation, so the legacy templates keep their own date source and
  the two never double up. "Due in 2 days" comes from
  `sale_recurrences.next_cycle_date` because the cycle row is only created on
  the day it starts; its subject is a deterministic id of (recurrence, date).
  The other two use the cycle id. Overdue is fenced to the last 7 days — 34
  unpaid cycles were already sitting there, and announcing them all on
  activation is not what anyone wants. The contact is the sale's client;
  `record` carries `codigo_venda`, `valor`, `data_vencimento`, `periodo`,
  `dias_para_vencimento` or `dias_em_atraso`, and the salesperson as
  `vendedor_*`. A client without an email is skipped and counted.

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

## Editor UX (n8n model, 2026-10-01)

The editor follows n8n's structure; no small dialogs anywhere in the module.

- **Create**: "Nova automação" inserts the flow at once (`Automação sem nome`, trigger `lead_created`) and navigates to `/automacoes/:id?novo=1`; the editor opens the trigger node's details view so choosing the trigger is the first step. Ready-made flows live in `RecipeGalleryDialog` (full screen, searchable), opened by "Usar modelo".
- **Add step**: `NodesPanel` — a full-height drawer over the right of the canvas (canvas stays visible), search + category chips, Enter picks the first match, Esc closes. Replaces `NodePickerDialog`.
- **Configure step**: `NodeDetailsView` — full-screen dialog with three columns: Entrada (variables with sample values from the latest run, trigger record), Parâmetros (`NodeInspector`, now form-only; the trigger node shows `TriggerPicker`), Saída (node stats + last 10 steps of this node across runs, via `useAutomationNodeSteps`). Edits apply to the in-memory graph; "Guardar" in the editor persists.
- **Test**: `TestFlowDialog` is full screen, with the ordered step list and which contact field the flow needs.
- The engine and the graph document are unchanged: data still flows through `run.context` and `{{variavel}}` rendering, not n8n's item/`$json` model.
