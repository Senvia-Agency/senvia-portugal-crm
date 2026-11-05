# Bounded jump integration

Helper: `supabase/functions/_shared/automation-jump.ts`.

No SQL migration: keep the existing unique index on `(run_id,node_id)`. First visit uses the original node id; visits 1+ store `__visit:<encoded canonical node id>:<visit>`.

## Engine contract

- Node `goto`: `config.target_node_id`, `config.max_visits` (integer 1–20, includes the first visit). Ordinary outgoing edge is used after the budget is exhausted.
- Add optional `jumpTarget?: string`, `jumpRegion?: readonly string[]` to node outcome.
- In execute goto call `planBoundedJump(flow.graph,run.context,{nodeId:node.id,target:cfg.target_node_id,maxVisits:cfg.max_visits,entryNodeId:flow.entry_node_id})`. Return next + resulting context; when kind jump include target/region.
- Before accepting jump in advance, reject if queued/parked canonical ids intersect region. Call the helper again with pendingNodeIds (or validate those before applying outcome). This prevents resetting an unfinished parallel path.
- recordStep must receive `{...run,context}` and store node_id=`visitStepKey(run.context,node.id)`, detail `{...detail,canonical_node_id:node.id,visit:stepVisit(run.context,node.id)}`.
- executedNodes should receive graph nodes and use `currentVisitExecutedNodes(run.context,graph.nodes,data)` instead of returning stored ids directly.
- After recordStep succeeds, save outcome.context. For a jump delete region ids from local done and enqueue jumpTarget rather than ordinary successors. The goto step itself is recorded under the PREVIOUS context/visit, then the new visit counters take effect.
- settleWaitingStep must select/insert `visitStepKey(run.context,node.id)` with canonical metadata. Cursors/current_node_id remain canonical; graph lookup never uses synthetic ids.
- Failed-step retry must resolve failedSteps.node_id using canonicalStepNodeId, but delete the failed row by its original stored key. It resumes the same context/visit.
- Restart from beginning must remove `__node_visits`, `__jump_counts`, `__email_wait_*` as well as the existing deadlines and retry counters.
- send_email automationNodeId and its email_sends polling query must use visitStepKey. Otherwise opening an old repeated email would satisfy the next visit. The correlation validator accepts the service-owned node key without a graph FK.

## UI/history

Render `step.detail.canonical_node_id ?? canonicalStepNodeId(step.node_id)` for graph selection/highlights. Keep stored step id for row identity. Display visit+1 when >0. Failed-step APIs still accept run id, so engine resolves the stored step.

## Verification

Seven helper scenarios pass: exact visit budget, current-visit dedupe, scoped cleanup of retries/waits, invalid/concurrent jumps, branches/joins, collision-safe encoding and nested budget reset. Deno type check passes. Root still must integrate and execute a real Engine loop test with wait/resume and failed-step retry before exposing goto in editor.
