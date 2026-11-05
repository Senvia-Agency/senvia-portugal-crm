import { automationContactSuppressed } from '../functions/_shared/automation-contact-optout.ts';
import { deterministicUuid } from '../functions/_shared/agency-automations.ts';
import { eligiblePersistedReply, replyRuleBranch } from '../functions/automation-engine/reply-reconcile.ts';
import { planAutomationErrorContinuation } from '../functions/_shared/automation-error-continuation.ts';
import { automationContactSubjectId, contactRunIdentityFilter, normalizedAutomationEmail, InvalidAutomationContactIdentity } from '../functions/_shared/automation-contact-identity.ts';
import { resolveActionTarget, InvalidActionTarget } from "../functions/automation-engine/action-target.ts";
import { executeAutomationHttpAction as httpAction } from '../functions/_shared/automation-http-action.ts';
import { formatAutomationInvocationError } from '../functions/_shared/automation-invocation-error.ts';
import { resolveAutomationEmailRecipient } from '../functions/automation-engine/email-recipient.ts';
import { checkAutomationReentry } from '../functions/automation-engine/reentry-policy.ts';
import { executeMetaConversionAction } from '../functions/automation-engine/meta-conversion-actions.ts';
import { evaluateConditionValue } from '../functions/_shared/automation-condition-value.ts';
import { executeProposalAction } from '../functions/automation-engine/proposal-actions.ts';
import { renderAutomationTemplate } from '../functions/_shared/automation-template.ts';
import { matchesStageTransition } from '../functions/_shared/automation-stage-filter.ts';
import { InvalidAutomationReentry, readReentryCooldownDays, reentryCooldownDecision } from '../functions/_shared/automation-reentry.ts';
import { executeFinanceAction } from '../functions/automation-engine/finance-actions.ts';
import { executeInboxAction } from '../functions/automation-engine/inbox-actions.ts';
import { applyFailurePolicy, retryFailedRuns } from '../functions/automation-engine/failure-policy.ts';
import { visitStepKey, stepVisit, currentVisitExecutedNodes, canonicalStepNodeId, planBoundedJump } from '../functions/_shared/automation-jump.ts';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync, build } from 'esbuild';
import { createRequire } from 'node:module';
import { evaluateConditionGroup, validateConditionTree } from '../functions/_shared/automation-condition-group.ts';
import { calculateAutomationWakeAt } from '../functions/_shared/automation-time.ts';
import { deterministicAssignment } from '../functions/_shared/automation-split.ts';
import { decideAutomationRetry } from '../functions/_shared/automation-retry.ts';
import { requiresSingleBillingEnrollment } from '../functions/_shared/sale-billing-trigger-dedupe.ts';
import { alertAutomationFailure } from '../functions/automation-engine/automation-failure-alert.ts';
import { executeBusinessAction } from '../functions/automation-engine/business-actions.ts';
import { executeCrmAction, taskDueAt } from '../functions/automation-engine/crm-actions.ts';

const configuredBundle = (await build({ stdin: { contents: "export * from \"./supabase/functions/automation-engine/configured-workflow-integration.ts\";\nexport * from \"./supabase/functions/automation-engine/configured-workflow-stage-claims.ts\";\nexport * from \"./supabase/functions/automation-engine/configured-workflow-runtime.ts\";\nexport * from \"./supabase/functions/automation-engine/configured-workflow-run-state.ts\";", resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", write: false, plugins: [{ name: "deno-zod", setup(builder) { builder.onResolve({ filter: /^https:/ }, args => args.path === "https://esm.sh/zod@3.25.76" ? { path: createRequire(import.meta.url).resolve("zod") } : undefined); } }] })).outputFiles[0].text;
const { runConfiguredNativeEvent, runDueConfiguredWorkflows, loadAuthorizedConfiguredFlow, readConfiguredWorkflowRecord, claimConfiguredWorkflowStage, finishConfiguredWorkflowStage, CONFIGURED_WORKFLOW_ACTION_TYPES, planConfiguredWorkflowStages, configuredRecordSubjectId, refreshConfiguredRun } = await import("data:text/javascript;base64," + Buffer.from(configuredBundle).toString("base64"));
const source = readFileSync(new URL('../functions/automation-engine/index.ts', import.meta.url), 'utf8');
let importing = false;
const body = source.slice(0, source.indexOf("if (import.meta.main) serve(")).split(String.fromCharCode(10)).filter(line => {
  if (line.startsWith("import ")) importing = true;
  if (importing) { if (line.includes(";")) importing = false; return false; }
  return true;
}).map(line => line.startsWith("export ") ? line.slice(7) : line).join(String.fromCharCode(10));
const script = transformSync(body + '\nglobalThis.runtime = {Engine,loadFlow,handleRetry,handleEnroll,handleManual,handleTick,handleStepSimulation,handleMessageStart,handleReply};', { loader: 'ts', target: 'es2022' }).code;

export function runtime(fetchStub, globals = {}) {
  const clock = { time: Date.parse('2026-11-04T10:00:00Z') };
  class ClockDate extends Date {
    constructor(value) { super(value === undefined ? clock.time : value); }
    static now() { return clock.time; }
  }
  const context = vm.createContext({ console, automationContactSuppressed: async () => false, deterministicUuid, runConfiguredNativeEvent, runDueConfiguredWorkflows, loadAuthorizedConfiguredFlow, readConfiguredWorkflowRecord, claimConfiguredWorkflowStage, finishConfiguredWorkflowStage, CONFIGURED_WORKFLOW_ACTION_TYPES, planConfiguredWorkflowStages, configuredRecordSubjectId, refreshConfiguredRun, eligiblePersistedReply, replyRuleBranch, planAutomationErrorContinuation, automationContactSubjectId, contactRunIdentityFilter, normalizedAutomationEmail, InvalidAutomationContactIdentity, resolveActionTarget, InvalidActionTarget, performance: { now: () => clock.time }, executeAutomationHttpAction: (config, vars, legacy, dependencies) => httpAction(config, vars, legacy, { ...dependencies, fetch: fetchStub, resolve: async () => ['93.184.216.34'] }), formatAutomationInvocationError, resolveAutomationEmailRecipient, checkAutomationReentry, executeMetaConversionAction, evaluateConditionValue, executeProposalAction, renderAutomationTemplate, matchesStageTransition, InvalidAutomationReentry, readReentryCooldownDays, reentryCooldownDecision, executeFinanceAction, executeInboxAction, applyFailurePolicy, retryFailedRuns, visitStepKey, stepVisit, currentVisitExecutedNodes, canonicalStepNodeId, planBoundedJump, fetch: fetchStub, Date: ClockDate, requiresSingleBillingEnrollment, deterministicAssignment, evaluateConditionGroup, validateConditionTree, calculateAutomationWakeAt, decideAutomationRetry, alertAutomationFailure, executeBusinessAction, executeCrmAction, taskDueAt, ...globals });
  vm.runInContext(script, context);
  return { ...context.runtime, clock };
}

export function database(run, flow, current = {}) {
  const steps = [];
  const updates = [];
  return {
    steps, updates,
    from(table) {
      let operation = 'select', payload, singular = false, limit = Infinity, offset = 0, countRequested = false, head = false;
      const field = (row, key) => key.split('->').reduce((value, part) => value?.[part], row);
      const predicates = [];
      const chain = {
        select(columns, options) { countRequested = options?.count === "exact"; head = options?.head === true; return chain; },
        eq(key, value) { predicates.push(row => row[key] === value); return chain; },
        neq(key, value) { predicates.push(row => row[key] !== value); return chain; },
        or(expression) {
          if (expression.startsWith('context->>__action_reply_phone_key.eq.')) {
            const key = expression.split(',')[0].split('.eq.')[1];
            predicates.push(row => (row.context?.__action_reply_phone_key ?? row.contact_phone_key) === key);
          } else {
            const alternatives = expression.split(',').map(part => /^(.+).(is|neq|eq).(.+)$/.exec(part));
            predicates.push(row => alternatives.some(match => {
              if (!match) throw new Error('Unsupported fake OR expression: ' + expression);
              const value = match[1].split(/->>?/).reduce((current, part) => current?.[part], row);
              if (match[2] === 'is') return match[3] === 'null' && value == null;
              if (match[2] === 'eq') return value != null && String(value) === match[3];
              return value != null && String(value) !== match[3];
            }));
          }
          return chain;
        },
        not(key, op, value) { predicates.push(row => value === null ? field(row, key) !== null && field(row, key) !== undefined : field(row, key) !== value); return chain; },
        in(key, values) { predicates.push(row => values.includes(row[key])); return chain; },
        lte(key, value) { predicates.push(row => row[key] <= value); return chain; },
        update(value) { operation = 'update'; payload = value; return chain; },
        insert(value) { operation = 'insert'; payload = value; return chain; },
        maybeSingle() { singular = true; return chain; }, single() { singular = true; return chain; },
        order() { return chain; }, range(from, to) { offset = from; limit = to - from + 1; return chain; }, limit(value) { limit = value; return chain; }, delete() { operation = 'delete'; return chain; },
        then(resolve, reject) {
          try {
            const rows = table === 'automation_run_steps' ? steps : table === 'automation_flows' ? [flow] : table === 'automation_runs' ? [run]
              : [{ id: run.subject_id, organization_id: run.organization_id, automation_run_id: run.id, automation_node_id: 'email', name: run.contact_name, email: run.contact_email, phone: run.contact_phone, ...current }];
            const matching = rows.filter(row => predicates.every(predicate => predicate(row)));
            let selected = matching.slice(offset, offset + limit);
            if (operation === 'insert') {
              if (table === 'automation_run_steps') { steps.push(payload); selected = [payload]; }
              if (table === 'automation_runs') {
                Object.assign(run, payload, { id: 'new-run', status: 'running', steps_taken: 0,
                  context: { ...payload.context, __flow_snapshot: { graph: flow.graph, entry_node_id: flow.entry_node_id } } }); selected = [run];
              }
            }
            if (operation === 'update') { updates.push({ table, payload }); selected.forEach(row => Object.assign(row, payload)); }
            if (operation === 'delete' && table === 'automation_run_steps') {
              for (let i = steps.length - 1; i >= 0; i -= 1) if (selected.includes(steps[i])) steps.splice(i, 1);
            }
            return Promise.resolve({ data: head ? null : structuredClone(singular ? selected[0] ?? null : selected), count: countRequested ? matching.length : undefined, error: null }).then(resolve, reject);
          } catch (error) { return Promise.reject(error).then(resolve, reject); }
        },
      };
      return chain;
    },
  };
}

export function fixture(nodes, edges = []) {
  const run = { id: 'run', flow_id: 'flow', organization_id: 'org', subject_type: 'lead', subject_id: 'lead', contact_name: 'Ana', contact_email: 'a@example.test', contact_phone: null, status: 'running', context: {}, steps_taken: 0 };
  const flow = { id: 'flow', organization_id: 'org', status: 'active', graph: { nodes, edges }, entry_node_id: nodes[0]?.id, max_steps_per_run: 3, trigger_config: {}, quiet_hours: null };
  return { run, flow };
}
