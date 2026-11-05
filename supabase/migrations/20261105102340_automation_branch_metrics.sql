BEGIN;
CREATE VIEW public.automation_branch_metrics WITH (security_invoker = true) AS
WITH decisions AS (
  SELECT DISTINCT ON (step.run_id, coalesce(nullif(step.detail ->> 'canonical_node_id', ''), step.node_id))
    run.organization_id, run.flow_id, run.flow_version, run.id AS run_id,
    coalesce(nullif(step.detail ->> 'canonical_node_id', ''), step.node_id) AS node_id, step.detail ->> 'ramo' AS branch_id,
    run.context ->> '__goal_reached_at' IS NOT NULL AS converted,
    run.context -> '__flow_snapshot' -> 'graph' -> 'nodes' AS nodes
  FROM public.automation_run_steps step
  JOIN public.automation_runs run ON run.id = step.run_id AND run.organization_id = step.organization_id
  WHERE step.node_type = 'split_ab' AND step.status = 'ok'
    AND nullif(step.detail ->> 'ramo', '') IS NOT NULL
    AND coalesce(run.context ->> '__test', 'false') <> 'true'
  ORDER BY step.run_id, coalesce(nullif(step.detail ->> 'canonical_node_id', ''), step.node_id), step.created_at, step.id
), labelled AS (
  SELECT decision.*, coalesce(variant.value ->> 'label', decision.branch_id) AS branch_label
  FROM decisions decision
  LEFT JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(decision.nodes) = 'array' THEN decision.nodes ELSE '[]'::jsonb END
  ) node ON node.value ->> 'id' = decision.node_id
  LEFT JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(node.value -> 'config' -> 'variants') = 'array'
      THEN node.value -> 'config' -> 'variants' ELSE '[]'::jsonb END
  ) variant ON variant.value ->> 'id' = decision.branch_id
)
SELECT organization_id, flow_id, flow_version, node_id, branch_id, branch_label,
  count(DISTINCT run_id)::integer AS enrolled,
  count(DISTINCT run_id) FILTER (WHERE converted)::integer AS converted
FROM labelled
GROUP BY organization_id, flow_id, flow_version, node_id, branch_id, branch_label;
GRANT SELECT ON public.automation_branch_metrics TO authenticated;
COMMIT;
