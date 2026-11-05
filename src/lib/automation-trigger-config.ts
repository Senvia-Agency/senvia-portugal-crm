import type { AutomationGraph, AutomationNodeConfig } from '../types/automations';

const FLOW_SETTINGS = ['goal', 'failure_policy', 'failure_alert_enabled', 'reentry_cooldown_days'] as const;

export function buildAutomationTriggerConfig(
  saved: AutomationNodeConfig,
  entry: AutomationNodeConfig,
  triggerChanged: boolean,
  options: { readonly entryNodeId?: string | null; readonly graph?: AutomationGraph } = {},
): AutomationNodeConfig {
  const settings = Object.fromEntries(FLOW_SETTINGS.filter(key => key in saved).map(key => [key, saved[key]]));
  const result: AutomationNodeConfig = { ...(triggerChanged ? {} : saved), ...entry, ...settings };
  if (Array.isArray(saved.recipe_required_fields)) {
    result.recipe_required_fields = saved.recipe_required_fields.filter(requirement => {
      if (typeof requirement !== 'object' || requirement === null || typeof requirement.node_id !== 'string') return false;
      const nodeId = requirement.node_id;
      if (triggerChanged && nodeId === options.entryNodeId) return false;
      return !options.graph || options.graph.nodes.some(node => node.id === nodeId);
    });
  }
  return result;
}
